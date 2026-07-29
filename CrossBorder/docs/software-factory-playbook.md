# Software Factory Playbook (CrossBorder)

This project now includes the full software factory bundle in `.claude/agents` and `AGENTS.md`.

Use this execution order for every major feature.

## 1) Domain expertise first (Phase 0 + specify intake)

1. `@agent-intake`: build `context/brief.json` with constraints and initial requirement seed.
2. `@agent-corpus-analyst`: extract regulatory and competitor claims.
3. `@agent-evidence-miner` + `@agent-data-profiler`: collect observed evidence.
4. `@agent-domain-modeler` + `@agent-domain-expert`: publish domain map and risk matrix.

Exit criteria:
- domain boundaries, actors, compliance constraints, and data sensitivity are explicit
- unresolved ambiguity is logged as `CLARIFICATION_REQUEST`, never silently assumed

## 2) Requirement gathering + missing requirements

1. `@agent-product-strategist` and `@agent-principal-engineer-p1`: create baseline PRD.
2. `@agent-requirements-engineer`: generate atomic `REQ-NNN` requirements.
3. `@agent-requirements-engineer`: publish `requirements_gaps.json` for missing requirements in:
   - business
   - functional
   - non-functional
   - user
   - external/interface
4. `@agent-acceptance-criteria-author`: convert REQs into executable acceptance criteria.
5. `@agent-adversarial-critic-p1`: challenge ambiguity and weak requirements.

Exit criteria:
- every REQ has owner, verification method, and requirement class
- gaps are either resolved or explicitly marked as blocking at Gate

## 3) Design

Run architecture agents in parallel where possible:
- `@agent-system-architect`
- `@agent-api-designer`
- `@agent-data-modeler`
- `@agent-security-architect`
- `@agent-devops-architect`
- `@agent-sre`
- `@agent-principal-engineer-p2`

Exit criteria:
- ADRs include alternatives and tradeoffs
- each REQ maps to modules/contracts/data model changes

## 4) Develop and code

1. `@agent-backend-engineer`, `@agent-frontend-engineer`, `@agent-mobile-engineer` (if needed)
2. `@agent-integration-engineer`, `@agent-database-engineer`
3. `@agent-feature-flag-engineer`, `@agent-observability-engineer`, `@agent-documentation-engineer`

Exit criteria:
- feature is behind flag
- observability ships in the same change
- no orphan REQs

## 5) Test, automate, verify

1. `@agent-test-adversary` (spec-derived tests only, no implementation access)
2. `@agent-test-engineer`, `@agent-qa-agent`
3. `@agent-spec-conformance-verifier`, `@agent-traceability-auditor`
4. `@agent-security-auditor`, `@agent-performance-analyst`, `@agent-accessibility-engineer`
5. `@agent-flake-hunter`, `@agent-chaos-engineer`, `@agent-cost-optimizer`

Exit criteria:
- 100% P0 spec conformance
- requirement-to-test traceability complete
- critical security/performance findings closed or escalated

## 6) Release review and operate

1. `@agent-demo-builder`, `@agent-product-reviewer`, `@agent-scorecard`
2. `@agent-release-manager`
3. `@agent-deploy`, `@agent-monitoring`, `@agent-production-evidence`

## Orchestrator-first mode

For end-to-end execution:

```bash
claude --agent orchestrator
```

For targeted execution in an existing session:

```text
@agent-domain-expert summarize current domain constraints for cross-border payments.
@agent-requirements-engineer produce REQ-NNN and requirements_gaps.json for payout reconciliation.
@agent-test-adversary generate acceptance tests for REQ-014 to REQ-022.
```
