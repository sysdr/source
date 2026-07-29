# Software Factory — Claude Code agent bundle

65 agent definitions (64 factory agents + the orchestrator), 3 preloaded skills,
5 hook scripts, and settings. Drop-in for any repository.

## Install

```bash
# from your repo root
cp -r .claude /path/to/your/repo/
cp AGENTS.md /path/to/your/repo/
chmod +x /path/to/your/repo/.claude/hooks/*.sh
```

Then open Claude Code in that repo. Agents are picked up within seconds; if the
`.claude/agents/` directory did not exist before the session started, restart once.

## Run

```bash
# full factory, orchestrator as the main thread
claude --agent orchestrator

# or drive individual agents from a normal session
@agent-evidence-miner   analyze the last 18 months of support tickets
@agent-domain-modeler   build the domain model from the rule register and data profile
@agent-test-adversary   write acceptance tests for REQ-014 through REQ-022
```

## Before the first run — three edits

1. **`.claude/CLAUDE.md`** — fill in the `## Golden path` block with your actual
   stack. Every deviation from it later requires an ADR, so this is the highest-value
   ten minutes you will spend.
2. **`.claude/agents/knowledge/corpus-analyst.md`** — list the authoritative sources
   for your domain (specific regulations, standards bodies, competitor doc sites).
   Naming them makes this agent dramatically more effective than leaving it to search.
3. **`.claude/agents/knowledge/evidence-miner.md`** — add an `mcpServers:` block for
   your ticket system, CRM, and call transcript store. Define them inline in that file
   rather than in `.mcp.json`, so their tool descriptions stay out of every other
   agent's context.

Search for `SPECIALIZE` to find every intended customization point.

## Layout

```
AGENTS.md                       the factory specification — phases, gates, scorecard
.claude/
  CLAUDE.md                     always-on rules loaded into every agent
  settings.json                 permissions, session-wide hooks, concurrency limits
  agents/
    orchestrator.md             main-thread agent; runs the DAG and the loop
    knowledge/   (9)            Phase 0 — domain acquisition, persistent
    specify/    (10)            Phase 1 — expand the idea into REQ ids
    design/     (11)            Phase 2 — architecture
    build/      (11)            Phase 3 — implementation
    verify/     (11)            Phase 4 — harden and verify
    review/      (9)            Phase 5 — demo, review, rework
    operate/     (3)            Phase 6 — deploy and feed evidence back
  skills/
    engineering-bar/            thresholds, preloaded into build and verify agents
    epistemic-discipline/       claim status rules, preloaded into knowledge agents
    traceability/               the REQ spine, preloaded into spec and verify agents
  hooks/
    spec-only-guard.sh          blocks the adversary and reviewers from reading code
    validate-readonly-sql.sh    blocks non-SELECT for the data profiler
    block-destructive.sh        session-wide blast-radius control
    guard-artifacts.sh          keeps confirmed artifacts immutable
    record-publish.sh           appends a publish marker on subagent stop
```

## The three that matter most

If you adopt nothing else:

- **`test-adversary`** — writes tests from the spec and is *path-blocked* from reading
  implementation. If one agent writes the spec, the tests, and the code, the tests
  encode the misunderstanding instead of catching it.
- **`traceability-auditor`** — finds the four orphan classes. Without it the spec is
  decoration and drift is invisible.
- **`demo-builder`** — a feature that cannot be demonstrated end-to-end on realistic
  seeded data is not done, whatever the suite says.

## Hooks are constraints, not preferences

`spec-only-guard.sh` is what makes adversarial separation real. An instruction telling
an agent not to read implementation source is a preference; a `PreToolUse` hook
returning exit code 2 is a constraint. Do not remove these to unblock work — if a hook
blocks something that genuinely needs doing, that belongs at a Gate.

## Model routing

`haiku` for enumeration and mechanical extraction · `sonnet` for implementation and
structured audit · `opus` for judgment: domain modelling, review, architecture,
adversarial work. Override globally with `CLAUDE_CODE_SUBAGENT_MODEL`.
