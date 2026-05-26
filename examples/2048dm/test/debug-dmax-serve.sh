#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-$HOME/dev/http-nu}"
DMAX_ROOT="${DMAX_ROOT:-$HOME/dev/dmax}"
EX="$ROOT/examples/2048dm"
HTTP_NU="${HTTP_NU:-$ROOT/target/debug/http-nu}"
SERVE_NU="${SERVE_NU:-$EX/serve.nu}"
PORT="${PORT:-39211}"
STORE="${STORE:-/tmp/2048-check-$$}"
LOG="${LOG:-/tmp/2048-httpnu.log}"

cleanup() {
  if [[ -n "${PID:-}" ]]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "== paths =="
echo "ROOT=$ROOT"
echo "DMAX_ROOT=$DMAX_ROOT"
echo "EX=$EX"
echo "HTTP_NU=$HTTP_NU"
echo "SERVE_NU=$SERVE_NU"
echo "PORT=$PORT"
echo

echo "== sync dmax.js =="
cp "$DMAX_ROOT/dmax.js" "$EX/static/dmax.js"
wc -lc "$DMAX_ROOT/dmax.js" "$EX/static/dmax.js"
echo "--- synced static/dmax.js tail ---"
tail -n 12 "$EX/static/dmax.js"
echo

echo "== local file checks =="
ls -l "$HTTP_NU" "$SERVE_NU" "$EX/static/dmax.js" "$EX/test/probe-board.mjs" "$EX/test/test.mjs"
echo

echo "== starting server =="
"$HTTP_NU" --services --store "$STORE" "127.0.0.1:$PORT" "$SERVE_NU" >"$LOG" 2>&1 &
PID=$!
sleep 1

echo "== server log (startup) =="
tail -n 40 "$LOG" || true
echo

echo "== served /dmax.js checks =="
echo "--- served /dmax.js size ---"
curl -fsS "http://127.0.0.1:$PORT/dmax.js" | wc -lc
echo "--- served /dmax.js tail ---"
curl -fsS "http://127.0.0.1:$PORT/dmax.js" | tail -n 12
echo

echo "== served /new data-m-si snippet =="
python3 - <<'PY' "$PORT"
import sys, urllib.request, re
port = sys.argv[1]
html = urllib.request.urlopen(f"http://127.0.0.1:{port}/new").read().decode("utf-8", "replace")
m = re.search(r'data-m-si="([^"]+)"', html)
print((m.group(1)[:500] if m else "NO data-m-si FOUND"))
PY
echo

cd "$EX/test"
CHROMIUM_PATH="${CHROMIUM_PATH:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
export CHROMIUM_PATH
echo "== playwright =="
echo "CHROMIUM_PATH=$CHROMIUM_PATH"
echo

echo "== probe-board =="
node probe-board.mjs
echo

echo "== test.mjs =="
node test.mjs || true
echo

echo "== final server log =="
tail -n 80 "$LOG" || true
