import { Router, Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { authenticate, requireProfileComplete, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/storage';

const router = Router();

router.use(authenticate, requireProfileComplete, requireRole(Role.IT_ADMIN));

router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, role } = req.body as { name?: string; email?: string; role?: string };

    if (!name || !email || !role) {
      res.status(400).json({ error: 'name, email, and role are required' });
      return;
    }

    if (role !== Role.REQUESTOR && role !== Role.LEGAL_TEAM) {
      res.status(400).json({ error: 'role must be REQUESTOR or LEGAL_TEAM' });
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { role },
    });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('unique')) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      res.status(400).json({ error: authError.message });
      return;
    }

    const user = await prisma.user.create({
      data: {
        supabaseId: authData.user.id,
        email,
        name,
        role: role as Role,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// Must be before /:id to avoid Express treating "deactivate" as an id param
router.patch('/:id/deactivate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body as { role?: string };

    if (!role) {
      res.status(400).json({ error: 'role is required' });
      return;
    }

    if (role !== Role.REQUESTOR && role !== Role.LEGAL_TEAM) {
      res.status(400).json({ error: 'role must be REQUESTOR or LEGAL_TEAM' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role: role as Role },
    });

    await supabase.auth.admin.updateUserById(user.supabaseId, {
      app_metadata: { role },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
