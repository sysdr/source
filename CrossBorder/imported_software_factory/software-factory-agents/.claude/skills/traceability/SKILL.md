---
name: traceability
description: The REQ-NNN spine that makes the specification enforceable. Preloaded into requirements, test, verify and review agents.
---

# Traceability

```
KC-NNN (knowledge claim)
   └─▶ REQ-NNN (requirement)
          ├─▶ AC-NNN (acceptance criterion)
          │      └─▶ test  (cites REQ-NNN)
          ├─▶ module      (cites REQ-NNN)
          └─▶ demo step   (cites REQ-NNN)
```

Without this, the specification is decoration: everyone agrees it matters, and the
implementation drifts from it within two cycles.

## Requirement ids

Permanent. A removed requirement is marked `withdrawn`, never deleted and never
reused. Ids appear in: acceptance criteria, test names or annotations, module
manifests or header comments, demo script steps, ADRs, and fix requests.

## The four orphan classes — all defects

| Orphan | Meaning |
| --- | --- |
| Requirement with no test | Unverified scope |
| Test citing no valid requirement | Untraceable effort, or a withdrawn requirement still tested |
| Module serving no requirement | Dead code, or undocumented scope |
| P0 requirement with no demo step | Cannot be demonstrated, therefore not done |

Non-zero orphan counts on P0 requirements block Gate 3.

## Requirement record

```json
{ "id": "REQ-041", "statement": "one testable assertion, no conjunctions",
  "rationale": "...", "priority": "P0",
  "source": "brief | KC-NNN | ticket-cluster-N | human@gate-0",
  "owning_module": "...", "depends_on_claims": ["KC-114"],
  "verification_method": "unit | integration | e2e | contract | load | manual-demo",
  "blast_radius": "reversible | costly | irreversible",
  "status": "active | withdrawn" }
```

**Atomic** means one testable assertion. If the statement contains "and also",
split it.

## Why the claim link matters

When a knowledge claim is superseded — a regulation amends, a competitor ships, a
profiler run contradicts the documentation — every dependent requirement is
automatically flagged for review. This is the mechanism that makes the knowledge
base load-bearing rather than ornamental.
