import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  role: string;
  app_metadata?: {
    role?: string;
  };
  user_metadata?: {
    role?: string;
  };
  iat: number;
  exp: number;
}

export interface AuthUser {
  id: string;
  supabaseId: string;
  email: string;
  role: Role;
  isActive: boolean;
  profileCompleted: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!jwtSecret) {
    res.status(500).json({ error: 'Server misconfiguration: missing JWT secret' });
    return;
  }

  let payload: SupabaseJwtPayload;
  try {
    payload = jwt.verify(token, jwtSecret) as SupabaseJwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const supabaseId = payload.sub;
  const roleFromToken =
    payload.app_metadata?.role ?? payload.user_metadata?.role;

  if (!roleFromToken) {
    res.status(401).json({ error: 'Token missing role claim' });
    return;
  }

  try {
    if (roleFromToken === 'VENDOR') {
      const vendor = await prisma.vendor.findUnique({
        where: { supabaseId },
      });

      if (!vendor) {
        res.status(401).json({ error: 'Vendor account not found' });
        return;
      }

      if (!vendor.isActive) {
        res.status(403).json({ error: 'Account is deactivated' });
        return;
      }

      req.user = {
        id: vendor.id,
        supabaseId: vendor.supabaseId!,
        email: vendor.email,
        role: Role.VENDOR,
        isActive: vendor.isActive,
        profileCompleted: true,
      };
    } else {
      const user = await prisma.user.findUnique({
        where: { supabaseId },
      });

      if (!user) {
        res.status(401).json({ error: 'User account not found' });
        return;
      }

      if (!user.isActive) {
        res.status(403).json({ error: 'Account is deactivated' });
        return;
      }

      req.user = {
        id: user.id,
        supabaseId: user.supabaseId,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        profileCompleted: user.profileCompleted,
      };
    }

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}

export function requireProfileComplete(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.role !== Role.REQUESTOR) {
    next();
    return;
  }

  if (!req.user.profileCompleted) {
    res.status(403).json({ code: 'PROFILE_INCOMPLETE' });
    return;
  }

  next();
}
