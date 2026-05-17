import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';

let mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true };

jest.mock('../lib/prisma', () => ({
  prisma: {
    slaConfig: {
      upsert: jest.fn(),
    },
    holiday: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
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

const mockSlaConfig = (prisma as any).slaConfig;
const mockHoliday = (prisma as any).holiday;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true };
});

const slaConfigRecord = { id: 'singleton', workingDays: 5, updatedAt: new Date() };
const holidayRecord = {
  id: 'h-1',
  date: new Date('2026-01-01'),
  description: "New Year's Day",
  type: 'NATIONAL',
  createdAt: new Date(),
};

// ===================== SLA Config =====================

describe('GET /admin/sla-config', () => {
  it('returns current SLA config', async () => {
    mockSlaConfig.upsert.mockResolvedValue(slaConfigRecord);

    const res = await request(app).get('/admin/sla-config');

    expect(res.status).toBe(200);
    expect(res.body.workingDays).toBe(5);
    expect(mockSlaConfig.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: { id: 'singleton', workingDays: 5 },
      update: {},
    });
  });

  it('returns 403 for REQUESTOR', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).get('/admin/sla-config');
    expect(res.status).toBe(403);
  });

  it('returns 403 for LEGAL_TEAM', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true };
    const res = await request(app).get('/admin/sla-config');
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/sla-config', () => {
  it('updates the SLA working days', async () => {
    mockSlaConfig.upsert.mockResolvedValue({ ...slaConfigRecord, workingDays: 7 });

    const res = await request(app).post('/admin/sla-config').send({ workingDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.workingDays).toBe(7);
    expect(mockSlaConfig.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: { id: 'singleton', workingDays: 7 },
      update: { workingDays: 7 },
    });
  });

  it('returns 400 when workingDays is missing', async () => {
    const res = await request(app).post('/admin/sla-config').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workingDays/i);
  });

  it('returns 400 for zero', async () => {
    const res = await request(app).post('/admin/sla-config').send({ workingDays: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it('returns 400 for negative value', async () => {
    const res = await request(app).post('/admin/sla-config').send({ workingDays: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer', async () => {
    const res = await request(app).post('/admin/sla-config').send({ workingDays: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).post('/admin/sla-config').send({ workingDays: 7 });
    expect(res.status).toBe(403);
  });
});

// ===================== Holidays =====================

describe('GET /admin/holidays', () => {
  it('returns all holidays', async () => {
    mockHoliday.findMany.mockResolvedValue([holidayRecord]);

    const res = await request(app).get('/admin/holidays');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe('NATIONAL');
    expect(mockHoliday.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { date: 'asc' } });
  });

  it('filters by type=NATIONAL', async () => {
    mockHoliday.findMany.mockResolvedValue([holidayRecord]);

    const res = await request(app).get('/admin/holidays?type=NATIONAL');

    expect(res.status).toBe(200);
    expect(mockHoliday.findMany).toHaveBeenCalledWith({
      where: { type: 'NATIONAL' },
      orderBy: { date: 'asc' },
    });
  });

  it('filters by type=CUSTOM', async () => {
    const customHoliday = { ...holidayRecord, id: 'h-2', type: 'CUSTOM' };
    mockHoliday.findMany.mockResolvedValue([customHoliday]);

    const res = await request(app).get('/admin/holidays?type=CUSTOM');

    expect(res.status).toBe(200);
    expect(mockHoliday.findMany).toHaveBeenCalledWith({
      where: { type: 'CUSTOM' },
      orderBy: { date: 'asc' },
    });
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app).get('/admin/holidays?type=INVALID');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NATIONAL or CUSTOM/i);
  });

  it('returns 403 for REQUESTOR', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app).get('/admin/holidays');
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/holidays', () => {
  it('creates a NATIONAL holiday', async () => {
    mockHoliday.findFirst.mockResolvedValue(null);
    mockHoliday.create.mockResolvedValue(holidayRecord);

    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-01-01', description: "New Year's Day", type: 'NATIONAL' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('NATIONAL');
    expect(mockHoliday.create).toHaveBeenCalled();
  });

  it('creates a CUSTOM holiday', async () => {
    const customRecord = { ...holidayRecord, id: 'h-2', type: 'CUSTOM', description: 'Company Outing' };
    mockHoliday.findFirst.mockResolvedValue(null);
    mockHoliday.create.mockResolvedValue(customRecord);

    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-03-15', description: 'Company Outing', type: 'CUSTOM' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('CUSTOM');
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(app)
      .post('/admin/holidays')
      .send({ description: "New Year's Day", type: 'NATIONAL' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when description is missing', async () => {
    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-01-01', type: 'NATIONAL' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when type is missing', async () => {
    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-01-01', description: "New Year's Day" });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-01-01', description: "New Year's Day", type: 'INVALID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NATIONAL or CUSTOM/i);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: 'not-a-date', description: "New Year's Day", type: 'NATIONAL' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid ISO date/i);
  });

  it('returns 409 for duplicate date+type combination', async () => {
    mockHoliday.findFirst.mockResolvedValue(holidayRecord);

    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-01-01', description: 'Another New Year', type: 'NATIONAL' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(mockHoliday.create).not.toHaveBeenCalled();
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };
    const res = await request(app)
      .post('/admin/holidays')
      .send({ date: '2026-01-01', description: "New Year's Day", type: 'NATIONAL' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /admin/holidays/:id', () => {
  it('deletes a holiday', async () => {
    mockHoliday.findUnique.mockResolvedValue(holidayRecord);
    mockHoliday.delete.mockResolvedValue(holidayRecord);

    const res = await request(app).delete('/admin/holidays/h-1');

    expect(res.status).toBe(204);
    expect(mockHoliday.delete).toHaveBeenCalledWith({ where: { id: 'h-1' } });
  });

  it('returns 404 for non-existent holiday', async () => {
    mockHoliday.findUnique.mockResolvedValue(null);

    const res = await request(app).delete('/admin/holidays/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    expect(mockHoliday.delete).not.toHaveBeenCalled();
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true };
    const res = await request(app).delete('/admin/holidays/h-1');
    expect(res.status).toBe(403);
  });
});
