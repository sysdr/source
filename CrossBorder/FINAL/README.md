# Project Suez — Cross-Border Financial OS

Final output package for Gate 3 (Cycle 2).

## Run locally

```bash
cp .env.example .env   # set GEMINI_API_KEY / API_KEY
npm install
npm run server         # http://localhost:3001
npm run dev            # http://localhost:9000
```

Optional checks:

```bash
npm test
npm run test:a11y
npm run test:dast
npm run test:mutation-kill
npm run demo:p0
npm run demo:screenshots
npx stryker run stryker.people.config.mjs   # optional; currently ~56%
```

## Scorecard (latest)

Composite **90** (floors met). See `scorecard.json`.

## Gate status

Gates 0–3 confirmed. Local production-like deploy completed (`deployed_local`); see `release/deployment_status.json`. No public cloud/DNS publish.

## What’s in this package

| Path | Contents |
|------|----------|
| `scorecard.json` | 8-dimension score + history |
| `open_risks.md` | Residual optional polish |
| `next_cycle.md` | Suggested Cycle 3 work |
| `demo/` | Screenshot evidence A–E 10/10 |
| `mutation_report_people.json` | People-scoped Stryker (55.63%) |
| `release/` | Release notes + rollback outline |
| `knowledge/` | Domain summary pointer |
| `adrs/` | Accepted architecture decisions |

## Residual risks (non-blocking)

- People Stryker **96.03%** (RW-009b done); optional payroll/TDS expand — RW-009c
- VoiceOver recording of full owner shell — F-013b
- Staging ZAP beyond lightweight API DAST — RW-010 residual
