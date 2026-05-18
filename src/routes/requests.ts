import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { Role, RequestType, RequestStatus, AttachmentType } from '@prisma/client';
import { authenticate, requireProfileComplete, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { submitDraft, SubmissionError } from '../services/request-submission';
import { vendorRequired } from '../services/request-policy';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ATTACHMENT_FIELDS = [
  { name: 'ADENDUM_PREVIOUS_AGREEMENT', maxCount: 1 },
  { name: 'SURAT_PRIOR_CORRESPONDENCE', maxCount: 1 },
  { name: 'PERMINTAAN_SUPPORTING_DOC', maxCount: 1 },
];

function parseFiles(req: Request, res: Response, next: NextFunction): void {
  upload.fields(ATTACHMENT_FIELDS)(req, res, (err) => {
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
}


async function uploadAttachment(
  file: Express.Multer.File,
  requestId: string,
  attachmentType: string,
): Promise<{ fileUrl: string; fileName: string; fileSize: number }> {
  const dotIdx = file.originalname.lastIndexOf('.');
  const ext = dotIdx !== -1 ? file.originalname.slice(dotIdx + 1) : 'bin';
  const filePath = `requests/${requestId}/${attachmentType}-${Date.now()}.${ext}`;

  const { error } = await storage
    .from('request-attachments')
    .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });

  if (error) throw new Error(`Failed to upload ${attachmentType}: ${error.message}`);

  const { data } = storage.from('request-attachments').getPublicUrl(filePath);
  return { fileUrl: data.publicUrl, fileName: file.originalname, fileSize: file.size };
}

function buildVisibilityFilter(user: NonNullable<Request['user']>): Record<string, any> {
  if (user.role === Role.REQUESTOR) return { requestorId: user.id };
  if (user.role === Role.VENDOR) return { vendorId: user.id };
  return {};
}

// POST /requests
router.post(
  '/',
  authenticate,
  requireProfileComplete,
  requireRole(Role.REQUESTOR),
  parseFiles,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const { type, submit, vendorId, ...fields } = req.body as Record<string, any>;
      const shouldSubmit = submit === 'true' || submit === true;

      if (!type || !Object.values(RequestType).includes(type as RequestType)) {
        res.status(400).json({ error: 'type is required and must be a valid RequestType' });
        return;
      }

      if (!vendorRequired(type as RequestType) && vendorId) {
        res.status(400).json({ error: `vendorId is not accepted for request type ${type}` });
        return;
      }

      if (vendorId) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) {
          res.status(400).json({ error: 'Vendor not found' });
          return;
        }
        if (!vendor.isActive) {
          res.status(400).json({ error: 'Cannot link a deactivated vendor' });
          return;
        }
      }

      const requestId = randomUUID();

      const newAttachments: Array<{
        type: AttachmentType;
        fileUrl: string;
        fileName: string;
        fileSize: number;
      }> = [];

      for (const [fieldName, fileArr] of Object.entries(files)) {
        if (!fileArr?.length) continue;
        try {
          const uploaded = await uploadAttachment(fileArr[0], requestId, fieldName);
          newAttachments.push({ type: fieldName as AttachmentType, ...uploaded });
        } catch (uploadErr: any) {
          res.status(500).json({ error: uploadErr.message });
          return;
        }
      }

      const request = await prisma.$transaction(async (tx) => {
        return tx.legalRequest.create({
          data: {
            id: requestId,
            requestorId: req.user!.id,
            type: type as RequestType,
            status: RequestStatus.DRAFT,
            vendorId: vendorId ?? null,
            data: {
              create: {
                lingkupPerjanjian: fields.lingkupPerjanjian ?? null,
                statusPerjanjian: fields.statusPerjanjian ?? null,
                jangkaWaktuStart: fields.jangkaWaktuStart ? new Date(fields.jangkaWaktuStart) : null,
                jangkaWaktuEnd: fields.jangkaWaktuEnd ? new Date(fields.jangkaWaktuEnd) : null,
                perjanjianSebelumnya: fields.perjanjianSebelumnya ?? null,
                halYangInginDiubah: fields.halYangInginDiubah ?? null,
                suratYangHendakDibuat: fields.suratYangHendakDibuat ?? null,
                identitasPenerimaSurat: fields.identitasPenerimaSurat ?? null,
                dokumenYangDiminta: fields.dokumenYangDiminta ?? null,
                tujuanPermintaan: fields.tujuanPermintaan ?? null,
              },
            },
            ...(newAttachments.length > 0
              ? { attachments: { createMany: { data: newAttachments } } }
              : {}),
          },
          include: {
            data: true,
            attachments: true,
            vendor: { select: { id: true, name: true, kybStatus: true } },
          },
        });
      });

      if (shouldSubmit) {
        const submitted = await submitDraft(requestId, req.user!.id);
        res.status(201).json(submitted);
        return;
      }

      res.status(201).json(request);
    } catch (err) {
      if (err instanceof SubmissionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

// PATCH /requests/:id
router.patch(
  '/:id',
  authenticate,
  requireProfileComplete,
  requireRole(Role.REQUESTOR),
  parseFiles,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const { vendorId, ...fields } = req.body as Record<string, any>;

      const request = await prisma.legalRequest.findUnique({
        where: { id },
        include: { data: true, attachments: true },
      });

      if (!request) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }

      if (request.requestorId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (request.status !== RequestStatus.DRAFT) {
        res.status(400).json({ error: 'Only DRAFT requests can be edited' });
        return;
      }

      if (!vendorRequired(request.type) && vendorId) {
        res.status(400).json({ error: `vendorId is not accepted for request type ${request.type}` });
        return;
      }

      let newVendorId = request.vendorId;
      if (vendorId !== undefined) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) {
          res.status(400).json({ error: 'Vendor not found' });
          return;
        }
        if (!vendor.isActive) {
          res.status(400).json({ error: 'Cannot link a deactivated vendor' });
          return;
        }
        newVendorId = vendorId;
      }

      const newAttachments: Array<{
        type: AttachmentType;
        fileUrl: string;
        fileName: string;
        fileSize: number;
      }> = [];

      for (const [fieldName, fileArr] of Object.entries(files)) {
        if (!fileArr?.length) continue;
        try {
          const uploaded = await uploadAttachment(fileArr[0], id, fieldName);
          newAttachments.push({ type: fieldName as AttachmentType, ...uploaded });
        } catch (uploadErr: any) {
          res.status(500).json({ error: uploadErr.message });
          return;
        }
      }

      const dataUpdate: Record<string, any> = {};
      const dataFields = [
        'lingkupPerjanjian', 'statusPerjanjian', 'perjanjianSebelumnya', 'halYangInginDiubah',
        'suratYangHendakDibuat', 'identitasPenerimaSurat', 'dokumenYangDiminta', 'tujuanPermintaan',
      ] as const;
      for (const f of dataFields) {
        if (fields[f] !== undefined) dataUpdate[f] = fields[f];
      }
      if (fields.jangkaWaktuStart !== undefined)
        dataUpdate.jangkaWaktuStart = fields.jangkaWaktuStart ? new Date(fields.jangkaWaktuStart) : null;
      if (fields.jangkaWaktuEnd !== undefined)
        dataUpdate.jangkaWaktuEnd = fields.jangkaWaktuEnd ? new Date(fields.jangkaWaktuEnd) : null;

      const updated = await prisma.$transaction(async (tx) => {
        for (const attachment of newAttachments) {
          await tx.legalRequestAttachment.deleteMany({ where: { requestId: id, type: attachment.type } });
          await tx.legalRequestAttachment.create({ data: { requestId: id, ...attachment } });
        }

        await tx.legalRequest.update({ where: { id }, data: { vendorId: newVendorId } });

        if (Object.keys(dataUpdate).length > 0) {
          await tx.legalRequestData.update({ where: { requestId: id }, data: dataUpdate });
        }

        return tx.legalRequest.findUnique({
          where: { id },
          include: {
            data: true,
            attachments: true,
            vendor: { select: { id: true, name: true, kybStatus: true } },
          },
        });
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// POST /requests/:id/submit
router.post(
  '/:id/submit',
  authenticate,
  requireProfileComplete,
  requireRole(Role.REQUESTOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await submitDraft(id, req.user!.id);
      res.json(result);
    } catch (err) {
      if (err instanceof SubmissionError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

// GET /requests
router.get(
  '/',
  authenticate,
  requireRole(Role.REQUESTOR, Role.LEGAL_TEAM, Role.IT_ADMIN, Role.VENDOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const visibilityFilter = buildVisibilityFilter(req.user!);

      const requests = await prisma.legalRequest.findMany({
        where: visibilityFilter,
        include: {
          data: true,
          vendor: { select: { id: true, name: true, kybStatus: true } },
          requestor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const response = requests.map(r => ({
        ...r,
        kybBlocked: r.vendor ? r.vendor.kybStatus !== 'APPROVED' : false,
      }));

      res.json(response);
    } catch (err) {
      next(err);
    }
  },
);

// GET /requests/:id
router.get(
  '/:id',
  authenticate,
  requireRole(Role.REQUESTOR, Role.LEGAL_TEAM, Role.IT_ADMIN, Role.VENDOR),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const user = req.user!;

      const request = await prisma.legalRequest.findUnique({
        where: { id },
        include: {
          data: true,
          attachments: true,
          finalDocuments: true,
          vendor: { select: { id: true, name: true, kybStatus: true } },
          requestor: { select: { id: true, name: true } },
          stageHistories: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (!request) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }

      if (user.role === Role.REQUESTOR && request.requestorId !== user.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      if (user.role === Role.VENDOR && request.vendorId !== user.id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.json({
        ...request,
        kybBlocked: request.vendor ? request.vendor.kybStatus !== 'APPROVED' : false,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
