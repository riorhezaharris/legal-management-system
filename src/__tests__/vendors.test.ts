import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/storage';
import { resend } from '../lib/resend';

let mockCurrentUser = { id: 'requestor-id', role: 'REQUESTOR', isActive: true, profileCompleted: true };

jest.mock('../lib/prisma', () => ({
  prisma: {
    vendor: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('../lib/storage', () => ({
  supabase: {
    auth: {
      admin: {
        generateLink: jest.fn(),
        updateUserById: jest.fn(),
      },
    },
  },
}));

jest.mock('../lib/resend', () => ({
  resend: {
    emails: {
      send: jest.fn(),
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

const mockVendor = prisma.vendor as jest.Mocked<typeof prisma.vendor>;
const mockAuthAdmin = (supabase as any).auth.admin;
const mockResend = (resend as any).emails;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'requestor-id', role: 'REQUESTOR', isActive: true, profileCompleted: true };
});

describe('GET /vendors', () => {
  it('returns active vendors (no name filter)', async () => {
    const vendors = [
      { id: 'v1', name: 'Acme Corp', email: 'acme@example.com', kybStatus: 'APPROVED' },
      { id: 'v2', name: 'Beta Ltd', email: 'beta@example.com', kybStatus: 'SUBMITTED' },
    ];
    mockVendor.findMany.mockResolvedValue(vendors as any);

    const res = await request(app).get('/vendors');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockVendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      })
    );
  });

  it('filters vendors by name', async () => {
    mockVendor.findMany.mockResolvedValue([
      { id: 'v1', name: 'Acme Corp', email: 'acme@example.com', kybStatus: 'APPROVED' },
    ] as any);

    const res = await request(app).get('/vendors?name=acme');

    expect(res.status).toBe(200);
    expect(mockVendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          name: { contains: 'acme', mode: 'insensitive' },
        },
      })
    );
  });

  it('returns only id, name, email, kybStatus fields', async () => {
    mockVendor.findMany.mockResolvedValue([
      { id: 'v1', name: 'Acme Corp', email: 'acme@example.com', kybStatus: 'APPROVED' },
    ] as any);

    const res = await request(app).get('/vendors');

    expect(res.status).toBe(200);
    expect(mockVendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, name: true, email: true, kybStatus: true },
      })
    );
  });

  it('allows IT_ADMIN to list vendors', async () => {
    mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true, profileCompleted: true };
    mockVendor.findMany.mockResolvedValue([]);

    const res = await request(app).get('/vendors');

    expect(res.status).toBe(200);
  });

  it('allows LEGAL_TEAM to list vendors', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockVendor.findMany.mockResolvedValue([]);

    const res = await request(app).get('/vendors');

    expect(res.status).toBe(200);
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-id', role: 'VENDOR', isActive: true, profileCompleted: true };

    const res = await request(app).get('/vendors');

    expect(res.status).toBe(403);
  });
});

describe('POST /vendors/invite', () => {
  const mockLinkData = {
    user: { id: 'sb-vendor-1' },
    properties: { action_link: 'https://supabase.example.com/invite?token=abc123' },
  };

  const mockCreatedVendor = {
    id: 'vendor-1',
    supabaseId: 'sb-vendor-1',
    email: 'vendor@example.com',
    name: 'vendor@example.com',
    kybStatus: 'INVITED',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('invites a new vendor successfully', async () => {
    mockVendor.findUnique.mockResolvedValue(null);
    mockAuthAdmin.generateLink.mockResolvedValue({ data: mockLinkData, error: null });
    mockAuthAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });
    mockVendor.create.mockResolvedValue(mockCreatedVendor as any);
    mockResend.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'vendor@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('vendor@example.com');
    expect(res.body.kybStatus).toBe('INVITED');
    expect(mockAuthAdmin.generateLink).toHaveBeenCalledWith({
      type: 'invite',
      email: 'vendor@example.com',
    });
    expect(mockAuthAdmin.updateUserById).toHaveBeenCalledWith('sb-vendor-1', {
      app_metadata: { role: 'VENDOR' },
    });
    expect(mockVendor.create).toHaveBeenCalledWith({
      data: {
        supabaseId: 'sb-vendor-1',
        email: 'vendor@example.com',
        name: 'vendor@example.com',
        kybStatus: 'INVITED',
      },
    });
    expect(mockResend.send).toHaveBeenCalled();
  });

  it('returns existing active vendor without creating duplicate', async () => {
    const existingVendor = { ...mockCreatedVendor, kybStatus: 'APPROVED', isActive: true };
    mockVendor.findUnique.mockResolvedValue(existingVendor as any);

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'vendor@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('vendor-1');
    expect(mockAuthAdmin.generateLink).not.toHaveBeenCalled();
    expect(mockVendor.create).not.toHaveBeenCalled();
  });

  it('returns 409 when email belongs to a deactivated vendor', async () => {
    const deactivatedVendor = { ...mockCreatedVendor, isActive: false };
    mockVendor.findUnique.mockResolvedValue(deactivatedVendor as any);

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'deactivated@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/deactivated/i);
    expect(mockVendor.create).not.toHaveBeenCalled();
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/vendors/invite')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('returns 400 when Supabase generateLink fails', async () => {
    mockVendor.findUnique.mockResolvedValue(null);
    mockAuthAdmin.generateLink.mockResolvedValue({
      data: null,
      error: { message: 'Supabase error' },
    });

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'new@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Supabase error');
    expect(mockVendor.create).not.toHaveBeenCalled();
  });

  it('still returns 201 when email send fails (non-fatal)', async () => {
    mockVendor.findUnique.mockResolvedValue(null);
    mockAuthAdmin.generateLink.mockResolvedValue({ data: mockLinkData, error: null });
    mockAuthAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });
    mockVendor.create.mockResolvedValue(mockCreatedVendor as any);
    mockResend.send.mockRejectedValue(new Error('SMTP failure'));

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'vendor@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.kybStatus).toBe('INVITED');
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-id', role: 'VENDOR', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'new@example.com' });

    expect(res.status).toBe(403);
  });

  it('allows IT_ADMIN to invite vendors', async () => {
    mockCurrentUser = { id: 'admin-id', role: 'IT_ADMIN', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(null);
    mockAuthAdmin.generateLink.mockResolvedValue({ data: mockLinkData, error: null });
    mockAuthAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });
    mockVendor.create.mockResolvedValue(mockCreatedVendor as any);
    mockResend.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'vendor@example.com' });

    expect(res.status).toBe(201);
  });

  it('allows LEGAL_TEAM to invite vendors', async () => {
    mockCurrentUser = { id: 'legal-id', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(null);
    mockAuthAdmin.generateLink.mockResolvedValue({ data: mockLinkData, error: null });
    mockAuthAdmin.updateUserById.mockResolvedValue({ data: {}, error: null });
    mockVendor.create.mockResolvedValue(mockCreatedVendor as any);
    mockResend.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    const res = await request(app)
      .post('/vendors/invite')
      .send({ email: 'vendor@example.com' });

    expect(res.status).toBe(201);
  });
});
