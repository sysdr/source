# Sourced by every hook. Extracts a field from the JSON on stdin.
# Tries jq, then python3. FAILS CLOSED (exit 2) if neither is available —
# a guard that cannot parse its input must not silently allow the call.
extract() {
  local key="$1" json="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r "$key // empty" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
ti = d.get("tool_input") or {}
for k in sys.argv[1:]:
    v = ti.get(k)
    if v: print(v); break
' $(printf '%s' "$key" | sed 's/\.tool_input\.//g; s/ *\/\/ *empty//g; s/\./ /g') && return 0
  fi
  echo "HOOK ERROR: neither jq nor python3 available; cannot validate this call. Install jq, or remove this hook deliberately and accept the risk." >&2
  exit 2
}
