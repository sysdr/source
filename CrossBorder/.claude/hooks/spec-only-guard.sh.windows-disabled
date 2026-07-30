#!/bin/bash
# PreToolUse(Read|Grep|Glob) for test-adversary, acceptance-criteria-author and the
# review agents. Structural enforcement of Rule 8 — an instruction is a preference,
# a hook is a constraint. Fails closed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_extract.sh"
INPUT=$(cat)
TARGET=$(extract '.tool_input.file_path // .tool_input.path // .tool_input.pattern' "$INPUT")
[ -z "$TARGET" ] && exit 0

# SPECIALIZE: add your source roots here.
if echo "$TARGET" | grep -qE '(^|/)(src|lib|app|server|client|pkg|internal)(/|$)|context/code/'; then
  echo "BLOCKED: this agent works from the specification only and must not read implementation source. Read context/acceptance_criteria.json, context/requirements.json, context/api_spec/, or context/knowledge/ instead." >&2
  exit 2
fi
exit 0
