import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { resend } from '../lib/resend';

let mockCurrentUser = {
  id: 'vendor-1',
  role: 'VENDOR',
  isActive: true,
  profileCompleted: true,
};

jest.mock('../lib/prisma', () => {
  const prismaMock: any = {
    vendor: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    kybDocument: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    kybReview: {
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
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
        generateLink: jest.fn(),
        updateUserById: jest.fn(),
      },
    },
  },
  storage: {
    from: jest.fn(),
  },
}));

jest.mock('../lib/resend', () => ({
  resend: {
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'email-1' } }),
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
const mockKybDocument = prisma.kybDocument as jest.Mocked<typeof prisma.kybDocument>;
const mockKybReview = prisma.kybReview as jest.Mocked<typeof prisma.kybReview>;
const mockUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockStorageFrom = storage.from as jest.Mock;
const mockResend = (resend as any).emails;

const makeStorageBucket = (uploadError: any = null, publicUrl = 'https://storage.example.com/file.pdf') => ({
  upload: jest.fn().mockResolvedValue({ error: uploadError }),
  getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl } }),
});

const baseVendor = {
  id: 'vendor-1',
  supabaseId: 'sb-vendor-1',
  email: 'vendor@example.com',
  name: 'Test Vendor',
  address: '123 Main St',
  type: null,
  kybStatus: 'INVITED',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const submittedVendorWithIncludes = {
  ...baseVendor,
  kybStatus: 'SUBMITTED',
  type: 'PERORANGAN',
  kybDocuments: [
    { id: 'doc-1', vendorId: 'vendor-1', documentType: 'KTP', fileUrl: 'https://storage.example.com/file.pdf', fileName: 'ktp.pdf', fileSize: 1024, createdAt: new Date(), updatedAt: new Date() },
    { id: 'doc-2', vendorId: 'vendor-1', documentType: 'NPWP', fileUrl: 'https://storage.example.com/file.pdf', fileName: 'npwp.pdf', fileSize: 1024, createdAt: new Date(), updatedAt: new Date() },
  ],
  kybReviews: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };
  mockStorageFrom.mockReturnValue(makeStorageBucket());
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
  mockUser.findMany.mockResolvedValue([]);
  mockKybDocument.deleteMany.mockResolvedValue({ count: 0 } as any);
  mockKybDocument.createMany.mockResolvedValue({ count: 0 } as any);
  mockKybReview.create.mockResolvedValue({} as any);
  mockResend.send.mockResolvedValue({ data: { id: 'email-1' } });
});

// ─────────────────────────────────────────────────────────────────
// GET /vendors/:id/kyb
// ─────────────────────────────────────────────────────────────────

describe('GET /vendors/:id/kyb', () => {
  const vendorWithDocs = {
    ...baseVendor,
    kybStatus: 'SUBMITTED',
    type: 'PERORANGAN',
    kybDocuments: [
      { id: 'doc-1', documentType: 'KTP', fileUrl: 'https://example.com/ktp.pdf', fileName: 'ktp.pdf', fileSize: 1024 },
    ],
    kybReviews: [
      { id: 'rev-1', remarks: 'Please resubmit KTP', createdAt: new Date() },
    ],
  };

  it('allows vendor to view their own KYB', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(vendorWithDocs as any);

    const res = await request(app).get('/vendors/vendor-1/kyb');

    expect(res.status).toBe(200);
    expect(res.body.kybStatus).toBe('SUBMITTED');
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.latestReview.remarks).toBe('Please resubmit KTP');
  });

  it('returns 403 when vendor tries to access another vendor KYB', async () => {
    mockCurrentUser = { id: 'vendor-2', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(vendorWithDocs as any);

    const res = await request(app).get('/vendors/vendor-1/kyb');

    expect(res.status).toBe(403);
  });

  it('allows LEGAL_TEAM to view any vendor KYB', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(vendorWithDocs as any);

    const res = await request(app).get('/vendors/vendor-1/kyb');

    expect(res.status).toBe(200);
    expect(res.body.kybStatus).toBe('SUBMITTED');
  });

  it('allows IT_ADMIN to view any vendor KYB', async () => {
    mockCurrentUser = { id: 'admin-1', role: 'IT_ADMIN', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(vendorWithDocs as any);

    const res = await request(app).get('/vendors/vendor-1/kyb');

    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent vendor', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/vendors/nonexistent/kyb');

    expect(res.status).toBe(404);
  });

  it('returns null latestReview when no reviews exist', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue({ ...vendorWithDocs, kybReviews: [] } as any);

    const res = await request(app).get('/vendors/vendor-1/kyb');

    expect(res.status).toBe(200);
    expect(res.body.latestReview).toBeNull();
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app).get('/vendors/vendor-1/kyb');

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /vendors/:id/kyb — KYB state machine (submission)
// ─────────────────────────────────────────────────────────────────

describe('POST /vendors/:id/kyb', () => {
  it('INVITED → SUBMITTED (PERORANGAN) with required docs', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'INVITED', type: null } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED', type: 'PERORANGAN' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('fake ktp data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('fake npwp data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vendor-1' },
        data: expect.objectContaining({ kybStatus: 'SUBMITTED', type: 'PERORANGAN' }),
      })
    );
    expect(mockKybDocument.deleteMany).toHaveBeenCalledWith({ where: { vendorId: 'vendor-1' } });
    expect(mockKybDocument.createMany).toHaveBeenCalled();
  });

  it('INVITED → SUBMITTED (BADAN) with all required docs', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'INVITED', type: null } as any)
      .mockResolvedValueOnce({ ...submittedVendorWithIncludes, type: 'BADAN' } as any);
    mockVendor.update.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED', type: 'BADAN' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'BADAN')
      .attach('AKTA_PENDIRIAN', Buffer.from('data'), { filename: 'akta.pdf', contentType: 'application/pdf' })
      .attach('SK_PENDIRIAN', Buffer.from('data'), { filename: 'sk.pdf', contentType: 'application/pdf' })
      .attach('NIB', Buffer.from('data'), { filename: 'nib.pdf', contentType: 'application/pdf' })
      .attach('KTP_PENANGGUNG_JAWAB', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP_BADAN', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' })
      .attach('AKTA_PERUBAHAN_DIREKSI', Buffer.from('data'), { filename: 'akta2.pdf', contentType: 'application/pdf' })
      .attach('SK_PERUBAHAN_DIREKSI', Buffer.from('data'), { filename: 'sk2.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'BADAN' }) })
    );
  });

  it('BADAN optional SURAT_KUASA is uploaded when provided', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'INVITED', type: null } as any)
      .mockResolvedValueOnce({ ...submittedVendorWithIncludes, type: 'BADAN' } as any);
    mockVendor.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'BADAN')
      .attach('AKTA_PENDIRIAN', Buffer.from('data'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('SK_PENDIRIAN', Buffer.from('data'), { filename: 'b.pdf', contentType: 'application/pdf' })
      .attach('NIB', Buffer.from('data'), { filename: 'c.pdf', contentType: 'application/pdf' })
      .attach('KTP_PENANGGUNG_JAWAB', Buffer.from('data'), { filename: 'd.pdf', contentType: 'application/pdf' })
      .attach('NPWP_BADAN', Buffer.from('data'), { filename: 'e.pdf', contentType: 'application/pdf' })
      .attach('AKTA_PERUBAHAN_DIREKSI', Buffer.from('data'), { filename: 'f.pdf', contentType: 'application/pdf' })
      .attach('SK_PERUBAHAN_DIREKSI', Buffer.from('data'), { filename: 'g.pdf', contentType: 'application/pdf' })
      .attach('SURAT_KUASA', Buffer.from('data'), { filename: 'h.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    const createManyCall = mockKybDocument.createMany.mock.calls[0]?.[0];
    const docTypes = (createManyCall?.data as any[]).map((d: any) => d.documentType);
    expect(docTypes).toContain('SURAT_KUASA');
  });

  it('REVISION → SUBMITTED (re-submission after revision)', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'REVISION', type: 'PERORANGAN' } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('new ktp'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('new npwp'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kybStatus: 'SUBMITTED' }) })
    );
  });

  it('REVISION → SUBMITTED sends "re-submitted" email to legal team', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'REVISION', type: 'PERORANGAN', name: 'Acme Vendor' } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({} as any);
    mockUser.findMany.mockResolvedValue([{ email: 'legal@example.com' }] as any);

    await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'legal@example.com',
        subject: expect.stringContaining('Re-submitted'),
      })
    );
  });

  it('INVITED → SUBMITTED sends "submitted" email to legal team', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'INVITED', type: null, name: 'Acme Vendor' } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({} as any);
    mockUser.findMany.mockResolvedValue([{ email: 'legal@example.com' }] as any);

    await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('KYB Submitted'),
      })
    );
  });

  it('APPROVED → SUBMITTED (post-approval re-submission)', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'APPROVED', type: 'PERORANGAN' } as any)
      .mockResolvedValueOnce({ ...submittedVendorWithIncludes, kybStatus: 'SUBMITTED' } as any);
    mockVendor.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('updated ktp'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('updated npwp'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kybStatus: 'SUBMITTED' }) })
    );
  });

  it('SUBMITTED → SUBMITTED is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED', type: 'PERORANGAN' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SUBMITTED/);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 400 when vendor type is missing and not already set', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED', type: null } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it('uses existing vendor type when not provided in body', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'REVISION', type: 'PERORANGAN' } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when PERORANGAN is missing KTP', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED', type: null } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/KTP/);
  });

  it('returns 400 when PERORANGAN is missing NPWP', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED', type: null } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NPWP/);
  });

  it('returns 400 when BADAN is missing a required doc (NIB)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED', type: null } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'BADAN')
      .attach('AKTA_PENDIRIAN', Buffer.from('data'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('SK_PENDIRIAN', Buffer.from('data'), { filename: 'b.pdf', contentType: 'application/pdf' })
      // NIB missing
      .attach('KTP_PENANGGUNG_JAWAB', Buffer.from('data'), { filename: 'd.pdf', contentType: 'application/pdf' })
      .attach('NPWP_BADAN', Buffer.from('data'), { filename: 'e.pdf', contentType: 'application/pdf' })
      .attach('AKTA_PERUBAHAN_DIREKSI', Buffer.from('data'), { filename: 'f.pdf', contentType: 'application/pdf' })
      .attach('SK_PERUBAHAN_DIREKSI', Buffer.from('data'), { filename: 'g.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NIB/);
  });

  it('returns 403 when vendor submits for another vendor', async () => {
    mockCurrentUser = { id: 'vendor-2', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED', type: null } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('returns 404 for non-existent vendor', async () => {
    mockVendor.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/vendors/nonexistent/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(404);
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });

  it('returns 403 for LEGAL_TEAM role trying to submit KYB', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });

  it('returns 500 when Supabase Storage upload fails', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED', type: null } as any);
    mockStorageFrom.mockReturnValue(makeStorageBucket({ message: 'Storage failure' }));

    const res = await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to upload/);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('stores file URL from Supabase getPublicUrl in document record', async () => {
    const expectedUrl = 'https://storage.supabase.co/kyb/file.pdf';
    mockStorageFrom.mockReturnValue(makeStorageBucket(null, expectedUrl));
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'INVITED', type: null } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({} as any);

    await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    const createManyCall = mockKybDocument.createMany.mock.calls[0]?.[0];
    expect((createManyCall?.data as any[]).every((d: any) => d.fileUrl === expectedUrl)).toBe(true);
  });

  it('sets address on vendor when provided', async () => {
    mockVendor.findUnique
      .mockResolvedValueOnce({ ...baseVendor, kybStatus: 'INVITED', type: null } as any)
      .mockResolvedValueOnce(submittedVendorWithIncludes as any);
    mockVendor.update.mockResolvedValue({} as any);

    await request(app)
      .post('/vendors/vendor-1/kyb')
      .field('type', 'PERORANGAN')
      .field('address', '456 New Street')
      .attach('KTP', Buffer.from('data'), { filename: 'ktp.pdf', contentType: 'application/pdf' })
      .attach('NPWP', Buffer.from('data'), { filename: 'npwp.pdf', contentType: 'application/pdf' });

    expect(mockVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ address: '456 New Street' }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /vendors/:id/kyb/revision — KYB state machine (revision)
// ─────────────────────────────────────────────────────────────────

describe('POST /vendors/:id/kyb/revision', () => {
  beforeEach(() => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
  });

  it('SUBMITTED → REVISION with remarks', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED' } as any);
    mockVendor.update.mockResolvedValue({} as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'Please resubmit clearer KTP scan' });

    expect(res.status).toBe(200);
    expect(res.body.kybStatus).toBe('REVISION');
    expect(mockKybReview.create).toHaveBeenCalledWith({
      data: {
        vendorId: 'vendor-1',
        remarks: 'Please resubmit clearer KTP scan',
        createdById: 'legal-1',
      },
    });
    expect(mockVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kybStatus: 'REVISION' } })
    );
  });

  it('sends revision email to vendor with remarks', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED', email: 'vendor@example.com' } as any);
    mockVendor.update.mockResolvedValue({} as any);

    await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'KTP tidak jelas' });

    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vendor@example.com',
        subject: expect.stringContaining('Revisi'),
        html: expect.stringContaining('KTP tidak jelas'),
      })
    );
  });

  it('INVITED → REVISION is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'Some remarks' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/INVITED/);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('REVISION → REVISION is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'REVISION' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'More remarks' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/REVISION/);
  });

  it('APPROVED → REVISION is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'APPROVED' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'New remarks' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/APPROVED/);
  });

  it('returns 400 when remarks is missing', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/remarks/i);
  });

  it('returns 400 when remarks is empty string', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED' } as any);

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent vendor', async () => {
    mockVendor.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/vendors/nonexistent/kyb/revision')
      .send({ remarks: 'Some remarks' });

    expect(res.status).toBe(404);
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'Some remarks' });

    expect(res.status).toBe(403);
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'Some remarks' });

    expect(res.status).toBe(403);
  });

  it('returns 403 for IT_ADMIN role', async () => {
    mockCurrentUser = { id: 'admin-1', role: 'IT_ADMIN', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/vendors/vendor-1/kyb/revision')
      .send({ remarks: 'Some remarks' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /vendors/:id/kyb/approve — KYB state machine (approval)
// ─────────────────────────────────────────────────────────────────

describe('POST /vendors/:id/kyb/approve', () => {
  beforeEach(() => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
  });

  it('SUBMITTED → APPROVED', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'SUBMITTED' } as any);
    mockVendor.update.mockResolvedValue({ ...baseVendor, kybStatus: 'APPROVED' } as any);

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(200);
    expect(res.body.kybStatus).toBe('APPROVED');
    expect(mockVendor.update).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
      data: { kybStatus: 'APPROVED' },
    });
  });

  it('INVITED → APPROVED is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'INVITED' } as any);

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/INVITED/);
    expect(mockVendor.update).not.toHaveBeenCalled();
  });

  it('REVISION → APPROVED is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'REVISION' } as any);

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/REVISION/);
  });

  it('APPROVED → APPROVED is rejected (invalid transition)', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, kybStatus: 'APPROVED' } as any);

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/APPROVED/);
  });

  it('returns 404 for non-existent vendor', async () => {
    mockVendor.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/vendors/nonexistent/kyb/approve');

    expect(res.status).toBe(404);
  });

  it('returns 403 for REQUESTOR role', async () => {
    mockCurrentUser = { id: 'req-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(403);
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(403);
  });

  it('returns 403 for IT_ADMIN role', async () => {
    mockCurrentUser = { id: 'admin-1', role: 'IT_ADMIN', isActive: true, profileCompleted: true };

    const res = await request(app).post('/vendors/vendor-1/kyb/approve');

    expect(res.status).toBe(403);
  });
});
