#!/bin/bash
# PreToolUse(Bash) for data-profiler. SELECT and EXPLAIN only. Fails closed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_extract.sh"
INPUT=$(cat)
COMMAND=$(extract '.tool_input.command' "$INPUT")
[ -z "$COMMAND" ] && exit 0

if echo "$COMMAND" | grep -iqE '(INSERT[[:space:]]|UPDATE[[:space:]]|DELETE[[:space:]]|DROP[[:space:]]|CREATE[[:space:]]|ALTER[[:space:]]|TRUNCATE[[:space:]]|REPLACE[[:space:]]|MERGE[[:space:]]|GRANT[[:space:]]|REVOKE[[:space:]]|COPY[[:space:]].*FROM)'; then
  echo "BLOCKED: data-profiler is read-only. Use SELECT or EXPLAIN only." >&2
  exit 2
fi
exit 0
