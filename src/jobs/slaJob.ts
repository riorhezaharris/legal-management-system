import { prisma } from '../lib/prisma';
import { getStatus } from '../services/sla';
import {
  notifyLegalTeamSlaApproaching,
  notifyLegalTeamSlaBreached,
  notifyRequestorSlaBreached,
} from '../services/notifications';

export async function runSlaJob(): Promise<void> {
  try {
    const legalTeamMembers = await prisma.user.findMany({
      where: { role: 'LEGAL_TEAM', isActive: true },
      select: { email: true },
    });
    const legalEmails = legalTeamMembers.map((u) => u.email);

    const requests = await prisma.legalRequest.findMany({
      where: {
        status: { notIn: ['FINISHED', 'CANCELLED', 'REJECTED', 'DRAFT'] },
        slaDeadline: { not: null },
      },
      include: {
        requestor: { select: { email: true } },
      },
    });

    let approachingCount = 0;
    let breachedCount = 0;

    for (const request of requests) {
      if (!request.slaDeadline || !request.referenceNumber) continue;

      let status: 'ON_TRACK' | 'APPROACHING' | 'BREACHED';
      try {
        status = await getStatus(request.slaDeadline);
      } catch (err) {
        console.error(`[SLA Job] Failed to get status for request ${request.id}:`, err);
        continue;
      }

      if (status === 'APPROACHING' && !request.slaNotifiedApproaching) {
        notifyLegalTeamSlaApproaching(legalEmails, request.referenceNumber);
        await prisma.legalRequest.update({
          where: { id: request.id },
          data: { slaNotifiedApproaching: true },
        });
        approachingCount++;
      } else if (status === 'BREACHED' && !request.slaNotifiedBreached) {
        notifyLegalTeamSlaBreached(legalEmails, request.referenceNumber);
        notifyRequestorSlaBreached(request.requestor.email, request.referenceNumber);
        await prisma.legalRequest.update({
          where: { id: request.id },
          data: { slaNotifiedBreached: true },
        });
        breachedCount++;
      }
    }

    console.log(
      `[SLA Job] Run complete — approaching: ${approachingCount}, breached: ${breachedCount}, total checked: ${requests.length}`,
    );
  } catch (err) {
    console.error('[SLA Job] Job failed:', err);
  }
}
