import { runSlaJob } from '../jobs/slaJob';
import { prisma } from '../lib/prisma';
import { getStatus } from '../services/sla';
import {
  notifyLegalTeamSlaApproaching,
  notifyLegalTeamSlaBreached,
  notifyRequestorSlaBreached,
} from '../services/notifications';

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    legalRequest: { findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../services/sla', () => ({
  getStatus: jest.fn(),
}));

jest.mock('../services/notifications', () => ({
  notifyLegalTeamSlaApproaching: jest.fn(),
  notifyLegalTeamSlaBreached: jest.fn(),
  notifyRequestorSlaBreached: jest.fn(),
}));

const mockUser = (prisma as any).user as { findMany: jest.Mock };
const mockLegalRequest = (prisma as any).legalRequest as { findMany: jest.Mock; update: jest.Mock };
const mockGetStatus = getStatus as jest.Mock;
const mockNotifyApproaching = notifyLegalTeamSlaApproaching as jest.Mock;
const mockNotifyLegalBreached = notifyLegalTeamSlaBreached as jest.Mock;
const mockNotifyRequestorBreached = notifyRequestorSlaBreached as jest.Mock;

const LEGAL_EMAILS = ['legal1@example.com', 'legal2@example.com'];

function makeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    referenceNumber: '001/FIN/PB/V/2026',
    slaDeadline: new Date('2026-05-25T00:00:00.000Z'),
    slaNotifiedApproaching: false,
    slaNotifiedBreached: false,
    requestor: { email: 'requestor@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.findMany.mockResolvedValue(LEGAL_EMAILS.map((email) => ({ email })));
  mockLegalRequest.findMany.mockResolvedValue([]);
  mockLegalRequest.update.mockResolvedValue({});
});

describe('runSlaJob', () => {
  it('sends approaching email and updates flag for APPROACHING request not yet notified', async () => {
    mockLegalRequest.findMany.mockResolvedValue([makeRequest({ slaNotifiedApproaching: false })]);
    mockGetStatus.mockResolvedValue('APPROACHING');

    await runSlaJob();

    expect(mockNotifyApproaching).toHaveBeenCalledWith(LEGAL_EMAILS, '001/FIN/PB/V/2026');
    expect(mockLegalRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { slaNotifiedApproaching: true },
    });
  });

  it('does not resend approaching email if already notified', async () => {
    mockLegalRequest.findMany.mockResolvedValue([makeRequest({ slaNotifiedApproaching: true })]);
    mockGetStatus.mockResolvedValue('APPROACHING');

    await runSlaJob();

    expect(mockNotifyApproaching).not.toHaveBeenCalled();
    expect(mockLegalRequest.update).not.toHaveBeenCalled();
  });

  it('sends breached emails to legal team and requestor for BREACHED request not yet notified', async () => {
    mockLegalRequest.findMany.mockResolvedValue([makeRequest({ slaNotifiedBreached: false })]);
    mockGetStatus.mockResolvedValue('BREACHED');

    await runSlaJob();

    expect(mockNotifyLegalBreached).toHaveBeenCalledWith(LEGAL_EMAILS, '001/FIN/PB/V/2026');
    expect(mockNotifyRequestorBreached).toHaveBeenCalledWith('requestor@example.com', '001/FIN/PB/V/2026');
    expect(mockLegalRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { slaNotifiedBreached: true },
    });
  });

  it('does not resend breached emails if already notified', async () => {
    mockLegalRequest.findMany.mockResolvedValue([makeRequest({ slaNotifiedBreached: true })]);
    mockGetStatus.mockResolvedValue('BREACHED');

    await runSlaJob();

    expect(mockNotifyLegalBreached).not.toHaveBeenCalled();
    expect(mockNotifyRequestorBreached).not.toHaveBeenCalled();
    expect(mockLegalRequest.update).not.toHaveBeenCalled();
  });

  it('sends no emails for ON_TRACK requests', async () => {
    mockLegalRequest.findMany.mockResolvedValue([makeRequest()]);
    mockGetStatus.mockResolvedValue('ON_TRACK');

    await runSlaJob();

    expect(mockNotifyApproaching).not.toHaveBeenCalled();
    expect(mockNotifyLegalBreached).not.toHaveBeenCalled();
    expect(mockNotifyRequestorBreached).not.toHaveBeenCalled();
    expect(mockLegalRequest.update).not.toHaveBeenCalled();
  });

  it('skips requests without a referenceNumber', async () => {
    mockLegalRequest.findMany.mockResolvedValue([makeRequest({ referenceNumber: null })]);
    mockGetStatus.mockResolvedValue('APPROACHING');

    await runSlaJob();

    expect(mockNotifyApproaching).not.toHaveBeenCalled();
  });

  it('handles multiple requests with different statuses in one run', async () => {
    mockLegalRequest.findMany.mockResolvedValue([
      makeRequest({ id: 'req-1', referenceNumber: '001/FIN/PB/V/2026' }),
      makeRequest({ id: 'req-2', referenceNumber: '002/FIN/PB/V/2026' }),
    ]);
    mockGetStatus.mockResolvedValueOnce('APPROACHING').mockResolvedValueOnce('BREACHED');

    await runSlaJob();

    expect(mockNotifyApproaching).toHaveBeenCalledTimes(1);
    expect(mockNotifyLegalBreached).toHaveBeenCalledTimes(1);
    expect(mockNotifyRequestorBreached).toHaveBeenCalledTimes(1);
    expect(mockLegalRequest.update).toHaveBeenCalledTimes(2);
  });

  it('does not throw when a top-level database error occurs', async () => {
    mockLegalRequest.findMany.mockRejectedValue(new Error('DB connection lost'));

    await expect(runSlaJob()).resolves.toBeUndefined();
  });

  it('continues processing remaining requests when one request fails to evaluate', async () => {
    mockLegalRequest.findMany.mockResolvedValue([
      makeRequest({ id: 'req-1', referenceNumber: '001/FIN/PB/V/2026' }),
      makeRequest({ id: 'req-2', referenceNumber: '002/FIN/PB/V/2026' }),
    ]);
    mockGetStatus.mockRejectedValueOnce(new Error('SLA error')).mockResolvedValueOnce('APPROACHING');

    await runSlaJob();

    expect(mockNotifyApproaching).toHaveBeenCalledTimes(1);
    expect(mockNotifyApproaching).toHaveBeenCalledWith(LEGAL_EMAILS, '002/FIN/PB/V/2026');
  });
});
