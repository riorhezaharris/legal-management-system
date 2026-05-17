import { Router, Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

router.use(authenticate, requireRole(Role.IT_ADMIN));

const CODE_REGEX = /^[A-Z0-9]{1,5}$/;

// LokasiKantor
router.get('/lokasi-kantor', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const items = await prisma.lokasiKantor.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/lokasi-kantor', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const item = await prisma.lokasiKantor.create({ data: { name } });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/lokasi-kantor/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const existing = await prisma.lokasiKantor.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'LokasiKantor not found' });
      return;
    }
    const item = await prisma.lokasiKantor.update({ where: { id }, data: { name } });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/lokasi-kantor/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.lokasiKantor.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'LokasiKantor not found' });
      return;
    }
    const inUse = await prisma.requestorProfile.findFirst({ where: { lokasiKantorId: id } });
    if (inUse) {
      res.status(409).json({ error: 'LokasiKantor is referenced by existing profiles and cannot be deleted' });
      return;
    }
    await prisma.lokasiKantor.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Divisi
router.get('/divisi', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const items = await prisma.divisi.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/divisi', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, code } = req.body as { name?: string; code?: string };
    if (!name || !code) {
      res.status(400).json({ error: 'name and code are required' });
      return;
    }
    if (!CODE_REGEX.test(code)) {
      res.status(400).json({ error: 'code must be uppercase alphanumeric, max 5 characters' });
      return;
    }
    const codeConflict = await prisma.divisi.findUnique({ where: { code } });
    if (codeConflict) {
      res.status(409).json({ error: 'Divisi code already exists' });
      return;
    }
    const item = await prisma.divisi.create({ data: { name, code } });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/divisi/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, code } = req.body as { name?: string; code?: string };
    if (!name && !code) {
      res.status(400).json({ error: 'at least one of name or code is required' });
      return;
    }
    if (code && !CODE_REGEX.test(code)) {
      res.status(400).json({ error: 'code must be uppercase alphanumeric, max 5 characters' });
      return;
    }
    const existing = await prisma.divisi.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Divisi not found' });
      return;
    }
    if (code && code !== existing.code) {
      const codeConflict = await prisma.divisi.findUnique({ where: { code } });
      if (codeConflict) {
        res.status(409).json({ error: 'Divisi code already exists' });
        return;
      }
    }
    const item = await prisma.divisi.update({
      where: { id },
      data: { ...(name !== undefined && { name }), ...(code !== undefined && { code }) },
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/divisi/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.divisi.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Divisi not found' });
      return;
    }
    const inUse = await prisma.requestorProfile.findFirst({ where: { divisiId: id } });
    if (inUse) {
      res.status(409).json({ error: 'Divisi is referenced by existing profiles and cannot be deleted' });
      return;
    }
    await prisma.divisi.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// UnitBisnis
router.get('/unit-bisnis', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const items = await prisma.unitBisnis.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/unit-bisnis', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const item = await prisma.unitBisnis.create({ data: { name } });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/unit-bisnis/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const existing = await prisma.unitBisnis.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'UnitBisnis not found' });
      return;
    }
    const item = await prisma.unitBisnis.update({ where: { id }, data: { name } });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/unit-bisnis/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.unitBisnis.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'UnitBisnis not found' });
      return;
    }
    const inUse = await prisma.requestorProfile.findFirst({ where: { unitBisnisId: id } });
    if (inUse) {
      res.status(409).json({ error: 'UnitBisnis is referenced by existing profiles and cannot be deleted' });
      return;
    }
    await prisma.unitBisnis.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
