import { Router, Request, Response, NextFunction } from 'express';
import { Role, KybStatus } from '@prisma/client';
import { authenticate, requireProfileComplete, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/storage';
import { resend } from '../lib/resend';

const router = Router();

const ALLOWED_ROLES = [Role.REQUESTOR, Role.IT_ADMIN, Role.LEGAL_TEAM];

router.get(
  '/',
  authenticate,
  requireProfileComplete,
  requireRole(...ALLOWED_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name } = req.query as { name?: string };

      const vendors = await prisma.vendor.findMany({
        where: {
          isActive: true,
          ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          kybStatus: true,
        },
        orderBy: { name: 'asc' },
      });

      res.json(vendors);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/invite',
  authenticate,
  requireProfileComplete,
  requireRole(...ALLOWED_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email?: string };

      if (!email) {
        res.status(400).json({ error: 'email is required' });
        return;
      }

      const existing = await prisma.vendor.findUnique({ where: { email } });
      if (existing) {
        if (!existing.isActive) {
          res.status(409).json({ error: 'Vendor is deactivated and cannot be re-invited' });
          return;
        }
        res.status(200).json(existing);
        return;
      }

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email,
      });

      if (linkError || !linkData) {
        res.status(400).json({ error: linkError?.message ?? 'Failed to provision vendor account' });
        return;
      }

      const supabaseId = linkData.user.id;
      const inviteLink = linkData.properties.action_link;

      await supabase.auth.admin.updateUserById(supabaseId, {
        app_metadata: { role: 'VENDOR' },
      });

      const vendor = await prisma.vendor.create({
        data: {
          supabaseId,
          email,
          name: email,
          kybStatus: KybStatus.INVITED,
        },
      });

      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
          to: email,
          subject: 'Undangan Onboarding Vendor — Sistem Manajemen Legal',
          html: `
            <p>Anda diundang untuk mendaftar sebagai Vendor di Sistem Manajemen Legal Cikal.</p>
            <p>Klik tautan berikut untuk mengatur kata sandi dan melengkapi profil KYB Anda:</p>
            <p><a href="${inviteLink}">Aktifkan Akun Anda</a></p>
            <p>Tautan ini hanya berlaku selama 24 jam.</p>
          `,
        });
      } catch (emailErr) {
        console.error('Failed to send vendor invitation email:', emailErr);
      }

      res.status(201).json(vendor);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
