#!/bin/bash
# SubagentStop. Appends a marker so the orchestrator can rebuild DAG state after a
# restart. Never blocks — this one is observational only.
set -uo pipefail
INPUT=$(cat)
AGENT=$(printf '%s' "$INPUT" | grep -o '"agent_type"[^,}]*' | head -1 | sed 's/.*: *"//; s/"$//')
mkdir -p context 2>/dev/null || true
echo "$(date -Iseconds) stop agent=${AGENT:-unknown}" >> context/decisions.log 2>/dev/null || true
exit 0
