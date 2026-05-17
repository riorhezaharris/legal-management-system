# ADR 0001: Separate Frontend and Backend Repositories

**Status:** Accepted  
**Date:** 2026-05-17

## Context

The system is built on Next.js (App Router), which supports both frontend rendering and backend API routes within a single repository. The alternative is to split the codebase into two separate repos: one for the Next.js frontend, one for an Express backend.

The project has a clear separation of concerns — a role-based frontend (Requestor, Legal Team, Vendor Portal, IT Admin) and a backend responsible for workflow logic, KYB gating, SLA calculation, file handling, and email dispatch via Resend. Both surfaces are non-trivial in scope.

## Decision

Split into two separate repositories:
- **Frontend:** Next.js (App Router) + TypeScript, deployed to Vercel
- **Backend:** Express + TypeScript + Prisma, deployed via Docker on a Digital Ocean VPS

The frontend communicates with the backend over HTTP (REST). Supabase Auth issues JWTs that both sides verify independently.

## Rationale

- **Deployment independence.** The backend runs on a persistent VPS (Docker/DO) — not serverless. Next.js API routes are tightly coupled to Vercel's serverless execution model, which does not suit long-running Express middleware, Prisma connection pooling, or scheduled SLA jobs.
- **Scaling independently.** Frontend (static/SSR) and backend (API) have different scaling profiles and can be updated, redeployed, or scaled without coupling.
- **Clearer ownership boundaries.** Workflow logic, KYB gating, SLA computation, and file storage access all live in the backend. The frontend is purely presentational and auth-gated. This boundary is easier to enforce in separate repos than in a monorepo.

## Trade-offs

- **Shared types require explicit management.** TypeScript types (request payloads, enums, response shapes) are not automatically shared. A shared types package or OpenAPI contract must be maintained to keep both sides in sync.
- **Local development overhead.** Running both repos simultaneously requires coordination (e.g. separate terminals, environment variables pointing to the local backend URL).
- **CORS configuration required from day one.** Frontend (Vercel domain) and backend (DO VPS domain) are on different origins.

## Alternatives Considered

- **Next.js monorepo (single repo, API routes as backend):** Rejected because Vercel's serverless model is incompatible with persistent Prisma connections and long-running background tasks (SLA deadline checks).
- **NestJS backend:** Considered but rejected in favour of Express for lower setup overhead given the MVP timeline and team familiarity.
