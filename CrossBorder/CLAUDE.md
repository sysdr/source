# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project Suez — a cross-border payments/ERP "Financial OS" (React + TS frontend, Node/Express API, SQLite persistence), with an embedded multi-agent AI assistant (`agents/`).

## Software Factory rules apply first

This repo runs the agent factory defined in `AGENTS.md` (repo root) and `.claude/CLAUDE.md`. Those rules — the 15 Inviolable Rules, engineering bar, Gate process — are always-on and override anything below when they conflict. Read `.claude/CLAUDE.md` before doing non-trivial work.

## Commands

```bash
npm install
cp .env.example .env        # set GEMINI_API_KEY (optional VITE_SERVER_URL)

npm run server               # API on :3001, serves data/suez.db — start first
npm run dev                  # Vite UI on :9000

npm test                     # vitest run (all)
npm run test:watch
npx vitest run path/to/file.test.ts -t "test name"   # single test/file

npm run test:a11y            # axe + contrast + employee-portal a11y suites
npm run test:dast            # server/index.test.ts lightweight DAST case
npm run test:mutation        # stryker (full); also test:mutation:{payroll,people,filings}
npm run test:flake           # scripts/flake-hunter.mjs — repeated runs to catch non-determinism
npm run test:load            # scripts/load-ledger-slo.ts

npm run build                # vite build
npm run audit:deps           # npm audit --audit-level=high
npm run security:report      # scripts/security-report.ts

npm run snapshot:data        # refresh data/suez.db from live browser state — run before committing DB changes
npm run seed:db               # scripts/seed-default-org-db.ts
npm run backup:db / backup:verify
```

Data flow gotcha: `data/suez.db` is the committed workspace snapshot. On first load, the API rebuilds browser `localStorage` from it. Run the API (`npm run server`) before the UI so hydration works. Never commit `*.db-wal` / `*.db-shm`. After changes that mutate seed/demo data, run `npm run snapshot:data` and commit the updated `data/suez.db`.

## Architecture

### Frontend / backend split
- `App.tsx` + `components/` — React 19 UI, routed by feature area (Accounting, Payroll, Finance, TaxEngine, TransferPricing, ComplianceHub, Invoices, Onboarding, etc.), each with subfolders (`components/accounting`, `payroll`, `people`, `revenue`, `invoices`, `employee`) for area-specific pieces.
- `services/` — the domain/business-logic layer the UI calls into: currency, decimal math, employee lifecycle, bank reconciliation, compliance status engine, PII display rules, export/invoice generation, feature flags, API client (`apiClient.ts`), Stripe/DB sync (`dbSync.ts`). Most modules have a co-located `*.test.ts(x)`.
- `server/` (Express, `server/index.ts`) — REST API in front of SQLite (`server/db.ts`), plus auth (`magicAuth.ts`), access control (`accessControl.ts`), Stripe webhook handling/crypto verification, payroll batching, period close, reconciliation, FEMA/compliance tracking, PII handling, and DB backup/rebuild utilities.
- `contexts/` — React context providers.
- `types.ts` — shared domain types used across UI, services, and server.

### Embedded multi-agent assistant (`agents/`)
A separate orchestration layer for the in-app "Suez AI Assistant" — see `AGENTIC_ARCHITECTURE.md` for the full design. Key points:
- `agents/orchestrator.ts` runs a linear workflow graph (`agents/workflow/`: route → tools → optional specialist → synthesize → end) built from Gemini-based intent routing.
- `agents/personas.ts` defines agent personas (operations, sales, hr, procurement, expense, finance, tax, compliance); `agents/tools/definitions.ts` + `impl.ts` implement RBAC-gated tools (`allowedAgents` per tool).
- Tax/accounting math is always computed by deterministic tools, never by the LLM directly — the model only interprets and formats results.
- Memory: `agents/memory/session.ts` (short-term, sessionStorage), `agents/memory/context.ts` (org summary), `agents/memory/auditLog.ts` (persisted audit trail in `localStorage` under `suez_agent_audit_log`, shown in UI as "Last run audit").
- To add an agent: extend `AgentId` in `agents/types.ts`, add a persona, assign tools with RBAC. To add a tool: implement in `agents/tools/impl.ts`, define with `allowedAgents` in `agents/tools/definitions.ts`.

### `context/` — factory knowledge base and decision record
Versioned artifacts from the software-factory process (ADRs, PRD/architecture confirmations, design, feature flags, reviews, rework, release). Treat as append-only/versioned, not hand-editable docs — see `.claude/CLAUDE.md` Rule 2 and the artifact publish-record format.

### Testing setup
- Vitest with jsdom, global test APIs, setup in `tests/setup.ts`. Separate vitest configs exist for filings/payroll/people domains (`vitest.{filings,payroll,people}.config.ts`) mirrored by Stryker mutation configs (`stryker.{filings,payroll,people}.config.mjs`) — these are the mutation-tested critical domains.
- `imported_software_factory/` is excluded from test discovery.
