import { Router, Request, Response, NextFunction } from 'express';
import { HolidayType, Role } from '@prisma/client';
import { authenticate, requireProfileComplete, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate, requireProfileComplete, requireRole(Role.IT_ADMIN));

// SLA Config

router.get('/sla-config', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = await prisma.slaConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', workingDays: 5 },
      update: {},
    });
    res.json(config);
  } catch (err) {
    next(err);
  }
});

router.post('/sla-config', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { workingDays } = req.body as { workingDays?: unknown };
    if (workingDays === undefined || workingDays === null) {
      res.status(400).json({ error: 'workingDays is required' });
      return;
    }
    const days = Number(workingDays);
    if (!Number.isInteger(days) || days <= 0) {
      res.status(400).json({ error: 'workingDays must be a positive integer' });
      return;
    }
    const config = await prisma.slaConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', workingDays: days },
      update: { workingDays: days },
    });
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// Holidays

router.get('/holidays', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.query as { type?: string };
    const where: { type?: HolidayType } = {};
    if (type) {
      if (!Object.values(HolidayType).includes(type as HolidayType)) {
        res.status(400).json({ error: 'type must be NATIONAL or CUSTOM' });
        return;
      }
      where.type = type as HolidayType;
    }
    const holidays = await prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    res.json(holidays);
  } catch (err) {
    next(err);
  }
});

router.post('/holidays', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { date, description, type } = req.body as { date?: string; description?: string; type?: string };
    if (!date || !description || !type) {
      res.status(400).json({ error: 'date, description, and type are required' });
      return;
    }
    if (!Object.values(HolidayType).includes(type as HolidayType)) {
      res.status(400).json({ error: 'type must be NATIONAL or CUSTOM' });
      return;
    }
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: 'date must be a valid ISO date string' });
      return;
    }
    const duplicate = await prisma.holiday.findFirst({
      where: { date: parsedDate, type: type as HolidayType },
    });
    if (duplicate) {
      res.status(409).json({ error: 'A holiday with this date and type already exists' });
      return;
    }
    const holiday = await prisma.holiday.create({
      data: { date: parsedDate, description, type: type as HolidayType },
    });
    res.status(201).json(holiday);
  } catch (err) {
    next(err);
  }
});

router.delete('/holidays/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.holiday.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Holiday not found' });
      return;
    }
    await prisma.holiday.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
