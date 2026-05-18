import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/storage';

let mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true, profileCompleted: true };

jest.mock('../lib/prisma', () => {
  const prismaMock: any = {
    vendor: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    kybDocument: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  return { prisma: prismaMock };
});

jest.mock('../lib/storage', () => ({
  supabase: {
    auth: {
      admin: {
        updateUserById: jest.fn(),
      },
    },
  },
  storage: { from: jest.fn() },
}));

jest.mock('../lib/resend', () => ({
  resend: { emails: { send: jest.fn() } },
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockCurrentUser;
    next();
  },
  requireProfileComplete: (_req: any, _res: any, next: any) => next(),
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

const mockVendor = prisma.vendor as jest.Mocked<typeof prisma.vendor>;
const mockKybDocument = prisma.kybDocument as jest.Mocked<typeof prisma.kybDocument>;
const mockAuthAdmin = (supabase as any).auth.admin;

const baseVendor = {
  id: 'vendor-1',
  supabaseId: 'sb-vendor-1',
  email: 'vendor@example.com',
  name: 'Test Vendor',
  address: '123 Main St',
  type: 'PERORANGAN',
  kybStatus: 'APPROVED',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true, profileCompleted: true };
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
  mockKybDocument.deleteMany.mockResolvedValue({ count: 0 } as any);
});

// ─────────────────────────────────────────────────────────────────
// PATCH /vendors/:id/deactivate
// ─────────────────────────────────────────────────────────────────

describe('PATCH /vendors/:id/deactivate', () => {
  it('deactivates vendor and disables Supabase Auth account', async () => {
    const deactivatedVendor = { ...baseVendor, isActive: false };
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockVendor.update.mockResolvedValue(deactivatedVendor as any);
    mockAuthAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });

    const res = await request(app).patch('/vendors/vendor-1/deactivate');

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect(mockVendor.update).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
      data: { isActive: false },
    });
    expect(mockAuthAdmin.updateUserById).toHaveBeenCalledWith('sb-vendor-1', {
      ban_duration: '876600h',
    });
  });

  it('skips Supabase ban when vendor has no supabaseId', async () => {
    const vendorNoAuth = { ...baseVendor, supabaseId: null };
    mockVendor.findUnique.mockResolvedValue(vendorNoAuth as any);
    mockVendor.update.mockResolvedValue({ ...vendorNoAuth, isActive: false } as any);

    const res = await request(app).patch('/vendors/vendor-1/deactivate');

    expect(res.status).toBe(200);
    expect(mockAuthAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it('still deactivates in Prisma even if Supabase ban fails', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockVendor.update.mockResolvedValue({ ...baseVendor, isActive: false } as any);
    mockAuthAdmin.updateUserById.mockRejectedValue(new Error('Supabase error'));

    const res = await request(app).patch('/vendors/vendor-1/deactivate');

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('returns 404 for non-existent vendor', async () => {
    mockVendor.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/vendors/nonexistent/deactivate');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app).patch('/vendors/vendor-1/deactivate');

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 403 for LEGAL_TEAM role', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };

    const res = await request(app).patch('/vendors/vendor-1/deactivate');

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };

    const res = await request(app).patch('/vendors/vendor-1/deactivate');

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /vendors/:id/kyb/reset
// ─────────────────────────────────────────────────────────────────

describe('POST /vendors/:id/kyb/reset', () => {
  it('resets KYB status to INVITED and deletes all KybDocuments', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockVendor.update.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED' } as any);

    const res = await request(app).post('/vendors/vendor-1/kyb/reset');

    expect(res.status).toBe(200);
    expect(res.body.kybStatus).toBe('INVITED');
    expect(mockKybDocument.deleteMany).toHaveBeenCalledWith({ where: { vendorId: 'vendor-1' } });
    expect(mockVendor.update).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
      data: { kybStatus: 'INVITED' },
    });
  });

  it('runs delete and update in a transaction', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockVendor.update.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED' } as any);

    await request(app).post('/vendors/vendor-1/kyb/reset');

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('works regardless of current KYB status', async () => {
    for (const kybStatus of ['INVITED', 'SUBMITTED', 'REVISION', 'APPROVED']) {
      mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus } as any);
      mockVendor.update.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED' } as any);

      const res = await request(app).post('/vendors/vendor-1/kyb/reset');

      expect(res.status).toBe(200);
      expect(res.body.kybStatus).toBe('INVITED');
    }
  });

  it('returns 404 for non-existent vendor', async () => {
    mockVendor.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/vendors/nonexistent/kyb/reset');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app).post('/vendors/vendor-1/kyb/reset');

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 403 for LEGAL_TEAM role', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };

    const res = await request(app).post('/vendors/vendor-1/kyb/reset');

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };

    const res = await request(app).post('/vendors/vendor-1/kyb/reset');

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });
});
