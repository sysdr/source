---
name: epistemic-discipline
description: How to mark, promote, and never silently upgrade knowledge claims. Preloaded into every Phase 0 and Phase 1 agent.
---

# Epistemic Discipline

The characteristic failure of a domain agent is **fluent plausible synthesis**: output
that reads exactly like expertise and is subtly wrong. Unmarked assumptions are worse
than no knowledge at all, because everything downstream treats them as established.

## Status, on every factual claim

| Status | Meaning | Test |
| --- | --- | --- |
| `cited` | Traceable to an authoritative source with a locator | Can you name the document and the section? |
| `observed` | Measured directly from data or a running system | Can you paste the query and the date? |
| `inferred` | Reasoned from cited or observed claims | Is the reasoning chain written down? |
| `assumed` | Believed without support | Everything else, including anything you feel confident about |

An unmarked claim is `assumed`. Confidence is not evidence.

## Rules

1. An `assumed` claim may never be cited downstream as `cited` or `observed`.
2. **A claim is promoted only by acquiring evidence, never by being repeated.**
   Repetition is exactly how plausible synthesis becomes false certainty.
3. Contested claims stay contested. Where sources genuinely disagree — the standard
   says X and every practitioner does Y — record both. **Do not resolve into false
   consensus.** That gap is frequently the product opportunity.
4. Every claim carries provenance and a `review_by` date proportional to how fast
   the source changes.
5. `assumed_ratio` above 0.15 for P0-relevant claims blocks Gate 0.

## Claim format

```json
{ "id": "KC-NNN", "claim": "...",
  "epistemic_status": "cited | observed | inferred | assumed",
  "provenance": { "source": "...", "locator": "..." },
  "confidence": 0.0, "contested": false, "contradicts": [],
  "review_by": "YYYY-MM-DD", "dependent_requirements": [] }
```

## Evidence grade, for commercial claims

E1 someone said they'd like it · E2 filed feature request · E3 repeated unprompted
complaints · **E4 they built a manual workaround** · **E5 they pay someone else for
a partial solution** · **E6 they already pay us**.

Only E4 and above justify P0 scope. Stated preference is a famously poor predictor
of purchase, and an unconstrained agent will happily mine E1 and E2 at scale and
return a confident ranked list built almost entirely on them.

The workaround signal is the most underrated: a maintained spreadsheet, a glue
script, or a person whose job is reconciliation is a pain someone is already paying
salary to absorb. That is revealed preference with a price tag attached.
