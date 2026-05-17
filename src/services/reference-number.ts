import { RequestType } from '@prisma/client';
import { prisma } from '../lib/prisma';

const TYPE_CODES: Record<RequestType, string> = {
  PERJANJIAN_BARU: 'PB',
  ADENDUM: 'ADM',
  SURAT: 'SRT',
  PERMINTAAN_DOKUMEN: 'PDK',
};

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export async function generate(
  divisiCode: string,
  requestType: RequestType,
  submittedAt: Date,
): Promise<string> {
  const year = submittedAt.getUTCFullYear();
  const month = submittedAt.getUTCMonth();

  const counter = await prisma.requestCounter.upsert({
    where: { year },
    create: { year, lastSequence: 1 },
    update: { lastSequence: { increment: 1 } },
  });

  const seq = String(counter.lastSequence).padStart(3, '0');
  const typeCode = TYPE_CODES[requestType];
  const monthRoman = ROMAN_MONTHS[month];

  return `${seq}/${divisiCode}/${typeCode}/${monthRoman}/${year}`;
}
