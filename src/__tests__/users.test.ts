import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/storage';

// Variables prefixed with 'mock' are exempt from jest hoisting restrictions
let mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true };

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
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
  requireProfileComplete: (_req: any, _res: any, next: any) => next(),
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

const mockPrismaUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockAuthAdmin = (supabase as any).auth.admin;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true };
});

describe('POST /users', () => {
  it('creates a REQUESTOR user successfully', async () => {
    mockAuthAdmin.createUser.mockResolvedValue({
      data: { user: { id: 'sb-uuid-1' } },
      error: null,
    });
    const dbUser = {
      id: 'db-uuid-1',
      supabaseId: 'sb-uuid-1',
      email: 'requestor@example.com',
      name: 'Jane Doe',
      role: 'REQUESTOR',
      isActive: true,
      profileCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrismaUser.create.mockResolvedValue(dbUser as any);

    const res = await request(app)
      .post('/users')
      .send({ name: 'Jane Doe', email: 'requestor@example.com', role: 'REQUESTOR' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('requestor@example.com');
    expect(res.body.role).toBe('REQUESTOR');
    expect(mockAuthAdmin.createUser).toHaveBeenCalledWith({
      email: 'requestor@example.com',
      email_confirm: true,
      app_metadata: { role: 'REQUESTOR' },
    });
  });

  it('creates a LEGAL_TEAM user successfully', async () => {
    mockAuthAdmin.createUser.mockResolvedValue({
      data: { user: { id: 'sb-uuid-2' } },
      error: null,
    });
    const dbUser = {
      id: 'db-uuid-2',
      supabaseId: 'sb-uuid-2',
      email: 'legal@example.com',
      name: 'Legal Guy',
      role: 'LEGAL_TEAM',
      isActive: true,
      profileCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrismaUser.create.mockResolvedValue(dbUser as any);

    const res = await request(app)
      .post('/users')
      .send({ name: 'Legal Guy', email: 'legal@example.com', role: 'LEGAL_TEAM' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('LEGAL_TEAM');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/users')
      .send({ email: 'test@example.com', role: 'REQUESTOR' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'Test', role: 'REQUESTOR' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid role (IT_ADMIN)', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'Test', email: 'test@example.com', role: 'IT_ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/REQUESTOR or LEGAL_TEAM/);
  });

  it('returns 400 for unknown role', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'Test', email: 'test@example.com', role: 'SUPERUSER' });

    expect(res.status).toBe(400);
  });

  it('returns 409 when email is already registered', async () => {
    mockAuthAdmin.createUser.mockResolvedValue({
      data: null,
      error: { message: 'User already registered' },
    });

    const res = await request(app)
      .post('/users')
      .send({ name: 'Test', email: 'existing@example.com', role: 'REQUESTOR' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/);
  });

  it('returns 403 for non-IT_ADMIN role', async () => {
    mockCurrentUser = { id: 'requestor-id', role: 'REQUESTOR', isActive: true };

    const res = await request(app)
      .post('/users')
      .send({ name: 'Test', email: 'test@example.com', role: 'REQUESTOR' });

    expect(res.status).toBe(403);
  });
});

describe('GET /users', () => {
  it('returns all internal users', async () => {
    const users = [
      { id: '1', name: 'User 1', email: 'u1@example.com', role: 'REQUESTOR', isActive: true },
      { id: '2', name: 'User 2', email: 'u2@example.com', role: 'LEGAL_TEAM', isActive: true },
    ];
    mockPrismaUser.findMany.mockResolvedValue(users as any);

    const res = await request(app).get('/users');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockPrismaUser.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
  });

  it('returns 403 for LEGAL_TEAM role', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true };

    const res = await request(app).get('/users');

    expect(res.status).toBe(403);
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };

    const res = await request(app).get('/users');

    expect(res.status).toBe(403);
  });
});

describe('PATCH /users/:id', () => {
  it('updates user role successfully', async () => {
    const existing = {
      id: 'user-1',
      supabaseId: 'sb-1',
      email: 'u@example.com',
      name: 'Test',
      role: 'REQUESTOR',
      isActive: true,
    };
    mockPrismaUser.findUnique.mockResolvedValue(existing as any);
    const updated = { ...existing, role: 'LEGAL_TEAM' };
    mockPrismaUser.update.mockResolvedValue(updated as any);
    mockAuthAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });

    const res = await request(app)
      .patch('/users/user-1')
      .send({ role: 'LEGAL_TEAM' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('LEGAL_TEAM');
    expect(mockAuthAdmin.updateUserById).toHaveBeenCalledWith('sb-1', {
      app_metadata: { role: 'LEGAL_TEAM' },
    });
  });

  it('returns 404 for non-existent user', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/users/nonexistent')
      .send({ role: 'LEGAL_TEAM' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when role is missing', async () => {
    const res = await request(app)
      .patch('/users/user-1')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('returns 400 for invalid role', async () => {
    const res = await request(app)
      .patch('/users/user-1')
      .send({ role: 'IT_ADMIN' });

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true };

    const res = await request(app)
      .patch('/users/user-1')
      .send({ role: 'REQUESTOR' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /users/:id/deactivate', () => {
  it('deactivates a user', async () => {
    const existing = {
      id: 'user-1',
      supabaseId: 'sb-1',
      email: 'u@example.com',
      name: 'Test',
      role: 'REQUESTOR',
      isActive: true,
    };
    mockPrismaUser.findUnique.mockResolvedValue(existing as any);
    const deactivated = { ...existing, isActive: false };
    mockPrismaUser.update.mockResolvedValue(deactivated as any);

    const res = await request(app).patch('/users/user-1/deactivate');

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect(mockPrismaUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isActive: false },
    });
  });

  it('returns 404 for non-existent user', async () => {
    mockPrismaUser.findUnique.mockResolvedValue(null);

    const res = await request(app).patch('/users/nonexistent/deactivate');

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-IT_ADMIN', async () => {
    mockCurrentUser = { id: 'req-id', role: 'REQUESTOR', isActive: true };

    const res = await request(app).patch('/users/user-1/deactivate');

    expect(res.status).toBe(403);
  });
});
