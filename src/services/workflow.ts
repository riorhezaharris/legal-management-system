import { prisma } from '../lib/prisma';
import { AuthUser } from '../middleware/auth';
import {
  evaluate,
  TransitionAction,
  TransitionOptions,
  WorkflowError,
  RequestSnapshot,
} from './workflow-policy';
import {
  notifyRequestorStageAdvanced,
  notifyRequestorSentBack,
  notifyRequestorRejected,
} from './notifications';

export { TransitionAction, TransitionOptions, WorkflowError } from './workflow-policy';

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

  const { toStage, extraData } = evaluate(action, actor, request as RequestSnapshot, options);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.legalRequest.update({
      where: { id: requestId },
      data: { status: toStage, ...extraData },
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

  const refNum = result.referenceNumber ?? '(draft)';
  const requestorEmail = (result.requestor as any)?.email;
  if (requestorEmail) {
    switch (action) {
      case 'SEND_BACK':
        notifyRequestorSentBack(requestorEmail, refNum, options.remarks ?? '');
        break;
      case 'REJECT':
        notifyRequestorRejected(requestorEmail, refNum, options.reason ?? '');
        break;
      case 'ADVANCE':
      case 'CONFIRM_VENDOR':
      case 'MARK_INTERNAL_SIGNING_REQUIRED':
        notifyRequestorStageAdvanced(requestorEmail, refNum, result.status);
        break;
    }
  }

  return result;
}
