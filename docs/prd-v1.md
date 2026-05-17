# PRD: Legal Management System — Backend v1

## Problem Statement

The school's legal team manages all contract and document requests manually. There is no centralised system for tracking request status, enforcing SLA deadlines, collecting vendor compliance documents, or maintaining an audit trail. Requestors submit requests via informal channels, Legal Team has no visibility into workload or approaching deadlines, and vendor documents are re-collected on every engagement.

## Solution

A REST API backend that centralises legal request submission and processing, enforces a per-type workflow state machine, gates requests on vendor KYB completion, tracks SLA deadlines against working days, and dispatches email notifications at every meaningful event. Vendors onboard once and their documents are reused across all future requests.

---

## User Stories

### IT Admin

1. As an IT Admin, I want to create a Requestor account with name and email, so that new employees can submit legal requests.
2. As an IT Admin, I want to create a Legal Team account with name and email, so that legal staff can process requests.
3. As an IT Admin, I want to deactivate any internal account, so that former employees lose access immediately.
4. As an IT Admin, I want to assign roles to accounts, so that the right permissions are enforced.
5. As an IT Admin, I want to configure the default SLA duration in working days, so that deadline expectations are set system-wide.
6. As an IT Admin, I want to add and remove national holidays, so that SLA calculations exclude them.
7. As an IT Admin, I want to add and remove custom off-days, so that company-specific closures are excluded from SLA.
8. As an IT Admin, I want to manage Lokasi Kantor options (add, edit, remove), so that Requestors have accurate location choices.
9. As an IT Admin, I want to manage Divisi options with a short code per entry (add, edit, remove), so that reference numbers include the correct division code.
10. As an IT Admin, I want to manage Unit Bisnis options (add, edit, remove), so that Requestors can correctly identify their business unit.
11. As an IT Admin, I want to deactivate a Vendor account, so that they can no longer log in or be linked to new requests.
12. As an IT Admin, I want to reset a Vendor's KYB status, so that they must re-submit their documents when required.
13. As an IT Admin, I want read-only access to all requests, so that I can audit system activity.

### Requestor

14. As a Requestor, I want to be required to complete my profile (Nama Lengkap, Lokasi Kantor, Divisi, Unit Bisnis) on first login before accessing any feature, so that my requests carry the correct metadata.
15. As a Requestor, I want to update my profile at any time, so that my division and location stay current.
16. As a Requestor, I want to save a request as a draft before submitting, so that I can prepare it over multiple sessions.
17. As a Requestor, I want to submit a PERJANJIAN_BARU request with Lingkup Perjanjian, Status Perjanjian, Jangka Waktu Perjanjian, and a linked Vendor, so that Legal can process a new agreement.
18. As a Requestor, I want to submit an ADENDUM request with a free-text reference to the previous agreement, a description of changes, an uploaded copy of the previous agreement, and a linked Vendor, so that Legal can process an amendment.
19. As a Requestor, I want to submit a SURAT request with Surat yang hendak dibuat, Identitas Penerima Surat, and an optional prior correspondence file, so that Legal can draft a letter.
20. As a Requestor, I want to submit a PERMINTAAN_DOKUMEN request with the document name, purpose, and an optional supporting attachment, so that Legal can retrieve the required document.
21. As a Requestor, I want to search for a Vendor by name and see their KYB status, so that I can link an existing verified vendor to my request without re-inviting them.
22. As a Requestor, I want to invite a new Vendor by email when they are not found in the system, so that they can onboard and complete KYB.
23. As a Requestor, I want to see only my own requests, so that other departments' sensitive legal matters are not visible to me.
24. As a Requestor, I want to see the SLA deadline and current status on each of my requests, so that I know if it is on track or overdue.
25. As a Requestor, I want to edit my request fields when it is in USER_REVIEW, so that I can address the Legal Team's remarks.
26. As a Requestor, I want to explicitly resubmit my request after making revisions, so that Legal Team knows it is ready for review again.
27. As a Requestor, I want to cancel my request from WAITING or USER_REVIEW, so that I can withdraw requests that are no longer needed.
28. As a Requestor, I want to receive an email when my request advances to a new stage, so that I know it is progressing.
29. As a Requestor, I want to receive an email when Legal sends my request back for revision, so that I know action is required.
30. As a Requestor, I want to receive an email when my request is finished, so that I know the final documents are available.
31. As a Requestor, I want to receive an email when my request is rejected with the reason, so that I understand why and can open a fresh request if needed.
32. As a Requestor, I want to receive an email when my SLA is approaching (1 day remaining) or breached, so that I can follow up with Legal.

### Legal Team

33. As a Legal Team member, I want to see all submitted requests in a shared queue, so that any team member can pick up a request.
34. As a Legal Team member, I want the system to record who first actioned a request, so that there is an accountability trail.
35. As a Legal Team member, I want to advance a request from WAITING to LEGAL_REVIEW, so that I can begin processing it.
36. As a Legal Team member, I want the system to block advancing from WAITING if the linked Vendor's KYB is not APPROVED, so that requests are not processed against unverified vendors.
37. As a Legal Team member, I want to send a request back to USER_REVIEW with free-text remarks from any stage, so that Requestors can correct issues at any point in the workflow.
38. As a Legal Team member, I want to decide during LEGAL_REVIEW whether INTERNAL_SIGNING is required for SURAT and PERMINTAAN_DOKUMEN requests, so that the correct path is followed.
39. As a Legal Team member, I want to click "Vendor Confirmed" in VENDOR_REVIEW to advance without uploading a document, so that I can record offline confirmation without friction.
40. As a Legal Team member, I want to advance through INTERNAL_SIGNING and VENDOR_SIGNING by recording that signing is complete, so that the workflow reflects real-world progress.
41. As a Legal Team member, I want to upload one or more final signed documents to mark a request as FINISHED, so that the completed record is preserved in the system.
42. As a Legal Team member, I want to reject a request from any stage with a mandatory reason, so that invalid or out-of-scope requests are closed with an explanation.
43. As a Legal Team member, I want to cancel any request from any stage, so that abandoned requests are properly closed.
44. As a Legal Team member, I want to see the SLA deadline and breach status on every request, so that I can prioritise urgent work.
45. As a Legal Team member, I want to receive an email when the SLA on a request approaches (1 day remaining) or breaches, so that I can escalate.
46. As a Legal Team member, I want to receive an email when a new request is submitted, so that I know there is work in the queue.
47. As a Legal Team member, I want to review a Vendor's KYB submission, so that I can verify their documents.
48. As a Legal Team member, I want to send a Vendor free-text revision remarks, so that they know exactly what needs to be corrected.
49. As a Legal Team member, I want to approve a Vendor's KYB, so that their linked requests can proceed.
50. As a Legal Team member, I want to receive an email when a Vendor completes or re-submits KYB, so that I know it is ready for review.

### Vendor

51. As a Vendor, I want to receive an onboarding invitation email with a link to set my password, so that I can access the system without a manual setup process.
52. As a Vendor, I want to submit my KYB documents (based on my type — Badan or Perorangan) during onboarding, so that I can be verified and linked to requests.
53. As a Vendor, I want to provide my address during KYB, so that my profile is complete.
54. As a Vendor, I want to receive an email with revision remarks when Legal requests changes to my KYB, so that I know what to fix.
55. As a Vendor, I want to re-submit my KYB documents after a revision request, so that I can get approved.
56. As a Vendor, I want to update my KYB documents after being approved, so that my records stay current (e.g. renewed KTP).
57. As a Vendor, I want to view the status of all requests I am linked to, so that I can track their progress.

---

## Implementation Decisions

### Schema (key entities)

**User** — id, name, email, role (`IT_ADMIN` | `REQUESTOR` | `LEGAL_TEAM`), isActive, profileCompleted  
**RequestorProfile** — userId (FK), namaLengkap, lokasiKantorId (FK), divisiId (FK), unitBisnisId (FK)  
**Vendor** — id, name, email (unique), address, type (`BADAN` | `PERORANGAN`), kybStatus (`INVITED` | `SUBMITTED` | `REVISION` | `APPROVED`), isActive  
**KybDocument** — id, vendorId (FK), documentType, fileUrl, uploadedAt  
**KybReview** — id, vendorId (FK), remarks (nullable), reviewedBy (FK → User), createdAt  
**LegalRequest** — id, referenceNumber (nullable until submitted), type, status (`DRAFT` | `WAITING` | `LEGAL_REVIEW` | `USER_REVIEW` | `VENDOR_REVIEW` | `INTERNAL_SIGNING` | `VENDOR_SIGNING` | `FINISHED` | `CANCELLED` | `REJECTED`), requestorId (FK), vendorId (FK, nullable), requiresInternalSigning (boolean), firstHandlerId (FK → User, nullable), submittedAt (nullable), createdAt  
**LegalRequestData** — id, requestId (FK), field key-value store per type  
**LegalRequestAttachment** — id, requestId (FK), fileUrl, uploadedAt  
**FinalDocument** — id, requestId (FK), fileUrl, uploadedAt  
**StageHistory** — id, requestId (FK), fromStage, toStage, actorId (FK), remarks (nullable), createdAt  
**SlaConfig** — id, defaultWorkingDays, updatedAt  
**Holiday** — id, date, description, type (`NATIONAL` | `CUSTOM`)  
**LokasiKantor** — id, name  
**Divisi** — id, name, code  
**UnitBisnis** — id, name  

### Module Interfaces

**Workflow Engine**
The central state machine. Exposes a single `transition(requestId, action, actorId, options)` method. Internally:
- Validates the action is permitted from the current stage for the actor's role
- Validates the per-type stage path (e.g. SURAT cannot enter VENDOR_REVIEW)
- Enforces the KYB gate at WAITING → LEGAL_REVIEW
- Records the transition in StageHistory
- Sets `firstHandlerId` on the request on first Legal Team action
- Triggers Notification Module after successful transition

Actions: `ADVANCE`, `SEND_BACK` (with remarks), `CANCEL`, `REJECT` (with reason), `CONFIRM_VENDOR`, `MARK_INTERNAL_SIGNING_REQUIRED`

**SLA Module**
Exposes:
- `computeDeadline(submittedAt: Date, workingDays: number): Date` — returns the deadline excluding weekends, national holidays, and custom off-days
- `getStatus(deadline: Date): 'ON_TRACK' | 'APPROACHING' | 'BREACHED'` — APPROACHING if ≤1 working day remains

**Reference Number Module**
Exposes:
- `generate(divisiCode: string, requestType: RequestType, submittedAt: Date): Promise<string>` — atomically increments the yearly sequence and returns a formatted reference number
- Format: `{SEQ}/{DIVISI_CODE}/{TYPE_CODE}/{MONTH_ROMAN}/{YEAR}`, e.g. `042/FIN/PB/V/2026`
- Sequence is global per year and resets on January 1

**Vendor KYB State Machine** (within Vendor Module)
Valid transitions:
- `INVITED → SUBMITTED` (Vendor submits documents)
- `SUBMITTED → REVISION` (Legal sends remarks)
- `REVISION → SUBMITTED` (Vendor re-submits)
- `SUBMITTED → APPROVED` (Legal approves)
- `APPROVED → SUBMITTED` (Vendor updates documents — re-approval required; does NOT block in-progress requests past WAITING)

### API Design

REST API. All endpoints require `Authorization: Bearer <supabase-jwt>`. Role is extracted from JWT claims.

Key route groups:
- `POST /auth/complete-profile` — Requestor profile completion
- `GET/POST /users` — IT Admin user management
- `GET/POST/PATCH /vendors` — Vendor management and search
- `GET/POST /vendors/:id/kyb` — KYB document submission and review
- `POST /vendors/:id/kyb/approve` — Legal approves KYB
- `POST /vendors/:id/kyb/revision` — Legal sends remarks
- `GET/POST /requests` — List and create requests (draft or submit)
- `PATCH /requests/:id` — Update draft or USER_REVIEW request
- `POST /requests/:id/submit` — Submit a draft
- `POST /requests/:id/transition` — Workflow transitions (advance, send-back, cancel, reject)
- `POST /requests/:id/documents` — Upload final documents (FINISHED)
- `GET/POST /admin/sla-config` — SLA configuration
- `GET/POST/DELETE /admin/holidays` — Holiday management
- `GET/POST/PATCH/DELETE /admin/lokasi-kantor` — Dropdown management
- `GET/POST/PATCH/DELETE /admin/divisi` — Dropdown management
- `GET/POST/PATCH/DELETE /admin/unit-bisnis` — Dropdown management

### Vendor Invitation Flow

1. Requestor calls `POST /vendors/invite` with vendor email
2. Backend creates Vendor record with status `INVITED`
3. Backend creates a Supabase Auth user for the vendor email
4. Resend dispatches the invitation email (Supabase magic link or password-set link)
5. Vendor sets password, logs in, and completes KYB via the Vendor portal

### KYB Gate

On `ADVANCE` action from `WAITING`, the Workflow Engine checks `vendor.kybStatus === 'APPROVED'` before allowing the transition to `LEGAL_REVIEW`. If not approved, the transition is rejected with a `KYB_NOT_APPROVED` error. The request remains in `WAITING` with the "Menunggu KYB Vendor" indicator surfaced via the request's `kybBlocked: true` field in API responses.

### SLA Scheduling

A background job (node-cron or similar) runs daily to:
1. Find all active requests where SLA is APPROACHING or BREACHED
2. Dispatch the appropriate notification emails via the Notification Module

---

## Testing Decisions

Good tests verify external behaviour, not implementation details. They call the module through its public interface with realistic inputs and assert on outputs and side effects (state changes, emitted events) — not on internal method calls or intermediate variables.

### Workflow Engine

Test the state machine exhaustively:
- Every valid transition succeeds and records StageHistory
- Every invalid transition (wrong role, wrong stage, wrong type path) is rejected
- KYB gate blocks WAITING → LEGAL_REVIEW when vendor KYB is not APPROVED
- KYB gate passes when vendor KYB is APPROVED
- Revision can be triggered from every stage
- INTERNAL_SIGNING opt-in correctly routes SURAT and PERMINTAAN_DOKUMEN
- `firstHandlerId` is set on first Legal Team action and not overwritten on subsequent actions
- CANCELLED and REJECTED are terminal — no further transitions accepted
- Stage history is correctly recorded for every transition

### SLA Module

Test the calendar math:
- `computeDeadline` correctly skips weekends
- `computeDeadline` correctly skips national holidays
- `computeDeadline` correctly skips custom off-days
- `computeDeadline` handles combinations of weekends and holidays in sequence
- `computeDeadline` handles deadline spanning month/year boundaries
- `getStatus` returns ON_TRACK, APPROACHING, and BREACHED at the correct thresholds
- `getStatus` correctly handles the boundary at exactly 1 working day remaining

### Reference Number Module

- Generates correct format for each request type
- Roman numeral month is correct for all 12 months
- Sequence increments correctly across concurrent requests (atomicity)
- Sequence resets to 1 on the first request of a new year
- Sequence pads correctly (e.g. `001`, `010`, `100`)

### Vendor KYB State Machine

- `INVITED → SUBMITTED` succeeds when Vendor submits documents
- `SUBMITTED → REVISION` succeeds when Legal sends remarks
- `REVISION → SUBMITTED` succeeds when Vendor re-submits
- `SUBMITTED → APPROVED` succeeds when Legal approves
- `APPROVED → SUBMITTED` succeeds when Vendor updates documents after approval
- Any other transition (e.g. `INVITED → APPROVED`) is rejected
- Re-approval after `APPROVED → SUBMITTED` does not affect in-progress requests that are already past `WAITING`

---

## Out of Scope

- Frontend / UI — handled in a separate repository
- Reporting and analytics
- In-app notifications (email only)
- E-signature integration — signing is manual and offline
- External vendor portal UI — the backend exposes the API; the frontend implements the portal
- Linking ADENDUM to a previous LegalRequest via FK — free-text reference only in v1
- Multi-tenant support

---

## Further Notes

- File uploads are handled by the backend via Supabase Storage. The frontend sends files to the backend, which stores them and returns URLs. KYB documents are stored per-vendor (reused across requests). Request attachments and final documents are stored per-request.
- All soft deletes (CANCELLED, REJECTED) preserve the full record including StageHistory for audit purposes.
- The Divisi short code (e.g. `FIN`) is part of the reference number — IT Admin must set it when creating a Divisi entry. It should be validated as uppercase alphanumeric, max 5 characters.
- Background SLA job frequency: daily is sufficient given the 1-day APPROACHING threshold. The job should be idempotent — running twice must not send duplicate notifications.
