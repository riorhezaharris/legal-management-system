# ADR 0001: Separate Frontend and Backend Repositories

**Status:** Accepted  
**Date:** 2026-05-17

## Context

Next.js (App Router) supports both frontend rendering and backend API routes within a single repository. The alternative is to split into two separate repos: one for the Next.js frontend, one for an Express backend.

The backend owns significant non-trivial logic: workflow state machine, KYB gating, SLA computation, file handling via Supabase Storage, and email dispatch via Resend. The frontend owns routing, UI, auth session management, and form handling. Both surfaces are non-trivial in scope.

## Decision

Split into two separate repositories:
- **Frontend (this repo):** Next.js (App Router) + TypeScript, deployed to Vercel
- **Backend (separate repo):** Express + TypeScript + Prisma, deployed via Docker on Digital Ocean VPS

The frontend communicates with the backend over HTTP (REST). Supabase Auth issues JWTs that both sides verify independently.

## Rationale

- **Backend requires a persistent server.** The backend runs long-running tasks (SLA deadline checks, Prisma connection pooling) that are incompatible with Vercel's serverless execution model.
- **Deployment independence.** Frontend (Vercel, CDN-optimized) and backend (DO VPS) have different deployment targets, scaling profiles, and release cadences.
- **Clearer ownership.** All business logic, rules, and data access live in the backend. The frontend is purely presentational and auth-gated. This boundary is easier to enforce and reason about in separate repos.

## Trade-offs

- **Shared types require explicit management.** TypeScript types (API payloads, enums, response shapes) must be kept in sync manually or via a shared contract (e.g. OpenAPI spec).
- **Local development overhead.** Both repos must run simultaneously in development. The frontend requires `NEXT_PUBLIC_API_URL` pointing to the local backend.
- **CORS must be configured from day one.** Frontend (Vercel domain) and backend (DO VPS domain) are on different origins.

## Alternatives Considered

- **Next.js monorepo (single repo, API routes as backend):** Rejected — Vercel serverless is incompatible with persistent Prisma connections and background SLA jobs.
