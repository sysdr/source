---
name: engineering-bar
description: The non-negotiable quality thresholds every build and verify agent enforces. Preloaded into all Phase 3 and Phase 4 agents.
---

# Engineering Bar

These are ship blockers. A change that breaches any threshold is not committed.

## Code quality

| Standard | Threshold |
| --- | --- |
| Cyclomatic complexity per function | ≤ 10 |
| Cognitive complexity per function | ≤ 15 |
| Function length | ≤ 40 lines |
| File length | ≤ 500 lines |
| Nesting depth | ≤ 3 |
| Untyped escapes (`any`, `interface{}`, `Object`) | 0 |
| Lint errors / warnings | 0 / 0 |
| Duplication | < 3% |
| Dead code | 0 |
| Magic numbers / strings | 0 |
| Debug print in production code | 0 |
| Commented-out code | 0 |
| Hardcoded secrets or config | 0 |

## Verification

| Standard | Threshold |
| --- | --- |
| Backend line coverage | ≥ 90% |
| Frontend line coverage | ≥ 80% |
| Backend branch coverage | ≥ 85% |
| **Mutation score per module** | ≥ 80% |
| **Flake rate over 10 consecutive full runs** | 0% |
| P0 spec conformance | 100% |
| Requirements with a citing test | 100% |
| Tests citing a non-existent requirement | 0 |

Line coverage is nearly meaningless for machine-written tests — coverage without
assertion strength is easy to produce and proves nothing. Mutation score is the
metric that matters.

## API design

Spec-first: OpenAPI 3.1 written before implementation, and the spec is the source
of truth. Idempotency on every state-changing operation. Cursor pagination. RFC
9457 error bodies. Versioned from day one. Rate limit headers on every response.
No endpoint returns more than 1000 items.

## Observability

Traces (OpenTelemetry, `trace_id` propagated through every hop), metrics named
`{service}_{operation}_{unit}_{type}` with Four Golden Signals per service, and
structured JSON logs carrying `timestamp`, `level`, `service`, `trace_id`,
`span_id`, `event` with PII masked.

Written in the same change as the feature. Never afterwards.

## Security

Zero hardcoded secrets. PII encrypted at rest with separately-managed keys.
Dependencies pinned to exact versions with an SBOM per build. No known critical or
high CVE ships. CSP, HSTS, TLS 1.3 minimum. No version-disclosing headers.

## Agent legibility

Golden path adherence (deviation requires an ADR) · explicit over clever · module
boundaries enforced by tooling · vertical slices · strictest static checking ·
≤ 3 files of context per change type · error messages as a machine-readable API.
