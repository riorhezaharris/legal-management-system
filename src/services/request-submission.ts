import { RequestStatus, RequestType, StatusPerjanjian } from '@prisma/client';
import { vendorRequired } from './request-policy';
import { prisma } from '../lib/prisma';
import { generate as generateRefNumber } from './reference-number';
import { computeDeadline } from './sla';
import { notifyLegalTeamNewRequest, getLegalTeamEmails } from './notifications';

export class SubmissionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'SubmissionError';
  }
}

function validateSubmitFields(
  type: RequestType,
  data: Record<string, any>,
  vendorId: string | null | undefined,
  attachmentTypes: string[],
): void {
  if (vendorRequired(type) && !vendorId) throw new SubmissionError(`vendorId is required for ${type}`);

  switch (type) {
    case RequestType.PERJANJIAN_BARU:
      if (!data.lingkupPerjanjian) throw new SubmissionError('lingkupPerjanjian is required');
      if (!data.statusPerjanjian || !Object.values(StatusPerjanjian).includes(data.statusPerjanjian as StatusPerjanjian))
        throw new SubmissionError('statusPerjanjian must be BELUM_BERLANGSUNG, SEDANG_BERLANGSUNG, or SUDAH_SELESAI');
      if (!data.jangkaWaktuStart) throw new SubmissionError('jangkaWaktuStart is required');
      if (!data.jangkaWaktuEnd) throw new SubmissionError('jangkaWaktuEnd is required');
      break;
    case RequestType.ADENDUM:
      if (!data.perjanjianSebelumnya) throw new SubmissionError('perjanjianSebelumnya is required');
      if (!data.halYangInginDiubah) throw new SubmissionError('halYangInginDiubah is required');
      if (!attachmentTypes.includes('ADENDUM_PREVIOUS_AGREEMENT'))
        throw new SubmissionError('Lampirkan Perjanjian Sebelumnya is required for ADENDUM');
      break;
    case RequestType.SURAT:
      if (!data.suratYangHendakDibuat) throw new SubmissionError('suratYangHendakDibuat is required');
      if (!data.identitasPenerimaSurat) throw new SubmissionError('identitasPenerimaSurat is required');
      break;
    case RequestType.PERMINTAAN_DOKUMEN:
      if (!data.dokumenYangDiminta) throw new SubmissionError('dokumenYangDiminta is required');
      if (!data.tujuanPermintaan) throw new SubmissionError('tujuanPermintaan is required');
      break;
  }
}

export async function submitDraft(requestId: string, actorId: string) {
  const request = await prisma.legalRequest.findUnique({
    where: { id: requestId },
    include: {
      data: true,
      attachments: true,
      vendor: { select: { isActive: true } },
    },
  });

  if (!request) throw new SubmissionError('Request not found', 404);
  if (request.status !== RequestStatus.DRAFT) throw new SubmissionError('Only DRAFT requests can be submitted');
  if (request.requestorId !== actorId) throw new SubmissionError('Forbidden', 403);

  const attachmentTypes = request.attachments.map((a) => a.type as string);
  validateSubmitFields(request.type, request.data ?? {}, request.vendorId, attachmentTypes);

  if (request.vendor && !request.vendor.isActive) {
    throw new SubmissionError('Linked vendor is deactivated');
  }

  const profile = await prisma.requestorProfile.findUnique({
    where: { userId: actorId },
    include: { divisi: true },
  });
  if (!profile) throw new SubmissionError('Requestor profile is required to submit a request');

  const submittedAt = new Date();
  const referenceNumber = await generateRefNumber(profile.divisi.code, request.type, submittedAt);
  const slaConfig = await prisma.slaConfig.findUnique({ where: { id: 'singleton' } });
  const slaDeadline = await computeDeadline(submittedAt, slaConfig?.workingDays ?? 5);

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.legalRequest.update({
      where: { id: requestId },
      data: { status: RequestStatus.WAITING, referenceNumber, submittedAt, slaDeadline },
      include: {
        data: true,
        attachments: true,
        vendor: { select: { id: true, name: true, kybStatus: true } },
      },
    });

    await tx.stageHistory.create({
      data: {
        requestId,
        fromStage: null,
        toStage: RequestStatus.WAITING,
        actorId,
      },
    });

    return updatedRequest;
  });

  const legalEmails = await getLegalTeamEmails();
  notifyLegalTeamNewRequest(legalEmails, referenceNumber);

  return updated;
}
