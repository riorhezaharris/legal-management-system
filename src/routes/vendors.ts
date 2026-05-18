import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { Role, KybStatus, KybDocumentType, VendorType } from '@prisma/client';
import { authenticate, requireProfileComplete, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { supabase, storage } from '../lib/storage';
import { resend } from '../lib/resend';

const router = Router();

const ALLOWED_ROLES = [Role.REQUESTOR, Role.IT_ADMIN, Role.LEGAL_TEAM];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const KYB_UPLOAD_FIELDS = Object.values(KybDocumentType).map(t => ({ name: t, maxCount: 1 }));

const BADAN_REQUIRED: KybDocumentType[] = [
  KybDocumentType.AKTA_PENDIRIAN,
  KybDocumentType.SK_PENDIRIAN,
  KybDocumentType.NIB,
  KybDocumentType.KTP_PENANGGUNG_JAWAB,
  KybDocumentType.NPWP_BADAN,
  KybDocumentType.AKTA_PERUBAHAN_DIREKSI,
  KybDocumentType.SK_PERUBAHAN_DIREKSI,
];

const PERORANGAN_REQUIRED: KybDocumentType[] = [
  KybDocumentType.KTP,
  KybDocumentType.NPWP,
];

function parseKybFiles(req: Request, res: Response, next: NextFunction): void {
  upload.fields(KYB_UPLOAD_FIELDS)(req, res, (err) => {
    if (err) {
      if ((err as any).code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File too large. Maximum size is 20MB per file.' });
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

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

router.get(
  '/:id/kyb',
  authenticate,
  requireRole(Role.VENDOR, Role.LEGAL_TEAM, Role.IT_ADMIN),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const vendor = await prisma.vendor.findUnique({
        where: { id },
        include: {
          kybDocuments: true,
          kybReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      if (req.user!.role === Role.VENDOR && req.user!.id !== id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      res.json({
        kybStatus: vendor.kybStatus,
        type: vendor.type,
        address: vendor.address,
        documents: vendor.kybDocuments,
        latestReview: vendor.kybReviews[0] ?? null,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/kyb',
  authenticate,
  requireRole(Role.VENDOR),
  parseKybFiles,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { type, address } = req.body as { type?: string; address?: string };

      const vendor = await prisma.vendor.findUnique({ where: { id } });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      if (req.user!.id !== id) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const allowedFromStatuses: KybStatus[] = [KybStatus.INVITED, KybStatus.REVISION, KybStatus.APPROVED];
      if (!allowedFromStatuses.includes(vendor.kybStatus)) {
        res.status(400).json({ error: `Cannot submit KYB from status ${vendor.kybStatus}` });
        return;
      }

      const vendorType = (type as VendorType | undefined) ?? vendor.type;
      if (!vendorType || !Object.values(VendorType).includes(vendorType as VendorType)) {
        res.status(400).json({ error: 'Vendor type (BADAN or PERORANGAN) is required' });
        return;
      }

      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const required = vendorType === VendorType.BADAN ? BADAN_REQUIRED : PERORANGAN_REQUIRED;
      for (const docType of required) {
        if (!files[docType]?.length) {
          res.status(400).json({ error: `Missing required document: ${docType}` });
          return;
        }
      }

      const docRecords: Array<{
        vendorId: string;
        documentType: KybDocumentType;
        fileUrl: string;
        fileName: string;
        fileSize: number;
      }> = [];

      for (const docType of Object.values(KybDocumentType)) {
        const fileArr = files[docType];
        if (!fileArr?.length) continue;

        const file = fileArr[0];
        const dotIdx = file.originalname.lastIndexOf('.');
        const ext = dotIdx !== -1 ? file.originalname.slice(dotIdx + 1) : 'bin';
        const filePath = `kyb/${id}/${docType}-${Date.now()}.${ext}`;

        const { error: uploadError } = await storage
          .from('kyb-documents')
          .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true });

        if (uploadError) {
          res.status(500).json({ error: `Failed to upload ${docType}: ${uploadError.message}` });
          return;
        }

        const { data: urlData } = storage.from('kyb-documents').getPublicUrl(filePath);
        docRecords.push({
          vendorId: id,
          documentType: docType as KybDocumentType,
          fileUrl: urlData.publicUrl,
          fileName: file.originalname,
          fileSize: file.size,
        });
      }

      const isFirstSubmission = vendor.kybStatus === KybStatus.INVITED;
      const isRevisionResubmission = vendor.kybStatus === KybStatus.REVISION;

      await prisma.$transaction(async (tx) => {
        await tx.kybDocument.deleteMany({ where: { vendorId: id } });
        if (docRecords.length > 0) {
          await tx.kybDocument.createMany({ data: docRecords });
        }
        await tx.vendor.update({
          where: { id },
          data: {
            kybStatus: KybStatus.SUBMITTED,
            type: vendorType as VendorType,
            ...(address ? { address } : {}),
          },
        });
      });

      const legalUsers = await prisma.user.findMany({
        where: { role: Role.LEGAL_TEAM, isActive: true },
        select: { email: true },
      });

      const subject = isRevisionResubmission
        ? `Vendor Re-submitted KYB After Revision — ${vendor.name}`
        : isFirstSubmission
          ? `Vendor KYB Submitted — ${vendor.name}`
          : `Vendor Updated KYB Documents — ${vendor.name}`;
      const body = isRevisionResubmission
        ? `Vendor <strong>${vendor.name}</strong> (${vendor.email}) telah mengajukan ulang dokumen KYB setelah revisi.`
        : `Vendor <strong>${vendor.name}</strong> (${vendor.email}) telah mengajukan dokumen KYB dan menunggu tinjauan.`;

      for (const { email } of legalUsers) {
        resend.emails
          .send({
            from: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
            to: email,
            subject,
            html: `<p>${body}</p>`,
          })
          .catch(err => console.error('Failed to send KYB notification email:', err));
      }

      const updatedVendor = await prisma.vendor.findUnique({
        where: { id },
        include: {
          kybDocuments: true,
          kybReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      res.json(updatedVendor);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/kyb/revision',
  authenticate,
  requireRole(Role.LEGAL_TEAM),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { remarks } = req.body as { remarks?: string };

      if (!remarks?.trim()) {
        res.status(400).json({ error: 'remarks is required' });
        return;
      }

      const vendor = await prisma.vendor.findUnique({ where: { id } });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      if (vendor.kybStatus !== KybStatus.SUBMITTED) {
        res.status(400).json({ error: `Cannot request revision from status ${vendor.kybStatus}` });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.kybReview.create({
          data: {
            vendorId: id,
            remarks: remarks.trim(),
            createdById: req.user!.id,
          },
        });
        await tx.vendor.update({
          where: { id },
          data: { kybStatus: KybStatus.REVISION },
        });
      });

      resend.emails
        .send({
          from: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
          to: vendor.email,
          subject: 'Revisi Dokumen KYB Diperlukan',
          html: `
            <p>Dokumen KYB Anda memerlukan revisi.</p>
            <p><strong>Catatan dari Legal Team:</strong></p>
            <blockquote>${remarks.trim()}</blockquote>
            <p>Silakan lengkapi dokumen Anda dan ajukan ulang.</p>
          `,
        })
        .catch(err => console.error('Failed to send revision email to vendor:', err));

      res.json({ message: 'Revision request sent', kybStatus: KybStatus.REVISION });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/kyb/approve',
  authenticate,
  requireRole(Role.LEGAL_TEAM),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      const vendor = await prisma.vendor.findUnique({ where: { id } });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      if (vendor.kybStatus !== KybStatus.SUBMITTED) {
        res.status(400).json({ error: `Cannot approve from status ${vendor.kybStatus}` });
        return;
      }

      await prisma.vendor.update({
        where: { id },
        data: { kybStatus: KybStatus.APPROVED },
      });

      res.json({ message: 'KYB approved', kybStatus: KybStatus.APPROVED });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
