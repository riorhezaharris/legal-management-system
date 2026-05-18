# Legal Management System — Backend Domain Glossary

This repository is the **backend** of the Legal Management System: an Express + TypeScript + Prisma API deployed via Docker on Digital Ocean VPS. It owns all business logic, workflow state machine, KYB gating, SLA computation, file handling, and email dispatch.

---

## Actors

**IT Admin**
Superadmin role. Responsibilities:
- Create and deactivate internal user accounts (Requestor, Legal Team)
- Assign roles
- Configure default SLA duration
- Manage public holidays and custom off-days
- Manage Vendor accounts (deactivate a vendor, reset KYB status)
- Manage dropdown options for Requestor profile fields (Lokasi Kantor, Divisi, Unit Bisnis) — add, edit, remove. Divisi entries include a short code (e.g. `FIN`) used in the request reference number.
- Read-only audit access to all requests

**Requestor**
Internal school employee who submits legal requests. Can save drafts before submission and track request status. Searches for and links Vendors to requests; invites new Vendors via email if not found. Can only edit a request when it is in `USER_REVIEW`.

Profile fields (completed on first login):
- Nama Lengkap
- Lokasi Kantor (dropdown — managed by IT Admin)
- Divisi (dropdown — managed by IT Admin)
- Unit Bisnis (dropdown — managed by IT Admin)

Profile changes apply to new requests only — existing reference numbers are not retroactively updated.

**Legal Team**
Handles all review stages. Acts as proxy for all vendor communication and signing (manual, outside system). Must upload the final signed document(s) to mark a request as Finished. Account created by IT Admin with name and email only — no profile completion required.

**Vendor**
External counterparty with their own account. Completes KYB on onboarding. Can update KYB documents and view the status of requests they are linked to.

**Deactivation:** A deactivated Vendor cannot authenticate and cannot be linked to new requests. In-progress requests already linked to the Vendor are unaffected and continue to completion.

---

## LegalRequest

The central entity. Submitted by a Requestor, processed by the Legal Team through a defined workflow.

**Visibility:**
- Requestor: own requests only
- Legal Team + IT Admin: all requests
- Vendor: only requests they are linked to

**Reference Number:** Auto-generated on submission.
Format: `{SEQUENCE}/{DIVISI_CODE}/{TYPE_CODE}/{MONTH_ROMAN}/{YEAR}`
Example: `042/FIN/PB/V/2026`

| Request Type | Type Code |
|---|---|
| `PERJANJIAN_BARU` | `PB` |
| `ADENDUM` | `ADM` |
| `SURAT` | `SRT` |
| `PERMINTAAN_DOKUMEN` | `PDK` |

Sequence is global and resets each year. Divisi code is configured by IT Admin per Divisi entry.

### Request Types

| Type | Indonesian Name | Vendor/KYB Required |
|------|----------------|---------------------|
| `PERJANJIAN_BARU` | Pembuatan/Review Perjanjian Baru | Yes |
| `ADENDUM` | Pembuatan/Review Adendum Perjanjian | Yes |
| `SURAT` | Pembuatan/Review Surat | No |
| `PERMINTAAN_DOKUMEN` | Permintaan Dokumen | No |

### Data Fields per Type

**PERJANJIAN_BARU**
- Lingkup Perjanjian (text)
- Status Perjanjian (enum: `BELUM_BERLANGSUNG` / `SEDANG_BERLANGSUNG` / `SUDAH_SELESAI`)
- Jangka Waktu Perjanjian (date range)
- Linked Vendor (FK)

**ADENDUM**
- Perjanjian sebelumnya yang hendak diubah (free-text string, not a FK — historical agreements predate the system)
- Hal yang ingin diubah (text)
- Lampirkan Perjanjian Sebelumnya (file upload)
- Linked Vendor (FK)

**SURAT**
- Surat yang hendak dibuat (string)
- Identitas Penerima Surat (string)
- Korespondensi surat sebelumnya (file upload, optional)

**PERMINTAAN_DOKUMEN**
- Dokumen Perusahaan yang diminta (string)
- Tujuan Permintaan Dokumen (text)
- Lampiran Pendukung (file upload, optional)

### Draft

A request may be saved as a draft before submission. Drafts are not assigned a reference number and do not enter the workflow. Only the Requestor who created the draft can see and submit it.

---

## Vendor

A first-class entity representing an external counterparty. Vendors maintain their documents centrally — documents are not re-uploaded per request.

**Identity:** Email is the canonical unique identifier. Name is stored but not used for deduplication.

**Profile fields:** Name, email, address (collected during KYB), type (Badan / Perorangan).

**Types:**
- **Badan** (Badan/Perusahaan/Badan Hukum — corporate entity)
- **Perorangan** (individual)

**KYB Status:** Legal Team cannot advance a linked request from `WAITING` until KYB status is `APPROVED`.

| Status | Key | Description |
|---|---|---|
| Invited | `INVITED` | Invitation sent, vendor hasn't submitted yet |
| Submitted | `SUBMITTED` | Vendor submitted documents, awaiting Legal review |
| Revision | `REVISION` | Legal sent free-text remarks; vendor must revise and resubmit |
| Approved | `APPROVED` | KYB complete; vendor is verified |

The loop `SUBMITTED → REVISION → SUBMITTED` repeats until Legal approves. Vendor receives an email notification with the remarks on each revision request.

Vendors may update their documents after `APPROVED`. Doing so returns KYB status to `SUBMITTED` and requires Legal approval again. Re-approval only gates **new** requests entering `WAITING` — in-progress requests already past `WAITING` are unaffected.

### Vendor Discovery (triggered by Requestor)
1. Requestor searches by name — API returns matching Vendors with KYB status.
2. If found: Requestor links existing Vendor to the request.
3. If not found: Requestor submits vendor email — API sends onboarding invitation via Resend; Vendor sets password on first login.

---

## KYB (Know Your Business)

The document verification process a Vendor completes upon onboarding. Tied to the Vendor entity, not to individual requests.

**Badan**
- Akta Pendirian Perusahaan
- SK Pendirian Perusahaan
- Nomor Induk Berusaha (NIB)
- Identitas Penanggung Jawab (KTP)
- NPWP Badan
- Akta Perubahan Susunan Direksi Terakhir
- SK Perubahan Susunan Direksi Terakhir
- Surat Kuasa *(optional)*

**Perorangan**
- Kartu Tanda Penduduk (KTP)
- Nomor Pokok Wajib Pajak (NPWP)

---

## Workflow Stages

### Stage Definitions

| Stage | Key | Description | Actor |
|-------|-----|-------------|-------|
| Menunggu Respon | `WAITING` | Request submitted, awaiting Legal Team. If linked Vendor's KYB is not `APPROVED`, the `WAITING → LEGAL_REVIEW` transition is blocked. | — |
| Legal Review | `LEGAL_REVIEW` | Legal Team is reviewing/verifying. For SURAT/PERMINTAAN_DOKUMEN, Legal decides here whether INTERNAL_SIGNING is required. | Legal Team |
| User Review | `USER_REVIEW` | Returned to Requestor for revision. | Requestor |
| Vendor Review | `VENDOR_REVIEW` | Legal sends draft to vendor offline. Legal clicks "Vendor Confirmed" to advance — no document upload required. | Legal Team |
| Internal Signing | `INTERNAL_SIGNING` | The school's authorized party signs offline. Legal Team advances when done. | Legal Team |
| Vendor Signing | `VENDOR_SIGNING` | Vendor signs offline; Legal Team acts as proxy. Legal Team advances when done. | Legal Team |
| Finished | `FINISHED` | Legal Team uploads final signed document(s) — multiple files allowed. | Legal Team |

All document collaboration (drafts, signing) happens outside the system. Only the final signed document(s) are uploaded at `FINISHED`.

### Stage Paths per Request Type

| Request Type | Path |
|---|---|
| `PERJANJIAN_BARU` | `WAITING → LEGAL_REVIEW → VENDOR_REVIEW → INTERNAL_SIGNING → VENDOR_SIGNING → FINISHED` |
| `ADENDUM` | `WAITING → LEGAL_REVIEW → VENDOR_REVIEW → INTERNAL_SIGNING → VENDOR_SIGNING → FINISHED` |
| `SURAT` | `WAITING → LEGAL_REVIEW → [INTERNAL_SIGNING →] FINISHED` |
| `PERMINTAAN_DOKUMEN` | `WAITING → LEGAL_REVIEW → [INTERNAL_SIGNING →] FINISHED` |

`USER_REVIEW` is not a mandatory step — it is only entered when Legal Team explicitly sends the request back for revision. `INTERNAL_SIGNING` is optional for SURAT and PERMINTAAN_DOKUMEN.

### Workflow Policy

The set of rules governing which actors may take which actions from which stages, and what the resulting stage is. Rules include: role permission per action, ownership checks (Requestor may only act on their own requests), KYB gating (WAITING → LEGAL_REVIEW blocked when vendor KYB is not APPROVED), stage-specific action availability, and first-handler stamping (the first Legal Team member to act on a request is recorded). The Workflow Policy is pure — it takes a snapshot of the request and actor and either approves the transition (returning the next stage and any side-data) or rejects it with a reason.

### Queue Model

All Legal Team members share a single request queue. Any Legal Team member can pick up any request. The member who first actions a request is recorded and tracked for accountability — requests are not locked to a single handler.

### Revision Loop

Legal Team can send a request back to `USER_REVIEW` from **any stage**. The loop is unlimited. The Requestor explicitly resubmits to return the request to `LEGAL_REVIEW`.

### Cancellation

Soft delete — marked `CANCELLED`, record preserved.

| Actor | Allowed from stages |
|---|---|
| Requestor | `WAITING`, `USER_REVIEW` |
| Legal Team | Any stage |

### Rejection

Legal Team can reject from any stage. Soft delete — marked `REJECTED`, mandatory reason stored. Requestor is notified by email. A rejected request cannot be resubmitted — Requestor must open a fresh request.

---

## SLA

A time-bound deadline on each LegalRequest. Default: 5 working days (configurable by IT Admin). Excludes weekends, national holidays, and custom off-days. Clock starts at submission. Requests approaching or past deadline are flagged automatically.

---

## Email Notifications

Sent via Resend.

| Event | Recipient |
|---|---|
| Request submitted | Legal Team |
| Stage advanced (any) | Requestor |
| Sent back to `USER_REVIEW` | Requestor |
| SLA deadline approaching (1 day remaining) | Legal Team |
| SLA breached | Legal Team + Requestor |
| Vendor KYB invitation | Vendor |
| Vendor KYB completed | Legal Team |
| KYB revision requested (remarks sent) | Vendor |
| Vendor re-submitted KYB after revision | Legal Team |
| Request finished | Requestor |
| Request rejected (with reason) | Requestor |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + Express + TypeScript |
| ORM | Prisma |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth — JWT verification on every request |
| File storage | Supabase Storage. KYB documents stored per-vendor. Max file size: 20MB. |
| Email | Resend |
| Deployment | Docker on Digital Ocean VPS |
