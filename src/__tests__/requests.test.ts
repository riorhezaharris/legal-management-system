import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { resend } from '../lib/resend';

let mockCurrentUser = {
  id: 'requestor-1',
  role: 'REQUESTOR',
  isActive: true,
  profileCompleted: true,
};

jest.mock('../lib/prisma', () => {
  const prismaMock: any = {
    legalRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    legalRequestData: {
      update: jest.fn(),
    },
    legalRequestAttachment: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    stageHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    requestorProfile: {
      findUnique: jest.fn(),
    },
    slaConfig: {
      findUnique: jest.fn(),
    },
    vendor: {
      findUnique: jest.fn(),
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

jest.mock('../services/reference-number', () => ({
  generate: jest.fn().mockResolvedValue('001/FIN/PB/V/2026'),
}));

jest.mock('../services/sla', () => ({
  computeDeadline: jest.fn().mockResolvedValue(new Date('2026-05-25T00:00:00.000Z')),
  getStatus: jest.fn().mockResolvedValue('ON_TRACK'),
}));

const mockRequest = prisma.legalRequest as jest.Mocked<typeof prisma.legalRequest>;
const mockRequestData = prisma.legalRequestData as jest.Mocked<typeof prisma.legalRequestData>;
const mockAttachment = prisma.legalRequestAttachment as jest.Mocked<typeof prisma.legalRequestAttachment>;
const mockStageHistory = prisma.stageHistory as jest.Mocked<typeof prisma.stageHistory>;
const mockProfile = prisma.requestorProfile as jest.Mocked<typeof prisma.requestorProfile>;
const mockSlaConfig = prisma.slaConfig as jest.Mocked<typeof prisma.slaConfig>;
const mockVendor = prisma.vendor as jest.Mocked<typeof prisma.vendor>;
const mockUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockStorageFrom = storage.from as jest.Mock;
const mockResend = (resend as any).emails;

const makeStorageBucket = (uploadError: any = null, publicUrl = 'https://storage.example.com/file.pdf') => ({
  upload: jest.fn().mockResolvedValue({ error: uploadError }),
  getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl } }),
});

const baseVendor = {
  id: 'vendor-1',
  name: 'Test Vendor',
  email: 'vendor@example.com',
  kybStatus: 'APPROVED',
  isActive: true,
};

const baseProfile = {
  id: 'profile-1',
  userId: 'requestor-1',
  namaLengkap: 'Test User',
  lokasiKantorId: 'lokasi-1',
  divisiId: 'divisi-1',
  unitBisnisId: 'unit-1',
  divisi: { id: 'divisi-1', name: 'Finance', code: 'FIN' },
};

const baseSlaConfig = { id: 'singleton', workingDays: 5 };

const makeRequest = (overrides: Record<string, any> = {}) => ({
  id: 'request-1',
  requestorId: 'requestor-1',
  type: 'PERJANJIAN_BARU',
  status: 'DRAFT',
  referenceNumber: null,
  vendorId: 'vendor-1',
  submittedAt: null,
  slaDeadline: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  data: {
    id: 'data-1',
    requestId: 'request-1',
    lingkupPerjanjian: 'Test scope',
    statusPerjanjian: 'BELUM_BERLANGSUNG',
    jangkaWaktuStart: new Date('2026-06-01'),
    jangkaWaktuEnd: new Date('2026-12-31'),
    perjanjianSebelumnya: null,
    halYangInginDiubah: null,
    suratYangHendakDibuat: null,
    identitasPenerimaSurat: null,
    dokumenYangDiminta: null,
    tujuanPermintaan: null,
  },
  attachments: [],
  vendor: { id: 'vendor-1', name: 'Test Vendor', kybStatus: 'APPROVED', isActive: true },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
  mockStorageFrom.mockReturnValue(makeStorageBucket());
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
  mockUser.findMany.mockResolvedValue([]);
  mockAttachment.deleteMany.mockResolvedValue({ count: 0 } as any);
  mockAttachment.create.mockResolvedValue({} as any);
  mockStageHistory.create.mockResolvedValue({} as any);
  mockResend.send.mockResolvedValue({ data: { id: 'email-1' } });
  mockSlaConfig.findUnique.mockResolvedValue(baseSlaConfig as any);
});

// ─────────────────────────────────────────────────────────────────
// POST /requests — create
// ─────────────────────────────────────────────────────────────────

describe('POST /requests', () => {
  it('creates a DRAFT request without submit flag', async () => {
    mockRequest.create.mockResolvedValue(makeRequest() as any);

    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU');

    expect(res.status).toBe(201);
    expect(mockRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT' }),
      }),
    );
  });

  it('creates a WAITING request when submit=true with all required fields', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    mockRequest.findUnique.mockResolvedValueOnce(makeRequest() as any);
    mockRequest.update.mockResolvedValue(
      makeRequest({ status: 'WAITING', referenceNumber: '001/FIN/PB/V/2026' }) as any,
    );

    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('submit', 'true')
      .field('vendorId', 'vendor-1')
      .field('lingkupPerjanjian', 'Test scope')
      .field('statusPerjanjian', 'BELUM_BERLANGSUNG')
      .field('jangkaWaktuStart', '2026-06-01')
      .field('jangkaWaktuEnd', '2026-12-31');

    expect(res.status).toBe(201);
    expect(mockRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT' }),
      }),
    );
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'WAITING', referenceNumber: '001/FIN/PB/V/2026' }),
      }),
    );
    expect(mockStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStage: 'WAITING', fromStage: null }),
      }),
    );
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app).post('/requests').field('type', 'INVALID_TYPE');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it('returns 400 when vendorId provided for SURAT type', async () => {
    const res = await request(app)
      .post('/requests')
      .field('type', 'SURAT')
      .field('vendorId', 'vendor-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vendorId/i);
  });

  it('returns 400 when vendorId provided for PERMINTAAN_DOKUMEN type', async () => {
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERMINTAAN_DOKUMEN')
      .field('vendorId', 'vendor-1');
    expect(res.status).toBe(400);
  });

  it('returns 400 when vendor not found', async () => {
    mockVendor.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('vendorId', 'nonexistent');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when linking a deactivated vendor', async () => {
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, isActive: false } as any);
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('vendorId', 'vendor-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  it('returns 400 when PERJANJIAN_BARU missing vendorId on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(makeRequest({ vendorId: null, vendor: null }) as any);
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('submit', 'true')
      .field('lingkupPerjanjian', 'Scope')
      .field('statusPerjanjian', 'BELUM_BERLANGSUNG')
      .field('jangkaWaktuStart', '2026-06-01')
      .field('jangkaWaktuEnd', '2026-12-31');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vendorId/i);
  });

  it('returns 400 when ADENDUM missing attachment on submit', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'ADENDUM',
        vendorId: 'vendor-1',
        attachments: [],
        data: { ...makeRequest().data, perjanjianSebelumnya: 'Old agreement', halYangInginDiubah: 'Change this' },
      }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'ADENDUM')
      .field('submit', 'true')
      .field('vendorId', 'vendor-1')
      .field('perjanjianSebelumnya', 'Old agreement')
      .field('halYangInginDiubah', 'Change this');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Lampirkan Perjanjian Sebelumnya/i);
  });

  it('returns 500 when file upload fails', async () => {
    mockStorageFrom.mockReturnValue(makeStorageBucket({ message: 'Storage error' }));
    const res = await request(app)
      .post('/requests')
      .field('type', 'ADENDUM')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', Buffer.from('data'), {
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to upload/i);
  });

  it('returns 403 for LEGAL_TEAM role', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    const res = await request(app).post('/requests').field('type', 'SURAT');
    expect(res.status).toBe(403);
  });

  it('uploads ADENDUM attachment and creates record', async () => {
    const fileUrl = 'https://storage.example.com/agreement.pdf';
    mockStorageFrom.mockReturnValue(makeStorageBucket(null, fileUrl));
    const adendumRequest = makeRequest({
      type: 'ADENDUM',
      vendorId: 'vendor-1',
      attachments: [{ type: 'ADENDUM_PREVIOUS_AGREEMENT', fileUrl, fileName: 'agreement.pdf', fileSize: 100 }],
    });
    mockRequest.create.mockResolvedValue(adendumRequest as any);

    const res = await request(app)
      .post('/requests')
      .field('type', 'ADENDUM')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', Buffer.from('data'), {
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    const createCall = mockRequest.create.mock.calls[0]?.[0];
    expect(createCall?.data).toHaveProperty('attachments');
  });

  it('notifies legal team on submit', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    mockUser.findMany.mockResolvedValue([{ email: 'legal@example.com' }] as any);
    mockRequest.findUnique.mockResolvedValueOnce(makeRequest() as any);
    mockRequest.update.mockResolvedValue(
      makeRequest({ status: 'WAITING', referenceNumber: '001/FIN/PB/V/2026' }) as any,
    );

    await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('submit', 'true')
      .field('vendorId', 'vendor-1')
      .field('lingkupPerjanjian', 'Scope')
      .field('statusPerjanjian', 'BELUM_BERLANGSUNG')
      .field('jangkaWaktuStart', '2026-06-01')
      .field('jangkaWaktuEnd', '2026-12-31');

    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'legal@example.com',
        subject: expect.stringContaining('001/FIN/PB/V/2026'),
      }),
    );
  });

  it('returns 400 when file exceeds 20MB limit', async () => {
    const bigBuffer = Buffer.alloc(21 * 1024 * 1024);
    const res = await request(app)
      .post('/requests')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', bigBuffer, {
        filename: 'huge.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('returns 500 when multer receives an unexpected file field', async () => {
    const res = await request(app)
      .post('/requests')
      .field('type', 'SURAT')
      .attach('UNEXPECTED_FIELD', Buffer.from('data'), {
        filename: 'file.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(500);
  });

  it('returns 400 when PERJANJIAN_BARU has invalid statusPerjanjian on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({ vendorId: null, vendor: null, data: { ...makeRequest().data, statusPerjanjian: 'INVALID_STATUS' } }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('submit', 'true')
      .field('lingkupPerjanjian', 'Scope')
      .field('statusPerjanjian', 'INVALID_STATUS')
      .field('jangkaWaktuStart', '2026-06-01')
      .field('jangkaWaktuEnd', '2026-12-31');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/statusPerjanjian/i);
  });

  it('returns 400 when SURAT is missing suratYangHendakDibuat on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({ type: 'SURAT', vendorId: null, vendor: null }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'SURAT')
      .field('submit', 'true');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/suratYangHendakDibuat/i);
  });

  it('returns 400 when SURAT is missing identitasPenerimaSurat on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'SURAT', vendorId: null, vendor: null,
        data: { ...makeRequest().data, suratYangHendakDibuat: 'Surat Keterangan' },
      }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'SURAT')
      .field('submit', 'true')
      .field('suratYangHendakDibuat', 'Surat Keterangan');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/identitasPenerimaSurat/i);
  });

  it('returns 400 when PERMINTAAN_DOKUMEN is missing dokumenYangDiminta on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({ type: 'PERMINTAAN_DOKUMEN', vendorId: null, vendor: null }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERMINTAAN_DOKUMEN')
      .field('submit', 'true');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dokumenYangDiminta/i);
  });

  it('returns 400 when PERMINTAAN_DOKUMEN is missing tujuanPermintaan on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'PERMINTAAN_DOKUMEN', vendorId: null, vendor: null,
        data: { ...makeRequest().data, dokumenYangDiminta: 'BPKB' },
      }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERMINTAAN_DOKUMEN')
      .field('submit', 'true')
      .field('dokumenYangDiminta', 'BPKB');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tujuanPermintaan/i);
  });

  it('returns 400 when requestor profile is not found on submit', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockRequest.findUnique.mockResolvedValueOnce(makeRequest() as any);
    mockProfile.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('submit', 'true')
      .field('vendorId', 'vendor-1')
      .field('lingkupPerjanjian', 'Scope')
      .field('statusPerjanjian', 'BELUM_BERLANGSUNG')
      .field('jangkaWaktuStart', '2026-06-01')
      .field('jangkaWaktuEnd', '2026-12-31');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/profile/i);
  });

  it('returns 500 on unexpected database error', async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERJANJIAN_BARU')
      .field('submit', 'true')
      .field('vendorId', 'vendor-1')
      .field('lingkupPerjanjian', 'Scope')
      .field('statusPerjanjian', 'BELUM_BERLANGSUNG')
      .field('jangkaWaktuStart', '2026-06-01')
      .field('jangkaWaktuEnd', '2026-12-31');
    expect(res.status).toBe(500);
  });

  it('returns 400 when ADENDUM has attachment but missing vendorId on submit', async () => {
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'ADENDUM',
        vendorId: null,
        vendor: null,
        attachments: [{ type: 'ADENDUM_PREVIOUS_AGREEMENT', fileUrl: 'https://storage.example.com/agreement.pdf', fileName: 'agreement.pdf', fileSize: 100 }],
        data: { ...makeRequest().data, perjanjianSebelumnya: 'Old agreement', halYangInginDiubah: 'Change this' },
      }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'ADENDUM')
      .field('submit', 'true')
      .field('perjanjianSebelumnya', 'Old agreement')
      .field('halYangInginDiubah', 'Change this')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', Buffer.from('data'), {
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vendorId/i);
  });

  it('submits a valid SURAT draft', async () => {
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'SURAT', vendorId: null, vendor: null,
        data: { ...makeRequest().data, suratYangHendakDibuat: 'Surat Keterangan Kerja', identitasPenerimaSurat: 'John Doe, Director' },
      }) as any,
    );
    mockRequest.update.mockResolvedValue(
      makeRequest({ type: 'SURAT', status: 'WAITING', vendorId: null, referenceNumber: '001/FIN/SRT/V/2026' }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'SURAT')
      .field('submit', 'true')
      .field('suratYangHendakDibuat', 'Surat Keterangan Kerja')
      .field('identitasPenerimaSurat', 'John Doe, Director');
    expect(res.status).toBe(201);
  });

  it('submits a valid PERMINTAAN_DOKUMEN draft', async () => {
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'PERMINTAAN_DOKUMEN', vendorId: null, vendor: null,
        data: { ...makeRequest().data, dokumenYangDiminta: 'BPKB', tujuanPermintaan: 'Pengajuan Kredit' },
      }) as any,
    );
    mockRequest.update.mockResolvedValue(
      makeRequest({ type: 'PERMINTAAN_DOKUMEN', status: 'WAITING', vendorId: null, referenceNumber: '001/FIN/PD/V/2026' }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'PERMINTAAN_DOKUMEN')
      .field('submit', 'true')
      .field('dokumenYangDiminta', 'BPKB')
      .field('tujuanPermintaan', 'Pengajuan Kredit');
    expect(res.status).toBe(201);
  });

  it('submits a valid ADENDUM with attachment and vendorId', async () => {
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    mockRequest.findUnique.mockResolvedValueOnce(
      makeRequest({
        type: 'ADENDUM',
        attachments: [{ type: 'ADENDUM_PREVIOUS_AGREEMENT', fileUrl: 'https://storage.example.com/agreement.pdf', fileName: 'agreement.pdf', fileSize: 100 }],
        data: { ...makeRequest().data, perjanjianSebelumnya: 'Old agreement', halYangInginDiubah: 'Change clause 3' },
      }) as any,
    );
    mockRequest.update.mockResolvedValue(
      makeRequest({ type: 'ADENDUM', status: 'WAITING', referenceNumber: '001/FIN/ADD/V/2026' }) as any,
    );
    const res = await request(app)
      .post('/requests')
      .field('type', 'ADENDUM')
      .field('submit', 'true')
      .field('vendorId', 'vendor-1')
      .field('perjanjianSebelumnya', 'Old agreement')
      .field('halYangInginDiubah', 'Change clause 3')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', Buffer.from('data'), {
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /requests/:id — update draft
// ─────────────────────────────────────────────────────────────────

describe('PATCH /requests/:id', () => {
  it('updates text fields of a DRAFT', async () => {
    const draft = makeRequest();
    const updated = makeRequest({ data: { ...draft.data, lingkupPerjanjian: 'Updated scope' } });
    mockRequest.findUnique
      .mockResolvedValueOnce(draft as any)
      .mockResolvedValueOnce(updated as any);
    mockRequest.update.mockResolvedValue(updated as any);
    mockRequestData.update.mockResolvedValue({} as any);

    const res = await request(app)
      .patch('/requests/request-1')
      .send({ lingkupPerjanjian: 'Updated scope' });

    expect(res.status).toBe(200);
    expect(mockRequestData.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lingkupPerjanjian: 'Updated scope' }),
      }),
    );
  });

  it('returns 404 for non-existent request', async () => {
    mockRequest.findUnique.mockResolvedValue(null);
    const res = await request(app).patch('/requests/nonexistent').send({ lingkupPerjanjian: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when another requestor tries to edit', async () => {
    mockCurrentUser = { id: 'other-requestor', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    const res = await request(app).patch('/requests/request-1').send({});
    expect(res.status).toBe(403);
  });

  it('returns 400 when request is not DRAFT', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest({ status: 'WAITING' }) as any);
    const res = await request(app).patch('/requests/request-1').send({ lingkupPerjanjian: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DRAFT/);
  });

  it('returns 400 when updating vendor to deactivated', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, isActive: false } as any);
    const res = await request(app).patch('/requests/request-1').send({ vendorId: 'vendor-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  it('replaces attachment when new file is provided', async () => {
    const draft = makeRequest({
      attachments: [{ type: 'ADENDUM_PREVIOUS_AGREEMENT', fileUrl: 'old.pdf', fileName: 'old.pdf', fileSize: 100 }],
    });
    const updated = makeRequest();
    mockRequest.findUnique
      .mockResolvedValueOnce(draft as any)
      .mockResolvedValueOnce(updated as any);
    mockRequest.update.mockResolvedValue(updated as any);

    const res = await request(app)
      .patch('/requests/request-1')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', Buffer.from('new data'), {
        filename: 'new.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(mockAttachment.deleteMany).toHaveBeenCalledWith({
      where: { requestId: 'request-1', type: 'ADENDUM_PREVIOUS_AGREEMENT' },
    });
    expect(mockAttachment.create).toHaveBeenCalled();
  });

  it('returns 400 when vendorId provided for SURAT type in patch', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest({ type: 'SURAT', vendorId: null }) as any);
    const res = await request(app)
      .patch('/requests/request-1')
      .send({ vendorId: 'vendor-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vendorId/i);
  });

  it('returns 400 when vendor not found during patch', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    mockVendor.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch('/requests/request-1')
      .send({ vendorId: 'nonexistent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('updates to a valid active vendor', async () => {
    const draft = makeRequest({ vendorId: 'vendor-1' });
    const updated = makeRequest({ vendorId: 'vendor-2' });
    mockRequest.findUnique
      .mockResolvedValueOnce(draft as any)
      .mockResolvedValueOnce(updated as any);
    mockVendor.findUnique.mockResolvedValue({ ...baseVendor, id: 'vendor-2' } as any);
    mockRequest.update.mockResolvedValue(updated as any);

    const res = await request(app)
      .patch('/requests/request-1')
      .send({ vendorId: 'vendor-2' });

    expect(res.status).toBe(200);
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ vendorId: 'vendor-2' }) }),
    );
  });

  it('returns 500 when file upload fails during patch', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    mockStorageFrom.mockReturnValue(makeStorageBucket({ message: 'Storage error' }));
    const res = await request(app)
      .patch('/requests/request-1')
      .attach('ADENDUM_PREVIOUS_AGREEMENT', Buffer.from('data'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to upload/i);
  });

  it('updates jangkaWaktuStart and jangkaWaktuEnd', async () => {
    const draft = makeRequest();
    const updated = makeRequest({
      data: { ...draft.data, jangkaWaktuStart: new Date('2026-07-01'), jangkaWaktuEnd: new Date('2027-06-30') },
    });
    mockRequest.findUnique
      .mockResolvedValueOnce(draft as any)
      .mockResolvedValueOnce(updated as any);
    mockRequest.update.mockResolvedValue(updated as any);
    mockRequestData.update.mockResolvedValue({} as any);

    const res = await request(app)
      .patch('/requests/request-1')
      .send({ jangkaWaktuStart: '2026-07-01', jangkaWaktuEnd: '2027-06-30' });

    expect(res.status).toBe(200);
    expect(mockRequestData.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jangkaWaktuStart: new Date('2026-07-01'),
          jangkaWaktuEnd: new Date('2027-06-30'),
        }),
      }),
    );
  });

  it('returns 500 on unexpected database error during patch', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .patch('/requests/request-1')
      .send({ lingkupPerjanjian: 'Updated' });
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /requests/:id/submit — submit draft
// ─────────────────────────────────────────────────────────────────

describe('POST /requests/:id/submit', () => {
  it('submits a valid PERJANJIAN_BARU draft', async () => {
    const draft = makeRequest();
    mockRequest.findUnique.mockResolvedValue(draft as any);
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    const submitted = makeRequest({ status: 'WAITING', referenceNumber: '001/FIN/PB/V/2026' });
    mockRequest.update.mockResolvedValue(submitted as any);

    const res = await request(app).post('/requests/request-1/submit');

    expect(res.status).toBe(200);
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'WAITING', referenceNumber: '001/FIN/PB/V/2026' }),
      }),
    );
    expect(mockStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toStage: 'WAITING', fromStage: null }),
      }),
    );
  });

  it('returns 404 for non-existent request', async () => {
    mockRequest.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/requests/nonexistent/submit');
    expect(res.status).toBe(404);
  });

  it('returns 403 when another requestor tries to submit', async () => {
    mockCurrentUser = { id: 'other', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(403);
  });

  it('returns 400 when request is already WAITING', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest({ status: 'WAITING' }) as any);
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DRAFT/);
  });

  it('returns 400 when required fields are missing on submit', async () => {
    const incomplete = makeRequest({
      data: { ...makeRequest().data, lingkupPerjanjian: null },
    });
    mockRequest.findUnique.mockResolvedValue(incomplete as any);
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lingkupPerjanjian/i);
  });

  it('returns 400 when ADENDUM is missing attachment on submit', async () => {
    const adendumDraft = makeRequest({
      type: 'ADENDUM',
      attachments: [],
      data: {
        ...makeRequest().data,
        perjanjianSebelumnya: 'Old agreement',
        halYangInginDiubah: 'Change this',
      },
    });
    mockRequest.findUnique.mockResolvedValue(adendumDraft as any);
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Lampirkan/i);
  });

  it('stamps submittedAt and slaDeadline', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    mockRequest.update.mockResolvedValue(makeRequest({ status: 'WAITING' }) as any);

    await request(app).post('/requests/request-1/submit');

    const updateCall = mockRequest.update.mock.calls[0]?.[0];
    expect(updateCall?.data).toHaveProperty('submittedAt');
    expect(updateCall?.data).toHaveProperty('slaDeadline');
  });

  it('returns 403 for LEGAL_TEAM role', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(403);
  });

  it('returns 400 when linked vendor is deactivated at submit time', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeRequest({ vendor: { id: 'vendor-1', name: 'Test Vendor', kybStatus: 'APPROVED', isActive: false } }) as any,
    );
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deactivated/i);
  });

  it('returns 400 when requestor profile is not found at submit time', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/profile/i);
  });

  it('returns 500 on unexpected database error during submit', async () => {
    mockRequest.findUnique.mockResolvedValue(makeRequest() as any);
    mockVendor.findUnique.mockResolvedValue(baseVendor as any);
    mockProfile.findUnique.mockResolvedValue(baseProfile as any);
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).post('/requests/request-1/submit');
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /requests — list
// ─────────────────────────────────────────────────────────────────

describe('GET /requests', () => {
  it('REQUESTOR sees only own requests (filter applied)', async () => {
    mockRequest.findMany.mockResolvedValue([]);
    await request(app).get('/requests');
    expect(mockRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestorId: 'requestor-1' } }),
    );
  });

  it('LEGAL_TEAM sees all requests (no filter)', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockRequest.findMany.mockResolvedValue([]);
    await request(app).get('/requests');
    expect(mockRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('IT_ADMIN sees all requests (no filter)', async () => {
    mockCurrentUser = { id: 'admin-1', role: 'IT_ADMIN', isActive: true, profileCompleted: true };
    mockRequest.findMany.mockResolvedValue([]);
    await request(app).get('/requests');
    expect(mockRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('VENDOR sees only linked requests', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockRequest.findMany.mockResolvedValue([]);
    await request(app).get('/requests');
    expect(mockRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vendorId: 'vendor-1' } }),
    );
  });

  it('includes kybBlocked=true when vendor KYB is not APPROVED', async () => {
    mockRequest.findMany.mockResolvedValue([
      makeRequest({ vendor: { id: 'vendor-1', name: 'Vendor', kybStatus: 'SUBMITTED' } }),
    ] as any);

    const res = await request(app).get('/requests');

    expect(res.status).toBe(200);
    expect(res.body[0].kybBlocked).toBe(true);
  });

  it('includes kybBlocked=false when vendor KYB is APPROVED', async () => {
    mockRequest.findMany.mockResolvedValue([makeRequest()] as any);

    const res = await request(app).get('/requests');

    expect(res.status).toBe(200);
    expect(res.body[0].kybBlocked).toBe(false);
  });

  it('includes kybBlocked=false when no vendor linked', async () => {
    mockRequest.findMany.mockResolvedValue([makeRequest({ vendorId: null, vendor: null })] as any);

    const res = await request(app).get('/requests');

    expect(res.status).toBe(200);
    expect(res.body[0].kybBlocked).toBe(false);
  });

  it('returns 500 on unexpected database error', async () => {
    mockRequest.findMany.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/requests');
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /requests/:id — detail
// ─────────────────────────────────────────────────────────────────

describe('GET /requests/:id', () => {
  const fullRequest = {
    ...makeRequest(),
    finalDocuments: [],
    stageHistories: [],
    requestor: { id: 'requestor-1', name: 'Test User' },
  };

  it('returns full request detail', async () => {
    mockRequest.findUnique.mockResolvedValue(fullRequest as any);
    const res = await request(app).get('/requests/request-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('request-1');
    expect(res.body).toHaveProperty('kybBlocked');
  });

  it('returns 404 for non-existent request', async () => {
    mockRequest.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/requests/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 403 when REQUESTOR tries to access another requestor request', async () => {
    mockRequest.findUnique.mockResolvedValue({ ...fullRequest, requestorId: 'other-requestor' } as any);
    const res = await request(app).get('/requests/request-1');
    expect(res.status).toBe(403);
  });

  it('returns 403 when VENDOR tries to access unlinked request', async () => {
    mockCurrentUser = { id: 'vendor-2', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue({ ...fullRequest, vendorId: 'vendor-1' } as any);
    const res = await request(app).get('/requests/request-1');
    expect(res.status).toBe(403);
  });

  it('allows LEGAL_TEAM to view any request', async () => {
    mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(fullRequest as any);
    const res = await request(app).get('/requests/request-1');
    expect(res.status).toBe(200);
  });

  it('allows VENDOR to view linked request', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue({ ...fullRequest, vendorId: 'vendor-1' } as any);
    const res = await request(app).get('/requests/request-1');
    expect(res.status).toBe(200);
  });

  it('returns 500 on unexpected database error', async () => {
    mockRequest.findUnique.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/requests/request-1');
    expect(res.status).toBe(500);
  });
});
