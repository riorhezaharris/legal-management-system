import { generate } from '../services/reference-number';
import { prisma } from '../lib/prisma';
import { RequestType } from '@prisma/client';

jest.mock('../lib/prisma', () => ({
  prisma: {
    requestCounter: {
      upsert: jest.fn(),
    },
  },
}));

const mockCounter = (prisma as any).requestCounter;

function d(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generate — type codes', () => {
  it.each([
    [RequestType.PERJANJIAN_BARU, 'PB'],
    [RequestType.ADENDUM, 'ADM'],
    [RequestType.SURAT, 'SRT'],
    [RequestType.PERMINTAAN_DOKUMEN, 'PDK'],
  ])('produces correct type code for %s', async (type, expectedCode) => {
    mockCounter.upsert.mockResolvedValue({ year: 2026, lastSequence: 1 });
    const result = await generate('FIN', type, d('2026-01-05'));
    const parts = result.split('/');
    expect(parts[2]).toBe(expectedCode);
  });
});

describe('generate — roman numeral months', () => {
  const cases: [string, string][] = [
    ['2026-01-05', 'I'],
    ['2026-02-05', 'II'],
    ['2026-03-05', 'III'],
    ['2026-04-05', 'IV'],
    ['2026-05-05', 'V'],
    ['2026-06-05', 'VI'],
    ['2026-07-05', 'VII'],
    ['2026-08-05', 'VIII'],
    ['2026-09-05', 'IX'],
    ['2026-10-05', 'X'],
    ['2026-11-05', 'XI'],
    ['2026-12-05', 'XII'],
  ];

  it.each(cases)('date %s → month %s', async (dateStr, expectedRoman) => {
    mockCounter.upsert.mockResolvedValue({ year: 2026, lastSequence: 1 });
    const result = await generate('FIN', RequestType.PERJANJIAN_BARU, d(dateStr));
    const parts = result.split('/');
    expect(parts[3]).toBe(expectedRoman);
  });
});

describe('generate — sequence padding', () => {
  it('zero-pads single-digit sequences to 3 digits', async () => {
    mockCounter.upsert.mockResolvedValue({ year: 2026, lastSequence: 1 });
    const result = await generate('FIN', RequestType.PERJANJIAN_BARU, d('2026-05-05'));
    expect(result.startsWith('001/')).toBe(true);
  });

  it('zero-pads two-digit sequences to 3 digits', async () => {
    mockCounter.upsert.mockResolvedValue({ year: 2026, lastSequence: 10 });
    const result = await generate('FIN', RequestType.PERJANJIAN_BARU, d('2026-05-05'));
    expect(result.startsWith('010/')).toBe(true);
  });

  it('does not pad three-digit sequences', async () => {
    mockCounter.upsert.mockResolvedValue({ year: 2026, lastSequence: 100 });
    const result = await generate('FIN', RequestType.PERJANJIAN_BARU, d('2026-05-05'));
    expect(result.startsWith('100/')).toBe(true);
  });
});

describe('generate — output format', () => {
  it('produces the correct full format', async () => {
    mockCounter.upsert.mockResolvedValue({ year: 2026, lastSequence: 42 });
    const result = await generate('FIN', RequestType.PERJANJIAN_BARU, d('2026-05-15'));
    expect(result).toBe('042/FIN/PB/V/2026');
  });

  it('includes the year correctly', async () => {
    mockCounter.upsert.mockResolvedValue({ year: 2027, lastSequence: 1 });
    const result = await generate('HR', RequestType.SURAT, d('2027-03-10'));
    expect(result).toBe('001/HR/SRT/III/2027');
  });
});

describe('generate — sequence reset per year', () => {
  it('passes the correct year to upsert for year reset logic', async () => {
    mockCounter.upsert.mockResolvedValue({ year: 2027, lastSequence: 1 });
    await generate('FIN', RequestType.PERJANJIAN_BARU, d('2027-01-02'));
    expect(mockCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { year: 2027 },
        create: { year: 2027, lastSequence: 1 },
        update: { lastSequence: { increment: 1 } },
      }),
    );
  });

  it('uses a separate counter for each calendar year', async () => {
    mockCounter.upsert
      .mockResolvedValueOnce({ year: 2026, lastSequence: 5 })
      .mockResolvedValueOnce({ year: 2027, lastSequence: 1 });

    const result2026 = await generate('FIN', RequestType.ADENDUM, d('2026-12-31'));
    const result2027 = await generate('FIN', RequestType.ADENDUM, d('2027-01-01'));

    expect(result2026).toBe('005/FIN/ADM/XII/2026');
    expect(result2027).toBe('001/FIN/ADM/I/2027');

    expect(mockCounter.upsert).toHaveBeenCalledTimes(2);
    expect(mockCounter.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { year: 2026 } }),
    );
    expect(mockCounter.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { year: 2027 } }),
    );
  });
});
