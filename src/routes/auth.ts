import { Router, Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireProfileComplete } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

router.post(
  '/complete-profile',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;

      if (user.role !== Role.REQUESTOR) {
        res.status(403).json({ error: 'Only Requestors can complete a profile' });
        return;
      }

      if (user.profileCompleted) {
        res.status(409).json({ error: 'Profile already completed' });
        return;
      }

      const { namaLengkap, lokasiKantorId, divisiId, unitBisnisId } =
        req.body as {
          namaLengkap?: string;
          lokasiKantorId?: string;
          divisiId?: string;
          unitBisnisId?: string;
        };

      if (!namaLengkap || !lokasiKantorId || !divisiId || !unitBisnisId) {
        res.status(400).json({
          error: 'namaLengkap, lokasiKantorId, divisiId, and unitBisnisId are required',
        });
        return;
      }

      const [lokasiKantor, divisi, unitBisnis] = await Promise.all([
        prisma.lokasiKantor.findUnique({ where: { id: lokasiKantorId } }),
        prisma.divisi.findUnique({ where: { id: divisiId } }),
        prisma.unitBisnis.findUnique({ where: { id: unitBisnisId } }),
      ]);

      if (!lokasiKantor) {
        res.status(400).json({ error: 'Invalid lokasiKantorId' });
        return;
      }
      if (!divisi) {
        res.status(400).json({ error: 'Invalid divisiId' });
        return;
      }
      if (!unitBisnis) {
        res.status(400).json({ error: 'Invalid unitBisnisId' });
        return;
      }

      const profile = await prisma.$transaction(async (tx) => {
        const created = await tx.requestorProfile.create({
          data: { userId: user.id, namaLengkap, lokasiKantorId, divisiId, unitBisnisId },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { profileCompleted: true },
        });
        return created;
      });

      res.status(201).json(profile);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/profile',
  authenticate,
  requireProfileComplete,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;

      if (user.role !== Role.REQUESTOR) {
        res.status(403).json({ error: 'Only Requestors can update their profile' });
        return;
      }

      const { namaLengkap, lokasiKantorId, divisiId, unitBisnisId } =
        req.body as {
          namaLengkap?: string;
          lokasiKantorId?: string;
          divisiId?: string;
          unitBisnisId?: string;
        };

      const updateData: Record<string, unknown> = {};

      if (namaLengkap !== undefined) {
        updateData.namaLengkap = namaLengkap;
      }

      if (lokasiKantorId !== undefined) {
        const lok = await prisma.lokasiKantor.findUnique({ where: { id: lokasiKantorId } });
        if (!lok) {
          res.status(400).json({ error: 'Invalid lokasiKantorId' });
          return;
        }
        updateData.lokasiKantorId = lokasiKantorId;
      }

      if (divisiId !== undefined) {
        const div = await prisma.divisi.findUnique({ where: { id: divisiId } });
        if (!div) {
          res.status(400).json({ error: 'Invalid divisiId' });
          return;
        }
        updateData.divisiId = divisiId;
      }

      if (unitBisnisId !== undefined) {
        const ub = await prisma.unitBisnis.findUnique({ where: { id: unitBisnisId } });
        if (!ub) {
          res.status(400).json({ error: 'Invalid unitBisnisId' });
          return;
        }
        updateData.unitBisnisId = unitBisnisId;
      }

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({ error: 'At least one field must be provided' });
        return;
      }

      const profile = await prisma.requestorProfile.update({
        where: { userId: user.id },
        data: updateData,
      });

      res.json(profile);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
