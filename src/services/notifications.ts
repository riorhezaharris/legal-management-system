import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resend } from '../lib/resend';

function fromEmail(): string {
  return process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com';
}

function send(to: string, subject: string, html: string): void {
  resend.emails
    .send({ from: fromEmail(), to, subject, html })
    .catch((err: Error) => console.error(`Failed to send email to ${to}:`, err));
}

function sendToMany(recipients: string[], subject: string, html: string): void {
  for (const to of recipients) {
    send(to, subject, html);
  }
}

export async function getLegalTeamEmails(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: Role.LEGAL_TEAM, isActive: true },
    select: { email: true },
  });
  return users.map((u) => u.email);
}

export function notifyLegalTeamNewRequest(legalEmails: string[], refNum: string): void {
  sendToMany(
    legalEmails,
    `Permintaan Legal Baru — ${refNum}`,
    `<p>Permintaan legal baru telah diajukan dengan nomor referensi <strong>${refNum}</strong>.</p>`,
  );
}

export function notifyRequestorStageAdvanced(requestorEmail: string, refNum: string, newStatus: string): void {
  send(
    requestorEmail,
    `Status Permintaan Legal Diperbarui — ${refNum}`,
    `<p>Status permintaan legal Anda <strong>${refNum}</strong> telah diperbarui ke <strong>${newStatus}</strong>.</p>`,
  );
}

export function notifyRequestorSentBack(requestorEmail: string, refNum: string, remarks: string): void {
  send(
    requestorEmail,
    `Permintaan Legal Dikembalikan — ${refNum}`,
    `<p>Permintaan legal Anda <strong>${refNum}</strong> telah dikembalikan untuk revisi.</p><p>Catatan: ${remarks}</p>`,
  );
}

export function notifyRequestorFinished(requestorEmail: string, refNum: string): void {
  send(
    requestorEmail,
    `Permintaan Legal Selesai — ${refNum}`,
    `<p>Permintaan legal Anda dengan nomor referensi <strong>${refNum}</strong> telah selesai diproses.</p>`,
  );
}

export function notifyRequestorRejected(requestorEmail: string, refNum: string, reason: string): void {
  send(
    requestorEmail,
    `Permintaan Legal Ditolak — ${refNum}`,
    `<p>Permintaan legal Anda <strong>${refNum}</strong> telah ditolak.</p><p>Alasan: ${reason}</p>`,
  );
}

export function notifyVendorInvitation(vendorEmail: string, inviteLink: string): void {
  send(
    vendorEmail,
    'Undangan Onboarding Vendor — Sistem Manajemen Legal',
    `<p>Anda diundang untuk mendaftar sebagai Vendor di Sistem Manajemen Legal Cikal.</p>
     <p>Klik tautan berikut untuk mengatur kata sandi dan melengkapi profil KYB Anda:</p>
     <p><a href="${inviteLink}">Aktifkan Akun Anda</a></p>
     <p>Tautan ini hanya berlaku selama 24 jam.</p>`,
  );
}

export function notifyLegalTeamKybSubmitted(legalEmails: string[], vendorName: string, vendorEmail: string): void {
  sendToMany(
    legalEmails,
    `Vendor KYB Submitted — ${vendorName}`,
    `<p>Vendor <strong>${vendorName}</strong> (${vendorEmail}) telah mengajukan dokumen KYB dan menunggu tinjauan.</p>`,
  );
}

export function notifyLegalTeamKybUpdated(legalEmails: string[], vendorName: string, vendorEmail: string): void {
  sendToMany(
    legalEmails,
    `Vendor Updated KYB Documents — ${vendorName}`,
    `<p>Vendor <strong>${vendorName}</strong> (${vendorEmail}) telah memperbarui dokumen KYB dan menunggu tinjauan ulang.</p>`,
  );
}

export function notifyLegalTeamKybResubmitted(legalEmails: string[], vendorName: string, vendorEmail: string): void {
  sendToMany(
    legalEmails,
    `Vendor Re-submitted KYB After Revision — ${vendorName}`,
    `<p>Vendor <strong>${vendorName}</strong> (${vendorEmail}) telah mengajukan ulang dokumen KYB setelah revisi.</p>`,
  );
}

export function notifyVendorKybRevision(vendorEmail: string, remarks: string): void {
  send(
    vendorEmail,
    'Revisi Dokumen KYB Diperlukan',
    `<p>Dokumen KYB Anda memerlukan revisi.</p>
     <p><strong>Catatan dari Legal Team:</strong></p>
     <blockquote>${remarks}</blockquote>
     <p>Silakan lengkapi dokumen Anda dan ajukan ulang.</p>`,
  );
}

export function notifyLegalTeamSlaApproaching(legalEmails: string[], refNum: string): void {
  sendToMany(
    legalEmails,
    `Peringatan SLA: Mendekati Deadline — ${refNum}`,
    `<p>Permintaan legal dengan nomor referensi <strong>${refNum}</strong> akan mencapai batas waktu SLA dalam 1 hari kerja.</p>`,
  );
}

export function notifyLegalTeamSlaBreached(legalEmails: string[], refNum: string): void {
  sendToMany(
    legalEmails,
    `Pelanggaran SLA — ${refNum}`,
    `<p>Permintaan legal dengan nomor referensi <strong>${refNum}</strong> telah melampaui batas waktu SLA.</p>`,
  );
}

export function notifyRequestorSlaBreached(requestorEmail: string, refNum: string): void {
  send(
    requestorEmail,
    `Pelanggaran SLA — ${refNum}`,
    `<p>Permintaan legal Anda dengan nomor referensi <strong>${refNum}</strong> telah melampaui batas waktu SLA.</p>`,
  );
}
