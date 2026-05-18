import { RequestStatus, RequestType, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuthUser } from '../middleware/auth';

export type TransitionAction =
  | 'ADVANCE'
  | 'SEND_BACK'
  | 'CANCEL'
  | 'REJECT'
  | 'CONFIRM_VENDOR'
  | 'MARK_INTERNAL_SIGNING_REQUIRED';

export interface TransitionOptions {
  remarks?: string;
  reason?: string;
}

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

const TERMINAL_STATUSES: RequestStatus[] = [
  RequestStatus.FINISHED,
  RequestStatus.CANCELLED,
  RequestStatus.REJECTED,
  RequestStatus.DRAFT,
];

export async function transition(
  requestId: string,
  action: TransitionAction,
  actor: AuthUser,
  options: TransitionOptions = {},
) {
  const request = await prisma.legalRequest.findUnique({
    where: { id: requestId },
    include: {
      vendor: { select: { kybStatus: true } },
      requestor: { select: { id: true, name: true, email: true } },
    },
  });

  if (!request) {
    throw new WorkflowError('Request not found', 404);
  }

  if (TERMINAL_STATUSES.includes(request.status)) {
    throw new WorkflowError(
      `Request is in a terminal state (${request.status}) and cannot be transitioned`,
    );
  }

  let toStage: RequestStatus;
  const updateData: Record<string, any> = {};

  switch (action) {
    case 'ADVANCE': {
      if (actor.role !== Role.REQUESTOR && actor.role !== Role.LEGAL_TEAM) {
        throw new WorkflowError('Only REQUESTOR or LEGAL_TEAM can ADVANCE', 403);
      }

      if (actor.role === Role.REQUESTOR) {
        if (request.requestorId !== actor.id) {
          throw new WorkflowError('Forbidden', 403);
        }
        if (request.status !== RequestStatus.USER_REVIEW) {
          throw new WorkflowError('Requestor can only advance from USER_REVIEW');
        }
        toStage = RequestStatus.LEGAL_REVIEW;
        break;
      }

      // LEGAL_TEAM advances
      if (request.status === RequestStatus.WAITING) {
        if (request.vendor && request.vendor.kybStatus !== 'APPROVED') {
          throw new WorkflowError('Cannot advance: vendor KYB is not approved (kybBlocked)');
        }
        toStage = RequestStatus.LEGAL_REVIEW;
        break;
      }

      if (request.status === RequestStatus.LEGAL_REVIEW) {
        if (request.type === RequestType.PERJANJIAN_BARU || request.type === RequestType.ADENDUM) {
          toStage = RequestStatus.VENDOR_REVIEW;
          break;
        }
        throw new WorkflowError(
          `Use MARK_INTERNAL_SIGNING_REQUIRED or POST /requests/:id/documents to advance ${request.type} from LEGAL_REVIEW`,
        );
      }

      if (request.status === RequestStatus.INTERNAL_SIGNING) {
        if (request.type === RequestType.PERJANJIAN_BARU || request.type === RequestType.ADENDUM) {
          toStage = RequestStatus.VENDOR_SIGNING;
          break;
        }
        throw new WorkflowError(
          `Use POST /requests/:id/documents to finalize ${request.type} from INTERNAL_SIGNING`,
        );
      }

      if (request.status === RequestStatus.VENDOR_REVIEW) {
        throw new WorkflowError('Use CONFIRM_VENDOR to advance from VENDOR_REVIEW');
      }

      if (request.status === RequestStatus.VENDOR_SIGNING) {
        throw new WorkflowError('Use POST /requests/:id/documents to finalize from VENDOR_SIGNING');
      }

      throw new WorkflowError(
        `Cannot ADVANCE from ${request.status} for type ${request.type} as LEGAL_TEAM`,
      );
    }

    case 'SEND_BACK': {
      if (actor.role !== Role.LEGAL_TEAM) {
        throw new WorkflowError('Only LEGAL_TEAM can SEND_BACK', 403);
      }
      if (!options.remarks?.trim()) {
        throw new WorkflowError('remarks are required for SEND_BACK');
      }
      const sendBackAllowed: RequestStatus[] = [
        RequestStatus.WAITING,
        RequestStatus.LEGAL_REVIEW,
        RequestStatus.VENDOR_REVIEW,
        RequestStatus.INTERNAL_SIGNING,
        RequestStatus.VENDOR_SIGNING,
      ];
      if (!sendBackAllowed.includes(request.status)) {
        throw new WorkflowError(`Cannot SEND_BACK from ${request.status}`);
      }
      toStage = RequestStatus.USER_REVIEW;
      break;
    }

    case 'CANCEL': {
      if (actor.role !== Role.REQUESTOR && actor.role !== Role.LEGAL_TEAM) {
        throw new WorkflowError('Only REQUESTOR or LEGAL_TEAM can CANCEL', 403);
      }
      if (actor.role === Role.REQUESTOR) {
        if (request.requestorId !== actor.id) {
          throw new WorkflowError('Forbidden', 403);
        }
        const requestorCancelAllowed: RequestStatus[] = [
          RequestStatus.WAITING,
          RequestStatus.USER_REVIEW,
        ];
        if (!requestorCancelAllowed.includes(request.status)) {
          throw new WorkflowError('Requestor can only cancel from WAITING or USER_REVIEW');
        }
      }
      toStage = RequestStatus.CANCELLED;
      break;
    }

    case 'REJECT': {
      if (actor.role !== Role.LEGAL_TEAM) {
        throw new WorkflowError('Only LEGAL_TEAM can REJECT', 403);
      }
      if (!options.reason?.trim()) {
        throw new WorkflowError('reason is required for REJECT');
      }
      toStage = RequestStatus.REJECTED;
      updateData.rejectionReason = options.reason;
      break;
    }

    case 'CONFIRM_VENDOR': {
      if (actor.role !== Role.LEGAL_TEAM) {
        throw new WorkflowError('Only LEGAL_TEAM can CONFIRM_VENDOR', 403);
      }
      if (request.status !== RequestStatus.VENDOR_REVIEW) {
        throw new WorkflowError(
          `CONFIRM_VENDOR can only be called from VENDOR_REVIEW, not from ${request.status}`,
        );
      }
      toStage = RequestStatus.INTERNAL_SIGNING;
      break;
    }

    case 'MARK_INTERNAL_SIGNING_REQUIRED': {
      if (actor.role !== Role.LEGAL_TEAM) {
        throw new WorkflowError('Only LEGAL_TEAM can MARK_INTERNAL_SIGNING_REQUIRED', 403);
      }
      if (request.status !== RequestStatus.LEGAL_REVIEW) {
        throw new WorkflowError(
          `MARK_INTERNAL_SIGNING_REQUIRED can only be called from LEGAL_REVIEW, not from ${request.status}`,
        );
      }
      if (
        request.type !== RequestType.SURAT &&
        request.type !== RequestType.PERMINTAAN_DOKUMEN
      ) {
        throw new WorkflowError(
          'MARK_INTERNAL_SIGNING_REQUIRED is only valid for SURAT and PERMINTAAN_DOKUMEN',
        );
      }
      toStage = RequestStatus.INTERNAL_SIGNING;
      updateData.requiresInternalSigning = true;
      break;
    }

    default:
      throw new WorkflowError(`Unknown action: ${action as string}`);
  }

  if (actor.role === Role.LEGAL_TEAM && !request.firstHandlerId) {
    updateData.firstHandlerId = actor.id;
  }
  updateData.status = toStage;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.legalRequest.update({
      where: { id: requestId },
      data: updateData,
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
        requestId,
        fromStage: request.status,
        toStage,
        actorId: actor.id,
        remarks: options.remarks ?? options.reason ?? null,
      },
    });

    return updated;
  });

  return result;
}
