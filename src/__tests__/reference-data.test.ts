import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';

let mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true };

jest.mock('../lib/prisma', () => ({
  prisma: {
    lokasiKantor: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    divisi: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    unitBisnis: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    requestorProfile: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../lib/storage', () => ({
  supabase: {
    auth: {
      admin: {
        createUser: jest.fn(),
        updateUserById: jest.fn(),
      },
    },
  },
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockCurrentUser;
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

const mockLK = (prisma as any).lokasiKantor;
const mockDivisi = (prisma as any).divisi;
const mockUB = (prisma as any).unitBisnis;
const mockProfile = (prisma as any).requestorProfile;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true };
});

const lokasiKantorRecord = { id: 'lk-1', name: 'Jakarta', createdAt: new Date(), updatedAt: new Date() };
const divisiRecord = { id: 'd-1', name: 'Finance', code: 'FIN', createdAt: new Date(), updatedAt: new Date() };
const unitBisnisRecord = { id: 'ub-1', name: 'Operations', createdAt: new Date(), updatedAt: new Date() };

// ===================== LokasiKantor =====================

describe('GET /admin/lokasi-kantor', () => {
  it('returns all lokasi kantor entries', async () => {
    mockLK.findMany.mockResolvedValue([lokasiKantorRecord]);

    const res = await request(app).get('/admin/lokasi-kantor');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Jakarta');
    expect(mockLK.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
  });

  it('returns 403 for REQUESTOR', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).get('/admin/lokasi-kantor');
    expect(res.status).toBe(403);
  });

  it('returns 403 for LEGAL_TEAM', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true };
    const res = await request(app).get('/admin/lokasi-kantor');
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/lokasi-kantor', () => {
  it('creates a LokasiKantor entry', async () => {
    mockLK.create.mockResolvedValue(lokasiKantorRecord);

    const res = await request(app).post('/admin/lokasi-kantor').send({ name: 'Jakarta' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Jakarta');
    expect(mockLK.create).toHaveBeenCalledWith({ data: { name: 'Jakarta' } });
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/admin/lokasi-kantor').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).post('/admin/lokasi-kantor').send({ name: 'Jakarta' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /admin/lokasi-kantor/:id', () => {
  it('updates a LokasiKantor entry', async () => {
    mockLK.findUnique.mockResolvedValue(lokasiKantorRecord);
    mockLK.update.mockResolvedValue({ ...lokasiKantorRecord, name: 'Bandung' });

    const res = await request(app).patch('/admin/lokasi-kantor/lk-1').send({ name: 'Bandung' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bandung');
  });

  it('returns 404 for non-existent entry', async () => {
    mockLK.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/admin/lokasi-kantor/nonexistent').send({ name: 'Bandung' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).patch('/admin/lokasi-kantor/lk-1').send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /admin/lokasi-kantor/:id', () => {
  it('deletes a LokasiKantor entry', async () => {
    mockLK.findUnique.mockResolvedValue(lokasiKantorRecord);
    mockProfile.findFirst.mockResolvedValue(null);
    mockLK.delete.mockResolvedValue(lokasiKantorRecord);

    const res = await request(app).delete('/admin/lokasi-kantor/lk-1');

    expect(res.status).toBe(204);
    expect(mockLK.delete).toHaveBeenCalledWith({ where: { id: 'lk-1' } });
  });

  it('returns 409 when entry is referenced by a profile', async () => {
    mockLK.findUnique.mockResolvedValue(lokasiKantorRecord);
    mockProfile.findFirst.mockResolvedValue({ id: 'profile-1' });

    const res = await request(app).delete('/admin/lokasi-kantor/lk-1');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/referenced/i);
    expect(mockLK.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent entry', async () => {
    mockLK.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/admin/lokasi-kantor/nonexistent');

    expect(res.status).toBe(404);
  });
});

// ===================== Divisi =====================

describe('GET /admin/divisi', () => {
  it('returns all divisi entries', async () => {
    mockDivisi.findMany.mockResolvedValue([divisiRecord]);

    const res = await request(app).get('/admin/divisi');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toBe('FIN');
  });

  it('returns 403 for REQUESTOR', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).get('/admin/divisi');
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/divisi', () => {
  it('creates a Divisi entry', async () => {
    mockDivisi.findUnique.mockResolvedValue(null);
    mockDivisi.create.mockResolvedValue(divisiRecord);

    const res = await request(app).post('/admin/divisi').send({ name: 'Finance', code: 'FIN' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe('FIN');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/admin/divisi').send({ code: 'FIN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when code is missing', async () => {
    const res = await request(app).post('/admin/divisi').send({ name: 'Finance' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for lowercase code', async () => {
    const res = await request(app).post('/admin/divisi').send({ name: 'Finance', code: 'fin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase alphanumeric/i);
  });

  it('returns 400 for code exceeding 5 characters', async () => {
    const res = await request(app).post('/admin/divisi').send({ name: 'Finance', code: 'TOOLONG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 5/i);
  });

  it('returns 400 for code with special characters', async () => {
    const res = await request(app).post('/admin/divisi').send({ name: 'Finance', code: 'FI-N' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when code already exists', async () => {
    mockDivisi.findUnique.mockResolvedValue(divisiRecord);

    const res = await request(app).post('/admin/divisi').send({ name: 'Finance 2', code: 'FIN' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('allows alphanumeric code with digits', async () => {
    mockDivisi.findUnique.mockResolvedValue(null);
    mockDivisi.create.mockResolvedValue({ ...divisiRecord, code: 'FIN01' });

    const res = await request(app).post('/admin/divisi').send({ name: 'Finance 1', code: 'FIN01' });

    expect(res.status).toBe(201);
  });
});

describe('PATCH /admin/divisi/:id', () => {
  it('updates divisi name only', async () => {
    mockDivisi.findUnique.mockResolvedValueOnce(divisiRecord);
    mockDivisi.update.mockResolvedValue({ ...divisiRecord, name: 'Financial' });

    const res = await request(app).patch('/admin/divisi/d-1').send({ name: 'Financial' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Financial');
  });

  it('updates divisi code only', async () => {
    mockDivisi.findUnique
      .mockResolvedValueOnce(divisiRecord)
      .mockResolvedValueOnce(null);
    mockDivisi.update.mockResolvedValue({ ...divisiRecord, code: 'FINAN' });

    const res = await request(app).patch('/admin/divisi/d-1').send({ code: 'FINAN' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('FINAN');
  });

  it('allows updating to the same code (no conflict)', async () => {
    mockDivisi.findUnique.mockResolvedValueOnce(divisiRecord);
    mockDivisi.update.mockResolvedValue({ ...divisiRecord, name: 'Updated Finance' });

    const res = await request(app).patch('/admin/divisi/d-1').send({ name: 'Updated Finance', code: 'FIN' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when neither name nor code provided', async () => {
    const res = await request(app).patch('/admin/divisi/d-1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one/i);
  });

  it('returns 400 for invalid code format', async () => {
    const res = await request(app).patch('/admin/divisi/d-1').send({ code: 'lower' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent divisi', async () => {
    mockDivisi.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/admin/divisi/nonexistent').send({ name: 'New Name' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when new code conflicts with another divisi', async () => {
    const anotherDivisi = { ...divisiRecord, id: 'd-2', code: 'HR' };
    mockDivisi.findUnique
      .mockResolvedValueOnce(divisiRecord)
      .mockResolvedValueOnce(anotherDivisi);

    const res = await request(app).patch('/admin/divisi/d-1').send({ code: 'HR' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

describe('DELETE /admin/divisi/:id', () => {
  it('deletes a Divisi entry', async () => {
    mockDivisi.findUnique.mockResolvedValue(divisiRecord);
    mockProfile.findFirst.mockResolvedValue(null);
    mockDivisi.delete.mockResolvedValue(divisiRecord);

    const res = await request(app).delete('/admin/divisi/d-1');

    expect(res.status).toBe(204);
  });

  it('returns 409 when divisi is referenced by a profile', async () => {
    mockDivisi.findUnique.mockResolvedValue(divisiRecord);
    mockProfile.findFirst.mockResolvedValue({ id: 'profile-1' });

    const res = await request(app).delete('/admin/divisi/d-1');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/referenced/i);
    expect(mockDivisi.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent divisi', async () => {
    mockDivisi.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/admin/divisi/nonexistent');

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true };
    const res = await request(app).delete('/admin/divisi/d-1');
    expect(res.status).toBe(403);
  });
});

// ===================== UnitBisnis =====================

describe('GET /admin/unit-bisnis', () => {
  it('returns all unit bisnis entries', async () => {
    mockUB.findMany.mockResolvedValue([unitBisnisRecord]);

    const res = await request(app).get('/admin/unit-bisnis');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Operations');
  });

  it('returns 403 for REQUESTOR', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).get('/admin/unit-bisnis');
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/unit-bisnis', () => {
  it('creates a UnitBisnis entry', async () => {
    mockUB.create.mockResolvedValue(unitBisnisRecord);

    const res = await request(app).post('/admin/unit-bisnis').send({ name: 'Operations' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Operations');
    expect(mockUB.create).toHaveBeenCalledWith({ data: { name: 'Operations' } });
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/admin/unit-bisnis').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).post('/admin/unit-bisnis').send({ name: 'Operations' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /admin/unit-bisnis/:id', () => {
  it('updates a UnitBisnis entry', async () => {
    mockUB.findUnique.mockResolvedValue(unitBisnisRecord);
    mockUB.update.mockResolvedValue({ ...unitBisnisRecord, name: 'Logistics' });

    const res = await request(app).patch('/admin/unit-bisnis/ub-1').send({ name: 'Logistics' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Logistics');
  });

  it('returns 404 for non-existent entry', async () => {
    mockUB.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/admin/unit-bisnis/nonexistent').send({ name: 'Logistics' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).patch('/admin/unit-bisnis/ub-1').send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /admin/unit-bisnis/:id', () => {
  it('deletes a UnitBisnis entry', async () => {
    mockUB.findUnique.mockResolvedValue(unitBisnisRecord);
    mockProfile.findFirst.mockResolvedValue(null);
    mockUB.delete.mockResolvedValue(unitBisnisRecord);

    const res = await request(app).delete('/admin/unit-bisnis/ub-1');

    expect(res.status).toBe(204);
    expect(mockUB.delete).toHaveBeenCalledWith({ where: { id: 'ub-1' } });
  });

  it('returns 409 when entry is referenced by a profile', async () => {
    mockUB.findUnique.mockResolvedValue(unitBisnisRecord);
    mockProfile.findFirst.mockResolvedValue({ id: 'profile-1' });

    const res = await request(app).delete('/admin/unit-bisnis/ub-1');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/referenced/i);
    expect(mockUB.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent entry', async () => {
    mockUB.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/admin/unit-bisnis/nonexistent');

    expect(res.status).toBe(404);
  });
});
