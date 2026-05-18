import { resend } from '../lib/resend';
import {
  notifyLegalTeamNewRequest,
  notifyRequestorStageAdvanced,
  notifyRequestorSentBack,
  notifyRequestorFinished,
  notifyRequestorRejected,
  notifyVendorInvitation,
  notifyLegalTeamKybSubmitted,
  notifyLegalTeamKybUpdated,
  notifyLegalTeamKybResubmitted,
  notifyVendorKybRevision,
  notifyLegalTeamSlaApproaching,
  notifyLegalTeamSlaBreached,
  notifyRequestorSlaBreached,
} from '../services/notifications';

jest.mock('../lib/resend', () => ({
  resend: {
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'email-1' } }),
    },
  },
}));

const mockSend = (resend as any).emails.send as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// notifyLegalTeamNewRequest
// ─────────────────────────────────────────────────────────────────

describe('notifyLegalTeamNewRequest', () => {
  it('sends email to all legal team members', () => {
    notifyLegalTeamNewRequest(['a@example.com', 'b@example.com'], '001/FIN/PB/V/2026');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com' }));
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'b@example.com' }));
  });

  it('includes reference number in subject', () => {
    notifyLegalTeamNewRequest(['legal@example.com'], '042/FIN/PB/V/2026');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('042/FIN/PB/V/2026') }),
    );
  });

  it('sends nothing when list is empty', () => {
    notifyLegalTeamNewRequest([], '001/FIN/PB/V/2026');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyRequestorStageAdvanced
// ─────────────────────────────────────────────────────────────────

describe('notifyRequestorStageAdvanced', () => {
  it('sends email to requestor with reference number and new status', () => {
    notifyRequestorStageAdvanced('req@example.com', '001/FIN/PB/V/2026', 'LEGAL_REVIEW');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'req@example.com',
        subject: expect.stringContaining('001/FIN/PB/V/2026'),
        html: expect.stringContaining('LEGAL_REVIEW'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyRequestorSentBack
// ─────────────────────────────────────────────────────────────────

describe('notifyRequestorSentBack', () => {
  it('sends email with remarks to requestor', () => {
    notifyRequestorSentBack('req@example.com', '001/FIN/PB/V/2026', 'Please fix section 3.');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'req@example.com',
        subject: expect.stringContaining('Dikembalikan'),
        html: expect.stringContaining('Please fix section 3.'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyRequestorFinished
// ─────────────────────────────────────────────────────────────────

describe('notifyRequestorFinished', () => {
  it('sends finished email to requestor', () => {
    notifyRequestorFinished('req@example.com', '001/FIN/PB/V/2026');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'req@example.com',
        subject: expect.stringContaining('Selesai'),
        html: expect.stringContaining('001/FIN/PB/V/2026'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyRequestorRejected
// ─────────────────────────────────────────────────────────────────

describe('notifyRequestorRejected', () => {
  it('sends rejection email with reason to requestor', () => {
    notifyRequestorRejected('req@example.com', '001/FIN/PB/V/2026', 'Does not comply with policy.');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'req@example.com',
        subject: expect.stringContaining('Ditolak'),
        html: expect.stringContaining('Does not comply with policy.'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyVendorInvitation
// ─────────────────────────────────────────────────────────────────

describe('notifyVendorInvitation', () => {
  it('sends invitation email to vendor with invite link', () => {
    notifyVendorInvitation('vendor@example.com', 'https://auth.example.com/invite?token=abc');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vendor@example.com',
        html: expect.stringContaining('https://auth.example.com/invite?token=abc'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyLegalTeamKybSubmitted
// ─────────────────────────────────────────────────────────────────

describe('notifyLegalTeamKybSubmitted', () => {
  it('sends KYB submitted email to all legal members', () => {
    notifyLegalTeamKybSubmitted(['a@example.com', 'b@example.com'], 'PT Maju', 'vendor@example.com');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('PT Maju'),
        html: expect.stringContaining('PT Maju'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyLegalTeamKybUpdated
// ─────────────────────────────────────────────────────────────────

describe('notifyLegalTeamKybUpdated', () => {
  it('sends KYB updated email to legal team', () => {
    notifyLegalTeamKybUpdated(['legal@example.com'], 'PT Maju', 'vendor@example.com');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'legal@example.com',
        subject: expect.stringContaining('Updated'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyLegalTeamKybResubmitted
// ─────────────────────────────────────────────────────────────────

describe('notifyLegalTeamKybResubmitted', () => {
  it('sends resubmission email to legal team', () => {
    notifyLegalTeamKybResubmitted(['legal@example.com'], 'PT Maju', 'vendor@example.com');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'legal@example.com',
        subject: expect.stringContaining('Re-submitted'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// notifyVendorKybRevision
// ─────────────────────────────────────────────────────────────────

describe('notifyVendorKybRevision', () => {
  it('sends revision email to vendor with remarks', () => {
    notifyVendorKybRevision('vendor@example.com', 'KTP is not legible.');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vendor@example.com',
        subject: expect.stringContaining('Revisi'),
        html: expect.stringContaining('KTP is not legible.'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// SLA notifications
// ─────────────────────────────────────────────────────────────────

describe('notifyLegalTeamSlaApproaching', () => {
  it('sends SLA approaching email to all legal members', () => {
    notifyLegalTeamSlaApproaching(['a@example.com', 'b@example.com'], '001/FIN/PB/V/2026');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Mendekati Deadline'),
        html: expect.stringContaining('001/FIN/PB/V/2026'),
      }),
    );
  });
});

describe('notifyLegalTeamSlaBreached', () => {
  it('sends SLA breached email to all legal members', () => {
    notifyLegalTeamSlaBreached(['a@example.com', 'b@example.com'], '001/FIN/PB/V/2026');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Pelanggaran SLA'),
        html: expect.stringContaining('001/FIN/PB/V/2026'),
      }),
    );
  });
});

describe('notifyRequestorSlaBreached', () => {
  it('sends SLA breached email to requestor', () => {
    notifyRequestorSlaBreached('req@example.com', '001/FIN/PB/V/2026');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'req@example.com',
        subject: expect.stringContaining('Pelanggaran SLA'),
        html: expect.stringContaining('001/FIN/PB/V/2026'),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Error resilience
// ─────────────────────────────────────────────────────────────────

describe('error resilience', () => {
  it('does not throw when resend.emails.send rejects', async () => {
    mockSend.mockRejectedValueOnce(new Error('SMTP error'));
    expect(() => notifyRequestorFinished('req@example.com', '001/FIN/PB/V/2026')).not.toThrow();
    // Allow the promise rejection to be handled by .catch()
    await new Promise((r) => setImmediate(r));
  });
});
