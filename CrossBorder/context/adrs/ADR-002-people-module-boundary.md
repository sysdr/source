# ADR-002: People module boundary vs Payroll

**Status:** accepted
**Date:** 2026-07-30
**Deciders:** system-architect, principal-engineer-p2
**Requirements:** REQ-082, REQ-083, REQ-084, REQ-085, REQ-086, REQ-089

## Context
Employee master data lived only under Payroll tabs. Attendance types existed without UI. Cycle 2 elevates People as a vertical slice.

## Decision
Introduce `components/people/` as the People module owning directory, profile, attendance, and leave UX. Payroll continues to own batch runs, slips, statutory exports, and declarations. Shared `Employee` entity remains in `types.ts` with SQLite/`useEmployees` as the master data path. Attendance persists via existing `storageService` attendance APIs (local/org) in MVP; REST attendance endpoints deferred.

## Alternatives Considered
1. **Keep everything under Payroll** — rejected: confuses HR persona and buries attendance.
2. **Separate microservice** — rejected: disproportionate for single-org MVP.
3. **People module (chosen)** — clear boundary, reuses directory/leave components.

## Consequences
Positive: clear nav, reusable hooks. Negative: temporary dual entry if Payroll retains directory tab — mitigate by labeling Payroll focus on run workflows and linking to People for master data.

## Verification
REQ-082 e2e: People nav visible when `ff_people_module` on; hidden when off.
