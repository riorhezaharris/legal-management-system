import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { Role, RequestStatus, RequestType } from '@prisma/client';
import { authenticate, requireProfileComplete, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { transition, TransitionAction, WorkflowError } from '../services/workflow';
import {
  notifyRequestorStageAdvanced,
  notifyRequestorSentBack,
  notifyRequestorRejected,
  notifyRequestorFinished,
} from '../services/notifications';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const VALID_ACTIONS: TransitionAction[] = [
  'ADVANCE',
  'SEND_BACK',
  'CANCEL',
  'REJECT',
  'CONFIRM_VENDOR',
  'MARK_INTERNAL_SIGNING_REQUIRED',
];

function isValidForFinish(request: {
  status: RequestStatus;
  type: RequestType;
  requiresInternalSigning: boolean;
}): boolean {
  if (request.status === RequestStatus.VENDOR_SIGNING) return true;
  if (
    (request.type === RequestType.SURAT || request.type === RequestType.PERMINTAAN_DOKUMEN) &&
    request.status === RequestStatus.INTERNAL_SIGNING &&
    request.requiresInternalSigning
  )
    return true;
  if (
    (request.type === RequestType.SURAT || request.type === RequestType.PERMINTAAN_DOKUMEN) &&
    request.status === RequestStatus.LEGAL_REVIEW &&
    !request.requiresInternalSigning
  )
    return true;
  return false;
}

function sendTransitionNotification(
  result: any,
  action: TransitionAction,
  remarks?: string,
  reason?: string,
): void {
  const refNum = result.referenceNumber ?? '(draft)';
  const requestorEmail = result.requestor?.email;
  if (!requestorEmail) return;

  switch (action) {
    case 'SEND_BACK':
      notifyRequestorSentBack(requestorEmail, refNum, remarks ?? '');
      break;
    case 'REJECT':
      notifyRequestorRejected(requestorEmail, refNum, reason ?? '');
      break;
    case 'ADVANCE':
    case 'CONFIRM_VENDOR':
    case 'MARK_INTERNAL_SIGNING_REQUIRED':
      notifyRequestorStageAdvanced(requestorEmail, refNum, result.status);
      break;
    default:
      break;
  }
}

// POST /requests/:id/transition
router.post(
  '/:id/transition',
  authenticate,
  requireProfileComplete,
  requireRole(Role.REQUESTOR, Role.LEGAL_TEAM),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { action, remarks, reason } = req.body as {
        action?: string;
        remarks?: string;
        reason?: string;
      };

      if (!action || !VALID_ACTIONS.includes(action as TransitionAction)) {
        res.status(400).json({
          error: `action is required and must be one of: ${VALID_ACTIONS.join(', ')}`,
        });
        return;
      }

      const result = await transition(id, action as TransitionAction, req.user!, {
        remarks,
        reason,
      });

      sendTransitionNotification(result, action as TransitionAction, remarks, reason);

      res.json(result);
    } catch (err) {
      if (err instanceof WorkflowError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

// POST /requests/:id/documents
router.post(
  '/:id/documents',
  authenticate,
  requireRole(Role.LEGAL_TEAM),
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('documents', 10)(req, res, (err) => {
      if (err) {
        if ((err as any).code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: 'File too large. Maximum size is 20MB per file.' });
          return;
        }
        next(err);
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const files = req.files as Express.Multer.File[];

      if (!files?.length) {
        res.status(400).json({ error: 'At least one document file is required' });
        return;
      }

      const request = await prisma.legalRequest.findUnique({
        where: { id },
        include: { requestor: { select: { id: true, name: true, email: true } } },
      });

      if (!request) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }

      if (!isValidForFinish(request)) {
        res.status(400).json({
          error: `Cannot upload final documents: request is in ${request.status} which does not allow finalization`,
        });
        return;
      }

      const uploadedDocs: Array<{ fileUrl: string; fileName: string; fileSize: number }> = [];
      for (const file of files) {
        const dotIdx = file.originalname.lastIndexOf('.');
        const ext = dotIdx !== -1 ? file.originalname.slice(dotIdx + 1) : 'bin';
        const filePath = `final-documents/${id}/${randomUUID()}.${ext}`;

        const { error } = await storage
          .from('request-attachments')
          .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });

        if (error) {
          res.status(500).json({ error: `Failed to upload document: ${error.message}` });
          return;
        }

        const { data } = storage.from('request-attachments').getPublicUrl(filePath);
        uploadedDocs.push({
          fileUrl: data.publicUrl,
          fileName: file.originalname,
          fileSize: file.size,
        });
      }

      const firstHandlerUpdate: Record<string, any> = {};
      if (!request.firstHandlerId) {
        firstHandlerUpdate.firstHandlerId = req.user!.id;
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.finalDocument.createMany({
          data: uploadedDocs.map((doc) => ({ requestId: id, ...doc })),
        });

        const updatedRequest = await tx.legalRequest.update({
          where: { id },
          data: { status: RequestStatus.FINISHED, ...firstHandlerUpdate },
          include: {
            data: true,
            attachments: true,
            finalDocuments: true,
            vendor: { select: { id: true, name: true, kybStatus: true } },
            requestor: { select: { id: true, name: true, email: true } },
            stageHistories: { orderBy: { createdAt: 'desc' } },
          },
        });

        await tx.stageHistory.create({
          data: {
            requestId: id,
            fromStage: request.status,
            toStage: RequestStatus.FINISHED,
            actorId: req.user!.id,
          },
        });

        return updatedRequest;
      });

      const requestorEmail = (updated.requestor as any)?.email;
      if (requestorEmail && updated.referenceNumber) {
        notifyRequestorFinished(requestorEmail, updated.referenceNumber);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
