import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

jest.mock('../lib/prisma', () => ({
  prisma: {
    vendor: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

const mockPrismaVendor = (prisma.vendor as jest.Mocked<typeof prisma.vendor>);
const mockPrismaUser = (prisma.user as jest.Mocked<typeof prisma.user>);

const JWT_SECRET = 'test-secret';

function makeApp() {
  const app = express();
  app.use(authenticate);
  app.get('/protected', (_req: Request, res: Response) => {
    res.json({ user: (_req as any).user });
  });
  return app;
}

function signToken(payload: object, secret = JWT_SECRET) {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

function vendorToken(overrides: object = {}) {
  return signToken({ sub: 'sb-vendor-1', app_metadata: { role: 'VENDOR' }, ...overrides });
}

function internalToken(role: string, overrides: object = {}) {
  return signToken({ sub: 'sb-user-1', app_metadata: { role }, ...overrides });
}

const baseVendor = {
  id: 'vendor-db-1',
  supabaseId: 'sb-vendor-1',
  email: 'vendor@example.com',
  isActive: true,
};

const baseUser = {
  id: 'user-db-1',
  supabaseId: 'sb-user-1',
  email: 'user@example.com',
  role: Role.LEGAL_TEAM,
  isActive: true,
  profileCompleted: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
});

afterAll(() => {
  delete process.env.SUPABASE_JWT_SECRET;
});

describe('authenticate — Authorization header validation', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization/i);
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', 'Basic sometoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authorization/i);
  });
});

describe('authenticate — server config', () => {
  it('returns 500 when SUPABASE_JWT_SECRET is not set', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', 'Bearer sometoken');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/misconfiguration/i);
  });
});

describe('authenticate — token validation', () => {
  it('returns 401 when token is invalid', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('returns 401 when token is signed with wrong secret', async () => {
    const token = signToken({ sub: 'sb-user-1', app_metadata: { role: 'IT_ADMIN' } }, 'wrong-secret');
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('returns 401 when token has no role claim', async () => {
    const token = signToken({ sub: 'sb-user-1' });
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/role/i);
  });

  it('picks up role from user_metadata when app_metadata is absent', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(baseUser as any);
    const token = signToken({ sub: 'sb-user-1', user_metadata: { role: 'LEGAL_TEAM' } });
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe(Role.LEGAL_TEAM);
  });
});

describe('authenticate — VENDOR path', () => {
  it('returns 401 when vendor not found in DB', async () => {
    mockPrismaVendor.findUnique.mockResolvedValue(null);
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${vendorToken()}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 403 when vendor is deactivated', async () => {
    mockPrismaVendor.findUnique.mockResolvedValue({ ...baseVendor, isActive: false } as any);
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${vendorToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  it('sets req.user and calls next for active vendor', async () => {
    mockPrismaVendor.findUnique.mockResolvedValue(baseVendor as any);
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${vendorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: baseVendor.id,
      supabaseId: baseVendor.supabaseId,
      email: baseVendor.email,
      role: Role.VENDOR,
      isActive: true,
      profileCompleted: true,
    });
  });
});

describe('authenticate — internal user path', () => {
  it('returns 401 when user not found in DB', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${internalToken('LEGAL_TEAM')}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 403 when user is deactivated', async () => {
    mockPrismaUser.findUnique.mockResolvedValue({ ...baseUser, isActive: false } as any);
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${internalToken('LEGAL_TEAM')}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  it('sets req.user with all fields for active internal user', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(baseUser as any);
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${internalToken('LEGAL_TEAM')}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: baseUser.id,
      supabaseId: baseUser.supabaseId,
      email: baseUser.email,
      role: Role.LEGAL_TEAM,
      isActive: true,
      profileCompleted: true,
    });
  });

  it('passes database error to next(err)', async () => {
    mockPrismaUser.findUnique.mockRejectedValue(new Error('DB connection lost'));
    const errApp = express();
    errApp.use(authenticate);
    errApp.get('/protected', (_req, res) => res.json({ ok: true }));
    errApp.use((err: Error, _req: Request, res: Response, _next: any) => {
      res.status(500).json({ error: err.message });
    });
    const res = await request(errApp)
      .get('/protected')
      .set('Authorization', `Bearer ${internalToken('IT_ADMIN')}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/DB connection lost/);
  });
});

describe('requireRole', () => {
  function makeRoleApp(...roles: Role[]) {
    const app = express();
    app.use((req: any, _res, next) => {
      req.user = { role: Role.IT_ADMIN };
      next();
    });
    app.get('/protected', requireRole(...roles), (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('returns 401 when req.user is not set', async () => {
    const app = express();
    app.get('/protected', requireRole(Role.IT_ADMIN), (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthenticated/i);
  });

  it('returns 403 when user has wrong role', async () => {
    const res = await request(makeRoleApp(Role.LEGAL_TEAM)).get('/protected');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it('calls next when user has the required role', async () => {
    const res = await request(makeRoleApp(Role.IT_ADMIN)).get('/protected');
    expect(res.status).toBe(200);
  });

  it('calls next when user role matches any of the allowed roles', async () => {
    const res = await request(makeRoleApp(Role.LEGAL_TEAM, Role.IT_ADMIN)).get('/protected');
    expect(res.status).toBe(200);
  });
});
