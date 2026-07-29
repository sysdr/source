#!/bin/bash
# PreToolUse(Bash), session-wide. Blast-radius control per AGENTS.md 3.5.
# These actions require a human, always. Fails closed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/_extract.sh"
INPUT=$(cat)
COMMAND=$(extract '.tool_input.command' "$INPUT")
[ -z "$COMMAND" ] && exit 0

if echo "$COMMAND" | grep -iqE '(DROP[[:space:]]+(TABLE|DATABASE|SCHEMA|INDEX)|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM)'; then
  echo "BLOCKED: irreversible data operation. Propose it as a reviewed artifact with a rollback plan; a human must approve." >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE '(npm publish|cargo publish|twine upload|gh release create|fastlane|aws ses send|sendgrid|mailgun)'; then
  echo "BLOCKED: publication or outbound communication at scale requires human approval." >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE '(aws iam |gcloud projects add-iam|kubectl create secret|vault write|az role assignment)'; then
  echo "BLOCKED: credential or permission change requires human approval." >&2
  exit 2
fi
if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-[a-z]*r[a-z]*f?[[:space:]]+(/|~|\$HOME)'; then
  echo "BLOCKED: recursive delete outside the working tree." >&2
  exit 2
fi
exit 0
