#!/usr/bin/env bash
# Summarise 👍/👎 feedback stored in the cluster's Redis.
#   scripts/feedback-report.sh            # all days, grouped by ending + tone
#   scripts/feedback-report.sh reason     # group by another column: model ending duration reason tone medium changed safety
set -euo pipefail
NS=caas
BY="${1:-ending tone}"

COLS="model ending duration reason tone medium changed safety"
idx() { local i=1; for c in $COLS; do [[ "$c" == "$1" ]] && { echo "$i"; return; }; i=$((i+1)); done; echo "unknown column: $1" >&2; exit 1; }
KEYS=""; for c in $BY; do KEYS="$KEYS $(idx "$c")"; done

kubectl -n "$NS" exec deploy/redis -- sh -c '
  # Without a TTY, redis-cli prints HGETALL as plain alternating field / count lines.
  for key in $(redis-cli --scan --pattern "caas:feedback:*"); do redis-cli HGETALL "$key"; done
' | paste - - | awk -F'\t' -v keys="$KEYS" -v header="$BY" '
  BEGIN { n = split(keys, k, " ") }
  {
    split($1, f, "|"); group = ""
    for (i = 1; i <= n; i++) group = group (i > 1 ? " / " : "") f[k[i]]
    if (f[9] == "up") up[group] += $2; else down[group] += $2
    seen[group] = 1
  }
  END {
    printf "%-48s %6s %6s %7s\n", header, "up", "down", "liked"
    for (g in seen) { t = up[g] + down[g]; printf "%-48s %6d %6d %6.0f%%\n", g, up[g], down[g], t ? 100 * up[g] / t : 0 }
  }' | (read -r h; echo "$h"; sort)
