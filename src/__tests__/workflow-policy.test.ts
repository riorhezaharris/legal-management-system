import { RequestStatus, RequestType, Role } from '@prisma/client';
import { evaluate, isValidForFinish, stampFirstHandler, WorkflowError, RequestSnapshot } from '../services/workflow-policy';
import { AuthUser } from '../middleware/auth';

// ─── fixtures ────────────────────────────────────────────────────────────────

function actor(role: Role, id = 'actor-1'): AuthUser {
  return { id, supabaseId: 'sb-1', email: 'a@example.com', role, isActive: true, profileCompleted: true };
}

function snap(overrides: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return {
    requestorId: 'requestor-1',
    status: RequestStatus.WAITING,
    type: RequestType.PERJANJIAN_BARU,
    firstHandlerId: null,
    vendor: { kybStatus: 'APPROVED' },
    ...overrides,
  };
}

function expectError(fn: () => unknown, pattern: string | RegExp, statusCode = 400) {
  try {
    fn();
    throw new Error('Expected WorkflowError but nothing was thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(WorkflowError);
    expect((err as WorkflowError).message).toMatch(pattern);
    expect((err as WorkflowError).statusCode).toBe(statusCode);
  }
}

// ─── terminal state guard ────────────────────────────────────────────────────

describe('evaluate — terminal state guard', () => {
  const terminals: RequestStatus[] = [
    RequestStatus.FINISHED,
    RequestStatus.CANCELLED,
    RequestStatus.REJECTED,
    RequestStatus.DRAFT,
  ];

  terminals.forEach((status) => {
    it(`blocks any action when request is ${status}`, () => {
      expectError(
        () => evaluate('ADVANCE', actor(Role.LEGAL_TEAM), snap({ status })),
        /terminal/i,
      );
    });
  });
});

// ─── ADVANCE ─────────────────────────────────────────────────────────────────

describe('evaluate — ADVANCE', () => {
  it('returns 403 for VENDOR role', () => {
    expectError(
      () => evaluate('ADVANCE', actor(Role.VENDOR), snap()),
      /Only REQUESTOR or LEGAL_TEAM/,
      403,
    );
  });

  it('returns 403 for IT_ADMIN role', () => {
    expectError(
      () => evaluate('ADVANCE', actor(Role.IT_ADMIN), snap()),
      /Only REQUESTOR or LEGAL_TEAM/,
      403,
    );
  });

  describe('REQUESTOR', () => {
    it('advances USER_REVIEW → LEGAL_REVIEW for own request', () => {
      const result = evaluate(
        'ADVANCE',
        actor(Role.REQUESTOR, 'requestor-1'),
        snap({ status: RequestStatus.USER_REVIEW }),
      );
      expect(result.toStage).toBe(RequestStatus.LEGAL_REVIEW);
    });

    it('returns 403 when advancing another requestor\'s request', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.REQUESTOR, 'other-user'),
            snap({ status: RequestStatus.USER_REVIEW }),
          ),
        /Forbidden/,
        403,
      );
    });

    it('returns 400 when advancing from a stage other than USER_REVIEW', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.REQUESTOR, 'requestor-1'),
            snap({ status: RequestStatus.WAITING }),
          ),
        /USER_REVIEW/,
      );
    });
  });

  describe('LEGAL_TEAM', () => {
    it('advances WAITING → LEGAL_REVIEW when no vendor linked', () => {
      const result = evaluate('ADVANCE', actor(Role.LEGAL_TEAM), snap({ vendor: null }));
      expect(result.toStage).toBe(RequestStatus.LEGAL_REVIEW);
    });

    it('advances WAITING → LEGAL_REVIEW when vendor KYB is APPROVED', () => {
      const result = evaluate('ADVANCE', actor(Role.LEGAL_TEAM), snap({ vendor: { kybStatus: 'APPROVED' } }));
      expect(result.toStage).toBe(RequestStatus.LEGAL_REVIEW);
    });

    it('blocks WAITING → LEGAL_REVIEW when vendor KYB is not APPROVED', () => {
      (['INVITED', 'SUBMITTED', 'REVISION'] as const).forEach((kybStatus) => {
        expectError(
          () => evaluate('ADVANCE', actor(Role.LEGAL_TEAM), snap({ vendor: { kybStatus } })),
          /kybBlocked/,
        );
      });
    });

    it('advances LEGAL_REVIEW → VENDOR_REVIEW for PERJANJIAN_BARU', () => {
      const result = evaluate(
        'ADVANCE',
        actor(Role.LEGAL_TEAM),
        snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.PERJANJIAN_BARU }),
      );
      expect(result.toStage).toBe(RequestStatus.VENDOR_REVIEW);
    });

    it('advances LEGAL_REVIEW → VENDOR_REVIEW for ADENDUM', () => {
      const result = evaluate(
        'ADVANCE',
        actor(Role.LEGAL_TEAM),
        snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.ADENDUM }),
      );
      expect(result.toStage).toBe(RequestStatus.VENDOR_REVIEW);
    });

    it('blocks ADVANCE from LEGAL_REVIEW for SURAT', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.LEGAL_TEAM),
            snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.SURAT }),
          ),
        /MARK_INTERNAL_SIGNING_REQUIRED/,
      );
    });

    it('blocks ADVANCE from LEGAL_REVIEW for PERMINTAAN_DOKUMEN', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.LEGAL_TEAM),
            snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.PERMINTAAN_DOKUMEN }),
          ),
        /MARK_INTERNAL_SIGNING_REQUIRED/,
      );
    });

    it('advances INTERNAL_SIGNING → VENDOR_SIGNING for PERJANJIAN_BARU', () => {
      const result = evaluate(
        'ADVANCE',
        actor(Role.LEGAL_TEAM),
        snap({ status: RequestStatus.INTERNAL_SIGNING, type: RequestType.PERJANJIAN_BARU }),
      );
      expect(result.toStage).toBe(RequestStatus.VENDOR_SIGNING);
    });

    it('advances INTERNAL_SIGNING → VENDOR_SIGNING for ADENDUM', () => {
      const result = evaluate(
        'ADVANCE',
        actor(Role.LEGAL_TEAM),
        snap({ status: RequestStatus.INTERNAL_SIGNING, type: RequestType.ADENDUM }),
      );
      expect(result.toStage).toBe(RequestStatus.VENDOR_SIGNING);
    });

    it('blocks ADVANCE from INTERNAL_SIGNING for SURAT', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.LEGAL_TEAM),
            snap({ status: RequestStatus.INTERNAL_SIGNING, type: RequestType.SURAT }),
          ),
        /documents/,
      );
    });

    it('blocks ADVANCE from VENDOR_REVIEW', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.LEGAL_TEAM),
            snap({ status: RequestStatus.VENDOR_REVIEW }),
          ),
        /CONFIRM_VENDOR/,
      );
    });

    it('blocks ADVANCE from VENDOR_SIGNING', () => {
      expectError(
        () =>
          evaluate(
            'ADVANCE',
            actor(Role.LEGAL_TEAM),
            snap({ status: RequestStatus.VENDOR_SIGNING }),
          ),
        /documents/,
      );
    });
  });
});

// ─── SEND_BACK ────────────────────────────────────────────────────────────────

describe('evaluate — SEND_BACK', () => {
  it('returns 403 for REQUESTOR', () => {
    expectError(
      () => evaluate('SEND_BACK', actor(Role.REQUESTOR), snap(), { remarks: 'fix this' }),
      /Only LEGAL_TEAM/,
      403,
    );
  });

  it('returns 400 when remarks are missing', () => {
    expectError(
      () => evaluate('SEND_BACK', actor(Role.LEGAL_TEAM), snap()),
      /remarks/,
    );
  });

  it('returns 400 when remarks are whitespace only', () => {
    expectError(
      () => evaluate('SEND_BACK', actor(Role.LEGAL_TEAM), snap(), { remarks: '   ' }),
      /remarks/,
    );
  });

  const sendBackAllowed: RequestStatus[] = [
    RequestStatus.WAITING,
    RequestStatus.LEGAL_REVIEW,
    RequestStatus.VENDOR_REVIEW,
    RequestStatus.INTERNAL_SIGNING,
    RequestStatus.VENDOR_SIGNING,
  ];

  sendBackAllowed.forEach((status) => {
    it(`sends back from ${status} → USER_REVIEW`, () => {
      const result = evaluate('SEND_BACK', actor(Role.LEGAL_TEAM), snap({ status }), { remarks: 'fix it' });
      expect(result.toStage).toBe(RequestStatus.USER_REVIEW);
    });
  });

  it('returns 400 when sending back from USER_REVIEW', () => {
    expectError(
      () =>
        evaluate('SEND_BACK', actor(Role.LEGAL_TEAM), snap({ status: RequestStatus.USER_REVIEW }), {
          remarks: 'fix it',
        }),
      /Cannot SEND_BACK/,
    );
  });
});

// ─── CANCEL ──────────────────────────────────────────────────────────────────

describe('evaluate — CANCEL', () => {
  it('returns 403 for VENDOR', () => {
    expectError(
      () => evaluate('CANCEL', actor(Role.VENDOR), snap()),
      /Only REQUESTOR or LEGAL_TEAM/,
      403,
    );
  });

  it('REQUESTOR cancels own request from WAITING', () => {
    const result = evaluate('CANCEL', actor(Role.REQUESTOR, 'requestor-1'), snap());
    expect(result.toStage).toBe(RequestStatus.CANCELLED);
  });

  it('REQUESTOR cancels own request from USER_REVIEW', () => {
    const result = evaluate(
      'CANCEL',
      actor(Role.REQUESTOR, 'requestor-1'),
      snap({ status: RequestStatus.USER_REVIEW }),
    );
    expect(result.toStage).toBe(RequestStatus.CANCELLED);
  });

  it('returns 403 when REQUESTOR cancels another requestor\'s request', () => {
    expectError(
      () => evaluate('CANCEL', actor(Role.REQUESTOR, 'other'), snap()),
      /Forbidden/,
      403,
    );
  });

  it('returns 400 when REQUESTOR cancels from LEGAL_REVIEW', () => {
    expectError(
      () =>
        evaluate(
          'CANCEL',
          actor(Role.REQUESTOR, 'requestor-1'),
          snap({ status: RequestStatus.LEGAL_REVIEW }),
        ),
      /WAITING or USER_REVIEW/,
    );
  });

  it('LEGAL_TEAM can cancel from any active stage', () => {
    const stages = [
      RequestStatus.WAITING,
      RequestStatus.LEGAL_REVIEW,
      RequestStatus.VENDOR_REVIEW,
      RequestStatus.INTERNAL_SIGNING,
      RequestStatus.VENDOR_SIGNING,
      RequestStatus.USER_REVIEW,
    ];
    stages.forEach((status) => {
      const result = evaluate('CANCEL', actor(Role.LEGAL_TEAM), snap({ status }));
      expect(result.toStage).toBe(RequestStatus.CANCELLED);
    });
  });
});

// ─── REJECT ──────────────────────────────────────────────────────────────────

describe('evaluate — REJECT', () => {
  it('returns 403 for REQUESTOR', () => {
    expectError(
      () => evaluate('REJECT', actor(Role.REQUESTOR), snap(), { reason: 'no' }),
      /Only LEGAL_TEAM/,
      403,
    );
  });

  it('returns 400 when reason is missing', () => {
    expectError(
      () => evaluate('REJECT', actor(Role.LEGAL_TEAM), snap()),
      /reason/,
    );
  });

  it('rejects with reason in extraData', () => {
    const result = evaluate('REJECT', actor(Role.LEGAL_TEAM), snap(), { reason: 'Not compliant' });
    expect(result.toStage).toBe(RequestStatus.REJECTED);
    expect(result.extraData.rejectionReason).toBe('Not compliant');
  });
});

// ─── CONFIRM_VENDOR ──────────────────────────────────────────────────────────

describe('evaluate — CONFIRM_VENDOR', () => {
  it('returns 403 for REQUESTOR', () => {
    expectError(
      () =>
        evaluate('CONFIRM_VENDOR', actor(Role.REQUESTOR), snap({ status: RequestStatus.VENDOR_REVIEW })),
      /Only LEGAL_TEAM/,
      403,
    );
  });

  it('returns 400 when not in VENDOR_REVIEW', () => {
    expectError(
      () => evaluate('CONFIRM_VENDOR', actor(Role.LEGAL_TEAM), snap({ status: RequestStatus.WAITING })),
      /VENDOR_REVIEW/,
    );
  });

  it('advances VENDOR_REVIEW → INTERNAL_SIGNING', () => {
    const result = evaluate(
      'CONFIRM_VENDOR',
      actor(Role.LEGAL_TEAM),
      snap({ status: RequestStatus.VENDOR_REVIEW }),
    );
    expect(result.toStage).toBe(RequestStatus.INTERNAL_SIGNING);
  });
});

// ─── MARK_INTERNAL_SIGNING_REQUIRED ──────────────────────────────────────────

describe('evaluate — MARK_INTERNAL_SIGNING_REQUIRED', () => {
  it('returns 403 for REQUESTOR', () => {
    expectError(
      () =>
        evaluate(
          'MARK_INTERNAL_SIGNING_REQUIRED',
          actor(Role.REQUESTOR),
          snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.SURAT }),
        ),
      /Only LEGAL_TEAM/,
      403,
    );
  });

  it('returns 400 when not in LEGAL_REVIEW', () => {
    expectError(
      () =>
        evaluate(
          'MARK_INTERNAL_SIGNING_REQUIRED',
          actor(Role.LEGAL_TEAM),
          snap({ status: RequestStatus.WAITING, type: RequestType.SURAT }),
        ),
      /LEGAL_REVIEW/,
    );
  });

  it('returns 400 for PERJANJIAN_BARU type', () => {
    expectError(
      () =>
        evaluate(
          'MARK_INTERNAL_SIGNING_REQUIRED',
          actor(Role.LEGAL_TEAM),
          snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.PERJANJIAN_BARU }),
        ),
      /SURAT and PERMINTAAN_DOKUMEN/,
    );
  });

  it('marks SURAT LEGAL_REVIEW → INTERNAL_SIGNING with requiresInternalSigning flag', () => {
    const result = evaluate(
      'MARK_INTERNAL_SIGNING_REQUIRED',
      actor(Role.LEGAL_TEAM),
      snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.SURAT }),
    );
    expect(result.toStage).toBe(RequestStatus.INTERNAL_SIGNING);
    expect(result.extraData.requiresInternalSigning).toBe(true);
  });

  it('marks PERMINTAAN_DOKUMEN LEGAL_REVIEW → INTERNAL_SIGNING', () => {
    const result = evaluate(
      'MARK_INTERNAL_SIGNING_REQUIRED',
      actor(Role.LEGAL_TEAM),
      snap({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.PERMINTAAN_DOKUMEN }),
    );
    expect(result.toStage).toBe(RequestStatus.INTERNAL_SIGNING);
  });
});

// ─── firstHandlerId stamping ──────────────────────────────────────────────────

describe('evaluate — firstHandlerId stamping', () => {
  it('stamps firstHandlerId when LEGAL_TEAM acts and no handler is set', () => {
    const result = evaluate('ADVANCE', actor(Role.LEGAL_TEAM, 'legal-1'), snap({ firstHandlerId: null }));
    expect(result.extraData.firstHandlerId).toBe('legal-1');
  });

  it('does not overwrite firstHandlerId when already set', () => {
    const result = evaluate(
      'ADVANCE',
      actor(Role.LEGAL_TEAM, 'legal-2'),
      snap({ firstHandlerId: 'legal-1' }),
    );
    expect(result.extraData.firstHandlerId).toBeUndefined();
  });

  it('does not stamp firstHandlerId for REQUESTOR actions', () => {
    const result = evaluate(
      'ADVANCE',
      actor(Role.REQUESTOR, 'requestor-1'),
      snap({ status: RequestStatus.USER_REVIEW }),
    );
    expect(result.extraData.firstHandlerId).toBeUndefined();
  });
});

// ─── isValidForFinish ─────────────────────────────────────────────────────────

describe('isValidForFinish', () => {
  it('returns true for VENDOR_SIGNING (any type)', () => {
    expect(
      isValidForFinish({ status: RequestStatus.VENDOR_SIGNING, type: RequestType.PERJANJIAN_BARU, requiresInternalSigning: false }),
    ).toBe(true);
  });

  it('returns true for SURAT at INTERNAL_SIGNING when requiresInternalSigning', () => {
    expect(
      isValidForFinish({ status: RequestStatus.INTERNAL_SIGNING, type: RequestType.SURAT, requiresInternalSigning: true }),
    ).toBe(true);
  });

  it('returns false for SURAT at INTERNAL_SIGNING when requiresInternalSigning is false', () => {
    expect(
      isValidForFinish({ status: RequestStatus.INTERNAL_SIGNING, type: RequestType.SURAT, requiresInternalSigning: false }),
    ).toBe(false);
  });

  it('returns true for SURAT at LEGAL_REVIEW when signing not required', () => {
    expect(
      isValidForFinish({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.SURAT, requiresInternalSigning: false }),
    ).toBe(true);
  });

  it('returns false for SURAT at LEGAL_REVIEW when requiresInternalSigning is true', () => {
    expect(
      isValidForFinish({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.SURAT, requiresInternalSigning: true }),
    ).toBe(false);
  });

  it('returns true for PERMINTAAN_DOKUMEN at LEGAL_REVIEW when signing not required', () => {
    expect(
      isValidForFinish({ status: RequestStatus.LEGAL_REVIEW, type: RequestType.PERMINTAAN_DOKUMEN, requiresInternalSigning: false }),
    ).toBe(true);
  });

  it('returns false for PERJANJIAN_BARU at INTERNAL_SIGNING', () => {
    expect(
      isValidForFinish({ status: RequestStatus.INTERNAL_SIGNING, type: RequestType.PERJANJIAN_BARU, requiresInternalSigning: false }),
    ).toBe(false);
  });

  it('returns false for WAITING', () => {
    expect(
      isValidForFinish({ status: RequestStatus.WAITING, type: RequestType.SURAT, requiresInternalSigning: false }),
    ).toBe(false);
  });
});

// ─── stampFirstHandler ────────────────────────────────────────────────────────

describe('stampFirstHandler', () => {
  it('returns firstHandlerId when LEGAL_TEAM and no handler set', () => {
    expect(stampFirstHandler(actor(Role.LEGAL_TEAM, 'legal-1'), { firstHandlerId: null })).toEqual({
      firstHandlerId: 'legal-1',
    });
  });

  it('returns empty object when LEGAL_TEAM but handler already set', () => {
    expect(stampFirstHandler(actor(Role.LEGAL_TEAM, 'legal-2'), { firstHandlerId: 'legal-1' })).toEqual({});
  });

  it('returns empty object for REQUESTOR', () => {
    expect(stampFirstHandler(actor(Role.REQUESTOR), { firstHandlerId: null })).toEqual({});
  });

  it('returns empty object for IT_ADMIN', () => {
    expect(stampFirstHandler(actor(Role.IT_ADMIN), { firstHandlerId: null })).toEqual({});
  });
});
