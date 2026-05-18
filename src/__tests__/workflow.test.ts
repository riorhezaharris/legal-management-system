import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { resend } from '../lib/resend';

let mockCurrentUser = {
  id: 'legal-1',
  role: 'LEGAL_TEAM',
  isActive: true,
  profileCompleted: true,
};

jest.mock('../lib/prisma', () => {
  const prismaMock: any = {
    legalRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    stageHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    finalDocument: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
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

const mockRequest = prisma.legalRequest as jest.Mocked<typeof prisma.legalRequest>;
const mockStageHistory = prisma.stageHistory as jest.Mocked<typeof prisma.stageHistory>;
const mockFinalDocument = prisma.finalDocument as jest.Mocked<typeof prisma.finalDocument>;
const mockStorageFrom = storage.from as jest.Mock;
const mockResend = (resend as any).emails;

const makeStorageBucket = (uploadError: any = null, publicUrl = 'https://storage.example.com/file.pdf') => ({
  upload: jest.fn().mockResolvedValue({ error: uploadError }),
  getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl } }),
});

const baseRequestor = { id: 'requestor-1', name: 'Test Requestor', email: 'requestor@example.com' };

const makeReq = (overrides: Record<string, any> = {}) => ({
  id: 'request-1',
  requestorId: 'requestor-1',
  type: 'PERJANJIAN_BARU',
  status: 'WAITING',
  referenceNumber: '001/FIN/PB/V/2026',
  vendorId: 'vendor-1',
  submittedAt: new Date(),
  slaDeadline: new Date(),
  firstHandlerId: null,
  rejectionReason: null,
  requiresInternalSigning: false,
  vendor: { kybStatus: 'APPROVED' },
  requestor: baseRequestor,
  createdAt: new Date(),
  updatedAt: new Date(),
  data: null,
  attachments: [],
  finalDocuments: [],
  stageHistories: [],
  ...overrides,
});

const makeUpdatedReq = (overrides: Record<string, any> = {}) => ({
  ...makeReq(),
  vendor: { id: 'vendor-1', name: 'Test Vendor', kybStatus: 'APPROVED' },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { id: 'legal-1', role: 'LEGAL_TEAM', isActive: true, profileCompleted: true };
  mockStorageFrom.mockReturnValue(makeStorageBucket());
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
  mockStageHistory.create.mockResolvedValue({} as any);
  mockFinalDocument.createMany.mockResolvedValue({ count: 1 } as any);
  mockResend.send.mockResolvedValue({ data: { id: 'email-1' } });
});

// ─────────────────────────────────────────────────────────────────
// POST /requests/:id/transition — invalid action
// ─────────────────────────────────────────────────────────────────

describe('POST /requests/:id/transition — validation', () => {
  it('returns 400 when action is missing', async () => {
    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/i);
  });

  it('returns 400 when action is invalid', async () => {
    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'INVALID_ACTION' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/i);
  });

  it('returns 403 for IT_ADMIN role', async () => {
    mockCurrentUser = { id: 'admin-1', role: 'IT_ADMIN', isActive: true, profileCompleted: true };
    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });
    expect(res.status).toBe(403);
  });

  it('returns 403 for VENDOR role', async () => {
    mockCurrentUser = { id: 'vendor-1', role: 'VENDOR', isActive: true, profileCompleted: true };
    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when request not found', async () => {
    mockRequest.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
// Terminal state guard
// ─────────────────────────────────────────────────────────────────

describe('Terminal state guard', () => {
  for (const status of ['FINISHED', 'CANCELLED', 'REJECTED', 'DRAFT']) {
    it(`returns 400 when request is in ${status}`, async () => {
      mockRequest.findUnique.mockResolvedValue(makeReq({ status }) as any);
      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/terminal/i);
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// ADVANCE
// ─────────────────────────────────────────────────────────────────

describe('ADVANCE', () => {
  describe('LEGAL_TEAM: WAITING → LEGAL_REVIEW', () => {
    it('succeeds when vendor KYB is APPROVED', async () => {
      const req = makeReq({ status: 'WAITING', vendor: { kybStatus: 'APPROVED' } });
      mockRequest.findUnique.mockResolvedValue(req as any);
      const updated = makeUpdatedReq({ status: 'LEGAL_REVIEW', firstHandlerId: 'legal-1' });
      mockRequest.update.mockResolvedValue(updated as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'LEGAL_REVIEW' }),
        }),
      );
    });

    it('succeeds when there is no vendor (SURAT type)', async () => {
      const req = makeReq({ status: 'WAITING', type: 'SURAT', vendorId: null, vendor: null });
      mockRequest.findUnique.mockResolvedValue(req as any);
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'LEGAL_REVIEW' }),
        }),
      );
    });

    it('blocks when vendor KYB is SUBMITTED (kybBlocked)', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', vendor: { kybStatus: 'SUBMITTED' } }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/kybBlocked/i);
    });

    it('blocks when vendor KYB is INVITED', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', vendor: { kybStatus: 'INVITED' } }) as any,
      );
      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });
      expect(res.status).toBe(400);
    });

    it('blocks when vendor KYB is REVISION', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', vendor: { kybStatus: 'REVISION' } }) as any,
      );
      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });
      expect(res.status).toBe(400);
    });

    it('sets firstHandlerId when legal team first acts', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', firstHandlerId: null }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

      await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ firstHandlerId: 'legal-1' }),
        }),
      );
    });

    it('does not overwrite firstHandlerId on subsequent actions', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', firstHandlerId: 'legal-original' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

      await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ firstHandlerId: expect.anything() }),
        }),
      );
    });
  });

  describe('LEGAL_TEAM: LEGAL_REVIEW → VENDOR_REVIEW (PERJANJIAN_BARU)', () => {
    it('succeeds for PERJANJIAN_BARU', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'LEGAL_REVIEW', type: 'PERJANJIAN_BARU' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'VENDOR_REVIEW' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'VENDOR_REVIEW' }) }),
      );
    });

    it('succeeds for ADENDUM', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'LEGAL_REVIEW', type: 'ADENDUM' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'VENDOR_REVIEW' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
    });

    it('blocks for SURAT from LEGAL_REVIEW (must use MARK_INTERNAL_SIGNING_REQUIRED or docs)', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'LEGAL_REVIEW', type: 'SURAT', vendorId: null, vendor: null }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
    });

    it('blocks for PERMINTAAN_DOKUMEN from LEGAL_REVIEW', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'LEGAL_REVIEW', type: 'PERMINTAAN_DOKUMEN', vendorId: null, vendor: null }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
    });
  });

  describe('LEGAL_TEAM: INTERNAL_SIGNING → VENDOR_SIGNING (PERJANJIAN_BARU/ADENDUM)', () => {
    it('succeeds for PERJANJIAN_BARU', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'INTERNAL_SIGNING', type: 'PERJANJIAN_BARU' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'VENDOR_SIGNING' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'VENDOR_SIGNING' }) }),
      );
    });

    it('succeeds for ADENDUM', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'INTERNAL_SIGNING', type: 'ADENDUM' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'VENDOR_SIGNING' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
    });

    it('blocks for SURAT from INTERNAL_SIGNING (must use docs endpoint)', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({
          status: 'INTERNAL_SIGNING',
          type: 'SURAT',
          requiresInternalSigning: true,
          vendorId: null,
          vendor: null,
        }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
    });
  });

  describe('LEGAL_TEAM: ADVANCE from invalid stages', () => {
    it('blocks from VENDOR_REVIEW (use CONFIRM_VENDOR instead)', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'VENDOR_REVIEW' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/CONFIRM_VENDOR/i);
    });

    it('blocks from VENDOR_SIGNING (use documents endpoint)', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'VENDOR_SIGNING' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
    });
  });

  describe('REQUESTOR: USER_REVIEW → LEGAL_REVIEW', () => {
    it('succeeds for request owner', async () => {
      mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'USER_REVIEW', requestorId: 'requestor-1' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'LEGAL_REVIEW' }) }),
      );
    });

    it('returns 403 when requestor does not own the request', async () => {
      mockCurrentUser = { id: 'other-requestor', role: 'REQUESTOR', isActive: true, profileCompleted: true };
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'USER_REVIEW', requestorId: 'requestor-1' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(403);
    });

    it('blocks from WAITING (requestor cannot advance WAITING)', async () => {
      mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', requestorId: 'requestor-1' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/USER_REVIEW/i);
    });

    it('blocks from LEGAL_REVIEW', async () => {
      mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'LEGAL_REVIEW', requestorId: 'requestor-1' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// SEND_BACK
// ─────────────────────────────────────────────────────────────────

describe('SEND_BACK', () => {
  const sendBackAllowed = ['WAITING', 'LEGAL_REVIEW', 'VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING'];

  for (const status of sendBackAllowed) {
    it(`succeeds from ${status} with remarks`, async () => {
      mockRequest.findUnique.mockResolvedValue(makeReq({ status }) as any);
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'USER_REVIEW' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'SEND_BACK', remarks: 'Please revise section 3.' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'USER_REVIEW' }) }),
      );
    });
  }

  it('returns 400 when remarks are missing', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'LEGAL_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/remarks/i);
  });

  it('returns 400 when remarks are empty string', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'LEGAL_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK', remarks: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 403 when REQUESTOR tries to send back', async () => {
    mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'LEGAL_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK', remarks: 'Go back.' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when trying to send back from USER_REVIEW', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'USER_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK', remarks: 'remarks' });

    expect(res.status).toBe(400);
  });

  it('stores remarks in StageHistory', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'LEGAL_REVIEW' }) as any);
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'USER_REVIEW' }) as any);

    await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK', remarks: 'Fix the scope.' });

    expect(mockStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStage: 'LEGAL_REVIEW',
          toStage: 'USER_REVIEW',
          remarks: 'Fix the scope.',
        }),
      }),
    );
  });

  it('sends notification email to requestor', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'LEGAL_REVIEW' }) as any);
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'USER_REVIEW' }) as any);

    await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK', remarks: 'Fix it.' });

    await new Promise((r) => setImmediate(r));
    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'requestor@example.com' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// CANCEL
// ─────────────────────────────────────────────────────────────────

describe('CANCEL', () => {
  describe('REQUESTOR cancel', () => {
    beforeEach(() => {
      mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    });

    it('succeeds from WAITING', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', requestorId: 'requestor-1' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'CANCELLED' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'CANCEL' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
    });

    it('succeeds from USER_REVIEW', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'USER_REVIEW', requestorId: 'requestor-1' }) as any,
      );
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'CANCELLED' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'CANCEL' });

      expect(res.status).toBe(200);
    });

    it('returns 400 from LEGAL_REVIEW', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'LEGAL_REVIEW', requestorId: 'requestor-1' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'CANCEL' });

      expect(res.status).toBe(400);
    });

    it('returns 403 when cancelling another requestor request', async () => {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', requestorId: 'other-requestor' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'CANCEL' });

      expect(res.status).toBe(403);
    });

    for (const status of ['VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING']) {
      it(`returns 400 from ${status}`, async () => {
        mockRequest.findUnique.mockResolvedValue(
          makeReq({ status, requestorId: 'requestor-1' }) as any,
        );

        const res = await request(app)
          .post('/requests/request-1/transition')
          .send({ action: 'CANCEL' });

        expect(res.status).toBe(400);
      });
    }
  });

  describe('LEGAL_TEAM cancel', () => {
    const allActiveStages = [
      'WAITING', 'LEGAL_REVIEW', 'USER_REVIEW',
      'VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING',
    ];

    for (const status of allActiveStages) {
      it(`succeeds from ${status}`, async () => {
        mockRequest.findUnique.mockResolvedValue(makeReq({ status }) as any);
        mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'CANCELLED' }) as any);

        const res = await request(app)
          .post('/requests/request-1/transition')
          .send({ action: 'CANCEL' });

        expect(res.status).toBe(200);
        expect(mockRequest.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
        );
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// REJECT
// ─────────────────────────────────────────────────────────────────

describe('REJECT', () => {
  const allActiveStages = [
    'WAITING', 'LEGAL_REVIEW', 'USER_REVIEW',
    'VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING',
  ];

  for (const status of allActiveStages) {
    it(`LEGAL_TEAM can reject from ${status}`, async () => {
      mockRequest.findUnique.mockResolvedValue(makeReq({ status }) as any);
      mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'REJECTED' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'REJECT', reason: 'Not compliant.' });

      expect(res.status).toBe(200);
      expect(mockRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Not compliant.' }),
        }),
      );
    });
  }

  it('returns 400 when reason is missing', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'WAITING' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'REJECT' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  it('returns 400 when reason is empty string', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'WAITING' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'REJECT', reason: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 403 when REQUESTOR tries to reject', async () => {
    mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'WAITING' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'REJECT', reason: 'reason' });

    expect(res.status).toBe(403);
  });

  it('stores reason in StageHistory remarks', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'WAITING' }) as any);
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'REJECTED' }) as any);

    await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'REJECT', reason: 'Policy violation.' });

    expect(mockStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remarks: 'Policy violation.' }),
      }),
    );
  });

  it('sends rejection email to requestor', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'WAITING' }) as any);
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'REJECTED' }) as any);

    await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'REJECT', reason: 'Policy violation.' });

    await new Promise((r) => setImmediate(r));
    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'requestor@example.com',
        subject: expect.stringContaining('Ditolak'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// CONFIRM_VENDOR
// ─────────────────────────────────────────────────────────────────

describe('CONFIRM_VENDOR', () => {
  it('advances from VENDOR_REVIEW to INTERNAL_SIGNING', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'VENDOR_REVIEW' }) as any);
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'INTERNAL_SIGNING' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'CONFIRM_VENDOR' });

    expect(res.status).toBe(200);
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INTERNAL_SIGNING' }) }),
    );
  });

  it('returns 400 from any other stage', async () => {
    for (const status of ['WAITING', 'LEGAL_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING']) {
      mockRequest.findUnique.mockResolvedValue(makeReq({ status }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'CONFIRM_VENDOR' });

      expect(res.status).toBe(400);
    }
  });

  it('returns 403 when REQUESTOR tries CONFIRM_VENDOR', async () => {
    mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'VENDOR_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'CONFIRM_VENDOR' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// MARK_INTERNAL_SIGNING_REQUIRED
// ─────────────────────────────────────────────────────────────────

describe('MARK_INTERNAL_SIGNING_REQUIRED', () => {
  it('advances SURAT from LEGAL_REVIEW to INTERNAL_SIGNING and sets flag', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'LEGAL_REVIEW', type: 'SURAT', vendorId: null, vendor: null }) as any,
    );
    mockRequest.update.mockResolvedValue(
      makeUpdatedReq({ status: 'INTERNAL_SIGNING', requiresInternalSigning: true }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'MARK_INTERNAL_SIGNING_REQUIRED' });

    expect(res.status).toBe(200);
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'INTERNAL_SIGNING',
          requiresInternalSigning: true,
        }),
      }),
    );
  });

  it('advances PERMINTAAN_DOKUMEN from LEGAL_REVIEW to INTERNAL_SIGNING and sets flag', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'LEGAL_REVIEW', type: 'PERMINTAAN_DOKUMEN', vendorId: null, vendor: null }) as any,
    );
    mockRequest.update.mockResolvedValue(
      makeUpdatedReq({ status: 'INTERNAL_SIGNING', requiresInternalSigning: true }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'MARK_INTERNAL_SIGNING_REQUIRED' });

    expect(res.status).toBe(200);
  });

  it('returns 400 for PERJANJIAN_BARU (only valid for SURAT/PERMINTAAN_DOKUMEN)', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'LEGAL_REVIEW', type: 'PERJANJIAN_BARU' }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'MARK_INTERNAL_SIGNING_REQUIRED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SURAT|PERMINTAAN_DOKUMEN/i);
  });

  it('returns 400 for ADENDUM', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'LEGAL_REVIEW', type: 'ADENDUM' }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'MARK_INTERNAL_SIGNING_REQUIRED' });

    expect(res.status).toBe(400);
  });

  it('returns 400 from non-LEGAL_REVIEW stage', async () => {
    for (const status of ['WAITING', 'VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING']) {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status, type: 'SURAT' }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'MARK_INTERNAL_SIGNING_REQUIRED' });

      expect(res.status).toBe(400);
    }
  });

  it('returns 403 when REQUESTOR tries MARK_INTERNAL_SIGNING_REQUIRED', async () => {
    mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'LEGAL_REVIEW', type: 'SURAT' }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'MARK_INTERNAL_SIGNING_REQUIRED' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// StageHistory recording
// ─────────────────────────────────────────────────────────────────

describe('StageHistory', () => {
  it('records a StageHistory entry on every successful transition', async () => {
    mockRequest.findUnique.mockResolvedValue(makeReq({ status: 'WAITING' }) as any);
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

    await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });

    expect(mockStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: 'request-1',
          fromStage: 'WAITING',
          toStage: 'LEGAL_REVIEW',
          actorId: 'legal-1',
        }),
      }),
    );
  });

  it('does not record StageHistory when transition fails', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'WAITING', vendor: { kybStatus: 'SUBMITTED' } }) as any,
    );

    await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });

    expect(mockStageHistory.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// Revision loop
// ─────────────────────────────────────────────────────────────────

describe('Revision loop', () => {
  it('SEND_BACK from LEGAL_REVIEW → USER_REVIEW, then ADVANCE from USER_REVIEW → LEGAL_REVIEW', async () => {
    // Step 1: SEND_BACK
    mockRequest.findUnique.mockResolvedValueOnce(
      makeReq({ status: 'LEGAL_REVIEW' }) as any,
    );
    mockRequest.update.mockResolvedValueOnce(makeUpdatedReq({ status: 'USER_REVIEW' }) as any);

    const sendBackRes = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'SEND_BACK', remarks: 'Please revise.' });
    expect(sendBackRes.status).toBe(200);
    expect(sendBackRes.body.status).toBe('USER_REVIEW');

    // Step 2: Requestor re-submits
    mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };
    mockRequest.findUnique.mockResolvedValueOnce(
      makeReq({ status: 'USER_REVIEW', requestorId: 'requestor-1' }) as any,
    );
    mockRequest.update.mockResolvedValueOnce(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

    const advanceRes = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });
    expect(advanceRes.status).toBe(200);
    expect(advanceRes.body.status).toBe('LEGAL_REVIEW');
  });

  it('SEND_BACK can be triggered from every applicable stage', async () => {
    const stages = ['WAITING', 'LEGAL_REVIEW', 'VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING'];
    for (const status of stages) {
      mockRequest.findUnique.mockResolvedValueOnce(makeReq({ status }) as any);
      mockRequest.update.mockResolvedValueOnce(makeUpdatedReq({ status: 'USER_REVIEW' }) as any);

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'SEND_BACK', remarks: 'Revise.' });

      expect(res.status).toBe(200);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /requests/:id/documents — final document upload
// ─────────────────────────────────────────────────────────────────

describe('POST /requests/:id/documents', () => {
  it('returns 403 for non-LEGAL_TEAM roles', async () => {
    mockCurrentUser = { id: 'requestor-1', role: 'REQUESTOR', isActive: true, profileCompleted: true };

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when no files are provided', async () => {
    const res = await request(app)
      .post('/requests/request-1/documents');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file/i);
  });

  it('returns 404 when request not found', async () => {
    mockRequest.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(404);
  });

  it('transitions VENDOR_SIGNING → FINISHED and creates FinalDocument records', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING', type: 'PERJANJIAN_BARU' }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf content'), {
        filename: 'signed.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(200);
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FINISHED' }) }),
    );
    expect(mockFinalDocument.createMany).toHaveBeenCalled();
    expect(mockStageHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStage: 'VENDOR_SIGNING', toStage: 'FINISHED' }),
      }),
    );
  });

  it('transitions LEGAL_REVIEW → FINISHED for SURAT without internal signing', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({
        status: 'LEGAL_REVIEW',
        type: 'SURAT',
        requiresInternalSigning: false,
        vendorId: null,
        vendor: null,
      }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'letter.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FINISHED' }) }),
    );
  });

  it('transitions INTERNAL_SIGNING → FINISHED for SURAT with requiresInternalSigning=true', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({
        status: 'INTERNAL_SIGNING',
        type: 'SURAT',
        requiresInternalSigning: true,
        vendorId: null,
        vendor: null,
      }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'signed.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
  });

  it('transitions INTERNAL_SIGNING → FINISHED for PERMINTAAN_DOKUMEN with requiresInternalSigning=true', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({
        status: 'INTERNAL_SIGNING',
        type: 'PERMINTAAN_DOKUMEN',
        requiresInternalSigning: true,
        vendorId: null,
        vendor: null,
      }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when trying to finalize from an invalid stage (e.g. WAITING)', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'WAITING', type: 'PERJANJIAN_BARU' }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/WAITING/i);
  });

  it('returns 400 when trying to finalize PERJANJIAN_BARU from INTERNAL_SIGNING (needs to go to VENDOR_SIGNING first)', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({
        status: 'INTERNAL_SIGNING',
        type: 'PERJANJIAN_BARU',
        requiresInternalSigning: false,
      }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when file is too large', async () => {
    mockStorageFrom.mockReturnValue({
      upload: jest.fn().mockResolvedValue({ error: null }),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/file.pdf' } }),
    });
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING' }) as any,
    );

    // Multer will reject files over 20MB before reaching our handler
    const largeBuffer = Buffer.alloc(21 * 1024 * 1024, 'a');

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', largeBuffer, { filename: 'large.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('returns 500 when storage upload fails', async () => {
    mockStorageFrom.mockReturnValue(
      makeStorageBucket({ message: 'Storage bucket not found' }),
    );
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING' }) as any,
    );

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to upload/i);
  });

  it('sets firstHandlerId when uploading documents if not already set', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING', firstHandlerId: null }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstHandlerId: 'legal-1' }),
      }),
    );
  });

  it('does not overwrite firstHandlerId when already set', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING', firstHandlerId: 'original-handler' }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(mockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ firstHandlerId: expect.anything() }),
      }),
    );
  });

  it('accepts multiple files in one request', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING' }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    const res = await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf1'), { filename: 'doc1.pdf', contentType: 'application/pdf' })
      .attach('documents', Buffer.from('pdf2'), { filename: 'doc2.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(mockFinalDocument.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ fileName: 'doc1.pdf' }),
          expect.objectContaining({ fileName: 'doc2.pdf' }),
        ]),
      }),
    );
  });

  it('sends finished email to requestor', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'VENDOR_SIGNING' }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'FINISHED' }) as any);

    await request(app)
      .post('/requests/request-1/documents')
      .attach('documents', Buffer.from('pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    await new Promise((r) => setImmediate(r));
    expect(mockResend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'requestor@example.com',
        subject: expect.stringContaining('Selesai'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// KYB gate — end-to-end verify via transition service
// ─────────────────────────────────────────────────────────────────

describe('KYB gate', () => {
  it('passes when vendor KYB is APPROVED', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'WAITING', vendor: { kybStatus: 'APPROVED' } }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });

    expect(res.status).toBe(200);
  });

  it('blocks when vendor KYB is not APPROVED', async () => {
    for (const kybStatus of ['INVITED', 'SUBMITTED', 'REVISION']) {
      mockRequest.findUnique.mockResolvedValue(
        makeReq({ status: 'WAITING', vendor: { kybStatus } }) as any,
      );

      const res = await request(app)
        .post('/requests/request-1/transition')
        .send({ action: 'ADVANCE' });

      expect(res.status).toBe(400);
    }
  });

  it('passes when no vendor is linked (SURAT/PERMINTAAN_DOKUMEN)', async () => {
    mockRequest.findUnique.mockResolvedValue(
      makeReq({ status: 'WAITING', type: 'SURAT', vendorId: null, vendor: null }) as any,
    );
    mockRequest.update.mockResolvedValue(makeUpdatedReq({ status: 'LEGAL_REVIEW' }) as any);

    const res = await request(app)
      .post('/requests/request-1/transition')
      .send({ action: 'ADVANCE' });

    expect(res.status).toBe(200);
  });
});
