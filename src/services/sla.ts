import { prisma } from '../lib/prisma';

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export async function computeDeadline(submittedAt: Date, workingDays: number): Promise<Date> {
  const allHolidays = await prisma.holiday.findMany({ select: { date: true } });
  const holidaySet = new Set(allHolidays.map((h) => toDateKey(h.date)));

  const cursor = new Date(submittedAt);
  cursor.setUTCHours(0, 0, 0, 0);

  let counted = 0;
  while (counted < workingDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor) && !holidaySet.has(toDateKey(cursor))) {
      counted++;
    }
  }

  return cursor;
}

export async function getStatus(
  deadline: Date,
  today?: Date,
): Promise<'ON_TRACK' | 'APPROACHING' | 'BREACHED'> {
  const todayMidnight = new Date(today ?? new Date());
  todayMidnight.setUTCHours(0, 0, 0, 0);

  const deadlineMidnight = new Date(deadline);
  deadlineMidnight.setUTCHours(0, 0, 0, 0);

  if (todayMidnight > deadlineMidnight) return 'BREACHED';

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: todayMidnight, lte: deadlineMidnight } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => toDateKey(h.date)));

  let remaining = 0;
  const cursor = new Date(todayMidnight);
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor <= deadlineMidnight) {
    if (!isWeekend(cursor) && !holidaySet.has(toDateKey(cursor))) {
      remaining++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return remaining <= 1 ? 'APPROACHING' : 'ON_TRACK';
}
