import { computeDeadline, getStatus } from '../services/sla';
import { prisma } from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  prisma: {
    holiday: {
      findMany: jest.fn(),
    },
  },
}));

const mockHoliday = (prisma as any).holiday;

function d(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHoliday.findMany.mockResolvedValue([]);
});

describe('computeDeadline', () => {
  it('skips Saturdays and Sundays', async () => {
    // Mon 2026-05-18, 5 working days → Mon 2026-05-25
    const result = await computeDeadline(d('2026-05-18'), 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-25');
  });

  it('skips holidays', async () => {
    // Mon 2026-05-18, holiday Tue 2026-05-19 → 5 working days = Tue 2026-05-26
    mockHoliday.findMany.mockResolvedValue([{ date: d('2026-05-19') }]);
    const result = await computeDeadline(d('2026-05-18'), 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-26');
  });

  it('handles consecutive runs of weekends and holidays without miscounting', async () => {
    // Fri 2026-05-15, holiday Mon 2026-05-18 → Sat/Sun/Mon-holiday then Tue(1)...Mon(5)
    mockHoliday.findMany.mockResolvedValue([{ date: d('2026-05-18') }]);
    const result = await computeDeadline(d('2026-05-15'), 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-25');
  });

  it('handles multiple consecutive holidays', async () => {
    // Mon 2026-05-18, holidays Tue+Wed → Thu(1), Fri(2), Mon(3), Tue(4), Wed(5) = 2026-05-27
    mockHoliday.findMany.mockResolvedValue([
      { date: d('2026-05-19') },
      { date: d('2026-05-20') },
    ]);
    const result = await computeDeadline(d('2026-05-18'), 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-27');
  });

  it('handles deadlines spanning month boundaries', async () => {
    // Mon 2026-03-30, 5 working days → Mon 2026-04-06
    const result = await computeDeadline(d('2026-03-30'), 5);
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-06');
  });

  it('handles deadlines spanning year boundaries', async () => {
    // Wed 2026-12-30, 5 working days → Wed 2027-01-06
    const result = await computeDeadline(d('2026-12-30'), 5);
    expect(result.toISOString().slice(0, 10)).toBe('2027-01-06');
  });
});

describe('getStatus', () => {
  it('returns BREACHED when today is after the deadline', async () => {
    const status = await getStatus(d('2026-05-10'), d('2026-05-11'));
    expect(status).toBe('BREACHED');
  });

  it('returns BREACHED one day after the deadline', async () => {
    const status = await getStatus(d('2026-05-18'), d('2026-05-19'));
    expect(status).toBe('BREACHED');
  });

  it('returns APPROACHING when exactly 1 working day remains', async () => {
    // Today Mon 2026-05-18, deadline Tue 2026-05-19 → 1 working day remaining
    const status = await getStatus(d('2026-05-19'), d('2026-05-18'));
    expect(status).toBe('APPROACHING');
  });

  it('returns APPROACHING when deadline is today (0 working days remaining)', async () => {
    const today = d('2026-05-18');
    const status = await getStatus(today, today);
    expect(status).toBe('APPROACHING');
  });

  it('returns APPROACHING when 1 working day remains spanning a weekend', async () => {
    // Today Fri 2026-05-22, deadline Mon 2026-05-25 → Sat/Sun skip, Mon = 1 working day
    const status = await getStatus(d('2026-05-25'), d('2026-05-22'));
    expect(status).toBe('APPROACHING');
  });

  it('returns APPROACHING when holiday reduces remaining days to 1', async () => {
    // Today Mon 2026-05-18, deadline Wed 2026-05-20, holiday Tue 2026-05-19
    // Remaining: Tue(holiday), Wed(1) → 1 working day → APPROACHING
    mockHoliday.findMany.mockResolvedValue([{ date: d('2026-05-19') }]);
    const status = await getStatus(d('2026-05-20'), d('2026-05-18'));
    expect(status).toBe('APPROACHING');
  });

  it('returns ON_TRACK when more than 1 working day remains', async () => {
    // Today Mon 2026-05-18, deadline Wed 2026-05-20 → 2 working days remaining
    const status = await getStatus(d('2026-05-20'), d('2026-05-18'));
    expect(status).toBe('ON_TRACK');
  });

  it('returns ON_TRACK with many working days remaining', async () => {
    // Today Mon 2026-05-18, deadline Mon 2026-05-25 → 5 working days remaining
    const status = await getStatus(d('2026-05-25'), d('2026-05-18'));
    expect(status).toBe('ON_TRACK');
  });
});
