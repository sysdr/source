#!/bin/bash
# PreToolUse(Edit|Write). Rules 2 and 3: artifacts are immutable; no in-place
# overwrite of another agent's artifact. Fails closed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_extract.sh"
INPUT=$(cat)
FILE=$(extract '.tool_input.file_path' "$INPUT")
[ -z "$FILE" ] && exit 0

case "$FILE" in
  *context/*_confirmed.json)
    echo "BLOCKED: gate-confirmed artifacts are immutable. Route an AMEND_REQUEST through the orchestrator." >&2
    exit 2 ;;
  *context/decisions.log)
    echo "BLOCKED: decisions.log is append-only. Append via Bash, do not Edit." >&2
    exit 2 ;;
esac
exit 0
