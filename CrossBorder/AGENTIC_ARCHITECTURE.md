# Agentic Enterprise Architecture

This document describes the **Multi-Agent System (MAS)** design used in Project Suez (CrossBorder Financial OS). The system follows an **Agentic Enterprise Architecture** where autonomous agents collaborate to execute, monitor, and optimize cross-functional business processes.

---

## 1. Architecture Overview

### Layers

| Layer | Purpose | Location |
|-------|---------|----------|
| **Orchestration** | CEO / Router agent: parses user intent, delegates to sub-agents, runs tools | `agents/orchestrator.ts` |
| **Memory & Context** | Short-term session turns; long-term org summary from storage | `agents/memory/` |
| **Tools / API** | Deterministic APIs only (storage, Stripe sync, FX, tax stub, compliance) | `agents/tools/` |
| **Personas** | Agent definitions and RBAC (which agent can call which tool) | `agents/personas.ts`, `agents/tools/definitions.ts` |

### Design Principles

- **Deterministic vs probabilistic**: Tax and accounting math are **never** computed by the LLM. The AI orchestrates calls to **tools** (e.g. future Avalara/Vertex for tax). The agent interprets results and formats the reply.
- **Human-in-the-loop (HITL)**: Financial transfers, global tax filings, and final contract approvals are intended to require human authorization. Agents prepare up to a final "Click to Approve" (hooks are in place via `requiresHumanApproval` on runs).
- **RBAC for agents**: Each tool declares `allowedAgents`. Only the orchestrator and the selected domain agents can invoke a given tool (e.g. HR agent cannot initiate bank wires).
- **Auditability**: Every orchestration run produces an **audit trail** (`AuditStep[]`) with agent id, timestamp, summary, and tool calls (Chain-of-Thought). Suitable for compliance review.
- **Stateful flows**: The orchestrator runs a **workflow graph** (route → tools → specialist? → synthesize → end) with optional multi-tool and specialist agent invocation. Extensible to conditional branching and pause-for-approval nodes.

---

## 1b. Workflow Graph (Agentic Run)

Each user turn is executed as a **linear workflow**:

| Node | Purpose |
|------|--------|
| **route** | Gemini routing: selectedAgents, intent, toolCalls[] (multi-tool), optional invokeSpecialist + specialistAgent |
| **tools** | Run all requested tools in sequence (RBAC); results in WorkflowState.toolResults |
| **specialist** | Optional: invoke a domain agent (e.g. compliance, tax) with tool-context for deeper reply |
| **synthesize** | Build final reply from specialist reply, suggested reply, and formatted tool results |
| **end** | Persist audit, return OrchestratorResult |

Multi-tool per turn: router can return toolCalls (array). Specialist agents: set invokeSpecialist and specialistAgent for complex Q&A. Observability: RunMetrics in agents/observability.ts (node visits, durations, tool count).

---

## 2. Agent Personas

| Agent ID | Name | Responsibilities |
|----------|------|------------------|
| `operations` | Operations Agent | Stripe/data sync, capacity checks, project timelines, resource allocation |
| `sales` | Sales & Marketing Agent | Revenue data, deal pipeline, capacity checks before large contracts |
| `hr` | HR Concierge Agent | Employees, payroll runs, handbook policies, onboarding triggers |
| `procurement` | Procurement Agent | POs, vendor comparison, budget validation with Finance |
| `expense` | Expense Auditor Agent | Invoice analysis, travel policy, expense approval/flag |
| `finance` | Financial Controller Agent | Transactions, revenue, transfer pricing, tax engine, platform rules |
| `tax` | Tax & Compliance Agent | Tax calculation via external API only, transfer pricing, book profit |
| `compliance` | Compliance Agent | Form 5472, GST, OIDAR, India–US compliance Q&A, vault documents |

The **Orchestrator** is the only "CEO" agent that routes and invokes tools on behalf of the user.

---

## 3. Tools (RBAC)

Tools are implemented in `agents/tools/impl.ts` and defined (with allowed agents) in `agents/tools/definitions.ts`.

- **Read-only**: `read_company_profile`, `read_transactions`, `read_employees`, `read_revenue_data`, `read_payroll_runs`, `read_transfer_pricing`, `read_tax_engine`, `read_platform_rules`, `read_vault_summary`
- **Actions**: `stripe_sync`, `fx_rate`, `tax_calculate` (stub; production would call Avalara/Vertex), `compliance_advice`, `analyze_invoice`

Tax and accounting outcomes are always produced by **tools**, not by the model’s own arithmetic.

---

## 4. Flow: User → Orchestrator (Workflow) → Agents & Tools

1. User sends a message. 2. runOrchestrator() calls runWorkflow(). 3. Route node: Gemini returns selectedAgents, intent, toolToCall or toolCalls[], optional invokeSpecialist. 4. Tools node: all run in sequence. 5. Specialist node (if set): domain agent reply. 6. Synthesize: final reply. 7. Audit persisted; UI shows reply and Last run audit.
 when it’s a read or sync tool.
---

## 5. Memory

- **Short-term**: `agents/memory/session.ts` – last N turns in the current session (e.g. 20), stored in `sessionStorage`. Used so the orchestrator has recent context.
- **Long-term**: `agents/memory/context.ts` – builds an org summary from storage (profile, entity counts, transaction counts). Can be extended with a vector DB or knowledge graph for policies and historical decisions.
- **Audit log**: `agents/memory/auditLog.ts` – persists the last 50 orchestrator runs (user message, reply, agents used, intent, tool calls) to `localStorage` under `suez_agent_audit_log`. The Suez AI Assistant shows a "Last run audit" expandable (intent + tools) for the most recent run.

---

## 6. Extending the System

- **Add an agent**: Extend `AgentId` in `agents/types.ts`, add a persona in `agents/personas.ts`, and assign tools in `agents/tools/definitions.ts`.
- **Add a tool**: Implement in `agents/tools/impl.ts`, add a definition in `agents/tools/definitions.ts` with `allowedAgents`.
- **Workflows**: Graph in agents/workflow/ (route → tools → specialist? → synthesize → end). Extend with more nodes in workflow/nodes.ts and graph.ts.
- **Backend**: Move Stripe and Gemini behind an API; run orchestrator server-side for security and audit.

---

## 7. File Map

```
agents/
  index.ts           # Public API (orchestrator, workflow, observability, memory, tools)
  types.ts           # AgentId, ToolId, AuditStep, OrchestratorResult, WorkflowState, RunMetrics
  orchestrator.ts    # runOrchestrator() -> runWorkflow()
  personas.ts        # Agent definitions
  observability.ts   # Per-run metrics (node visits, tool count, specialist, latency)
  memory/
    session.ts       # Short-term turns
    context.ts       # Org summary
    auditLog.ts      # Persisted audit runs (suez_agent_audit_log)
    index.ts
  workflow/
    graph.ts         # runWorkflow() - linear graph runner
    nodes.ts         # route, tools, specialist, synthesize nodes
    index.ts
  tools/
    definitions.ts   # ToolDef + RBAC
    impl.ts          # Tool implementations
    index.ts
```

The Suez AI Assistant in App.tsx calls runOrchestrator(), which runs the workflow graph; UI displays reply and agentsUsed, persists via addAIQuery and session appendTurn.
