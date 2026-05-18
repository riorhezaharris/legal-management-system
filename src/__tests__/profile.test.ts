import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { requireProfileComplete } from '../middleware/auth';
import { Role } from '@prisma/client';

// Partial mock: only stub authenticate, keep real requireProfileComplete + requireRole
let mockCurrentUser: any = {
  id: 'req-id',
  role: 'REQUESTOR',
  isActive: true,
  profileCompleted: false,
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    requestorProfile: {
      create: jest.fn(),
      update: jest.fn(),
    },
    lokasiKantor: { findUnique: jest.fn() },
    divisi: { findUnique: jest.fn() },
    unitBisnis: { findUnique: jest.fn() },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = mockCurrentUser;
      next();
    },
  };
});

const mockProfile = prisma.requestorProfile as jest.Mocked<typeof prisma.requestorProfile>;
const mockLK = (prisma as any).lokasiKantor as { findUnique: jest.Mock };
const mockDiv = (prisma as any).divisi as { findUnique: jest.Mock };
const mockUB = (prisma as any).unitBisnis as { findUnique: jest.Mock };
const mockTx = prisma.$transaction as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true, profileCompleted: false };
});

// ─── requireProfileComplete unit tests ────────────────────────────────────────

describe('requireProfileComplete middleware', () => {
  const res = () => {
    const r: any = {};
    r.status = jest.fn().mockReturnValue(r);
    r.json = jest.fn().mockReturnValue(r);
    return r;
  };

  it('blocks REQUESTOR with profileCompleted=false', () => {
    const req: any = { user: { role: Role.REQUESTOR, profileCompleted: false } };
    const mockRes = res();
    const next = jest.fn();
    requireProfileComplete(req, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ code: 'PROFILE_INCOMPLETE' });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes REQUESTOR with profileCompleted=true', () => {
    const req: any = { user: { role: Role.REQUESTOR, profileCompleted: true } };
    const mockRes = res();
    const next = jest.fn();
    requireProfileComplete(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('passes IT_ADMIN regardless of profileCompleted', () => {
    const req: any = { user: { role: Role.IT_ADMIN, profileCompleted: false } };
    const mockRes = res();
    const next = jest.fn();
    requireProfileComplete(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes LEGAL_TEAM regardless of profileCompleted', () => {
    const req: any = { user: { role: Role.LEGAL_TEAM, profileCompleted: false } };
    const mockRes = res();
    const next = jest.fn();
    requireProfileComplete(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes when req.user is undefined', () => {
    const req: any = {};
    const mockRes = res();
    const next = jest.fn();
    requireProfileComplete(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── POST /auth/complete-profile ──────────────────────────────────────────────

describe('POST /auth/complete-profile', () => {
  const validBody = {
    namaLengkap: 'Budi Santoso',
    lokasiKantorId: 'lk-1',
    divisiId: 'div-1',
    unitBisnisId: 'ub-1',
  };

  const createdProfile = {
    id: 'profile-1',
    userId: 'req-id',
    namaLengkap: 'Budi Santoso',
    lokasiKantorId: 'lk-1',
    divisiId: 'div-1',
    unitBisnisId: 'ub-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setupValidRefs() {
    mockLK.findUnique.mockResolvedValue({ id: 'lk-1', name: 'Jakarta' });
    mockDiv.findUnique.mockResolvedValue({ id: 'div-1', name: 'Finance', code: 'FIN' });
    mockUB.findUnique.mockResolvedValue({ id: 'ub-1', name: 'Unit A' });
    mockTx.mockImplementation(async (fn: any) => fn(prisma));
    mockProfile.create.mockResolvedValue(createdProfile as any);
  }

  it('creates profile and returns 201 for REQUESTOR with incomplete profile', async () => {
    setupValidRefs();

    const res = await request(app).post('/auth/complete-profile').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('req-id');
    expect(res.body.namaLengkap).toBe('Budi Santoso');
    expect(mockProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 'req-id',
        namaLengkap: 'Budi Santoso',
        lokasiKantorId: 'lk-1',
        divisiId: 'div-1',
        unitBisnisId: 'ub-1',
      },
    });
    expect((prisma as any).user.update).toHaveBeenCalledWith({
      where: { id: 'req-id' },
      data: { profileCompleted: true },
    });
  });

  it('returns 409 when profile already completed', async () => {
    mockCurrentUser = { ...mockCurrentUser, profileCompleted: true };

    const res = await request(app).post('/auth/complete-profile').send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already completed/i);
  });

  it('returns 403 for non-REQUESTOR roles', async () => {
    mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true, profileCompleted: false };

    const res = await request(app).post('/auth/complete-profile').send(validBody);

    expect(res.status).toBe(403);
  });

  it('returns 400 when namaLengkap is missing', async () => {
    const { namaLengkap: _, ...body } = validBody;
    const res = await request(app).post('/auth/complete-profile').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when lokasiKantorId is missing', async () => {
    const { lokasiKantorId: _, ...body } = validBody;
    const res = await request(app).post('/auth/complete-profile').send(body);
    expect(res.status).toBe(400);
  });

  it('returns 400 when divisiId is missing', async () => {
    const { divisiId: _, ...body } = validBody;
    const res = await request(app).post('/auth/complete-profile').send(body);
    expect(res.status).toBe(400);
  });

  it('returns 400 when unitBisnisId is missing', async () => {
    const { unitBisnisId: _, ...body } = validBody;
    const res = await request(app).post('/auth/complete-profile').send(body);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid lokasiKantorId', async () => {
    mockLK.findUnique.mockResolvedValue(null);
    mockDiv.findUnique.mockResolvedValue({ id: 'div-1' });
    mockUB.findUnique.mockResolvedValue({ id: 'ub-1' });

    const res = await request(app).post('/auth/complete-profile').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lokasiKantorId/i);
  });

  it('returns 400 for invalid divisiId', async () => {
    mockLK.findUnique.mockResolvedValue({ id: 'lk-1' });
    mockDiv.findUnique.mockResolvedValue(null);
    mockUB.findUnique.mockResolvedValue({ id: 'ub-1' });

    const res = await request(app).post('/auth/complete-profile').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/divisiId/i);
  });

  it('returns 400 for invalid unitBisnisId', async () => {
    mockLK.findUnique.mockResolvedValue({ id: 'lk-1' });
    mockDiv.findUnique.mockResolvedValue({ id: 'div-1' });
    mockUB.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/auth/complete-profile').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unitBisnisId/i);
  });
});

// ─── PATCH /auth/profile ──────────────────────────────────────────────────────

describe('PATCH /auth/profile', () => {
  beforeEach(() => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true, profileCompleted: true };
  });

  const updatedProfile = {
    id: 'profile-1',
    userId: 'req-id',
    namaLengkap: 'Budi Updated',
    lokasiKantorId: 'lk-1',
    divisiId: 'div-1',
    unitBisnisId: 'ub-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('updates namaLengkap only', async () => {
    mockProfile.update.mockResolvedValue(updatedProfile as any);

    const res = await request(app)
      .patch('/auth/profile')
      .send({ namaLengkap: 'Budi Updated' });

    expect(res.status).toBe(200);
    expect(mockProfile.update).toHaveBeenCalledWith({
      where: { userId: 'req-id' },
      data: { namaLengkap: 'Budi Updated' },
    });
  });

  it('updates lokasiKantorId after FK validation', async () => {
    mockLK.findUnique.mockResolvedValue({ id: 'lk-2', name: 'Surabaya' });
    mockProfile.update.mockResolvedValue({ ...updatedProfile, lokasiKantorId: 'lk-2' } as any);

    const res = await request(app)
      .patch('/auth/profile')
      .send({ lokasiKantorId: 'lk-2' });

    expect(res.status).toBe(200);
    expect(mockProfile.update).toHaveBeenCalledWith({
      where: { userId: 'req-id' },
      data: { lokasiKantorId: 'lk-2' },
    });
  });

  it('updates divisiId after FK validation', async () => {
    mockDiv.findUnique.mockResolvedValue({ id: 'div-2', name: 'HR', code: 'HR' });
    mockProfile.update.mockResolvedValue({ ...updatedProfile, divisiId: 'div-2' } as any);

    const res = await request(app).patch('/auth/profile').send({ divisiId: 'div-2' });

    expect(res.status).toBe(200);
    expect(mockProfile.update).toHaveBeenCalledWith({
      where: { userId: 'req-id' },
      data: { divisiId: 'div-2' },
    });
  });

  it('updates unitBisnisId after FK validation', async () => {
    mockUB.findUnique.mockResolvedValue({ id: 'ub-2', name: 'Unit B' });
    mockProfile.update.mockResolvedValue({ ...updatedProfile, unitBisnisId: 'ub-2' } as any);

    const res = await request(app).patch('/auth/profile').send({ unitBisnisId: 'ub-2' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when no fields provided', async () => {
    const res = await request(app).patch('/auth/profile').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one field/i);
  });

  it('returns 400 for invalid lokasiKantorId', async () => {
    mockLK.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/auth/profile').send({ lokasiKantorId: 'bad-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lokasiKantorId/i);
  });

  it('returns 400 for invalid divisiId', async () => {
    mockDiv.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/auth/profile').send({ divisiId: 'bad-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/divisiId/i);
  });

  it('returns 400 for invalid unitBisnisId', async () => {
    mockUB.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/auth/profile').send({ unitBisnisId: 'bad-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unitBisnisId/i);
  });

  it('returns 403 PROFILE_INCOMPLETE for REQUESTOR with profileCompleted=false', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true, profileCompleted: false };

    const res = await request(app).patch('/auth/profile').send({ namaLengkap: 'Test' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROFILE_INCOMPLETE');
  });

  it('returns 403 for non-REQUESTOR role', async () => {
    mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true, profileCompleted: false };

    const res = await request(app).patch('/auth/profile').send({ namaLengkap: 'Test' });

    expect(res.status).toBe(403);
  });
});
