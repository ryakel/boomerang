#!/bin/sh
# Smoke test: build production, start server, verify the app loads without JS errors
# Exits 0 on success, 1 on failure

set -e

echo "==> Building production bundle..."
npm run build --silent

echo "==> Starting server..."
DB_PATH=./test-smoke.db node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

cleanup() {
  kill $SERVER_PID 2>/dev/null || true
  rm -f ./test-smoke.db ./test-smoke.db.*.bak
}
trap cleanup EXIT

echo "==> Checking health endpoint..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT:-3001}/api/health)
if [ "$HEALTH" != "200" ]; then
  echo "FAIL: Health endpoint returned $HEALTH"
  exit 1
fi

echo "==> Checking HTML loads..."
HTML=$(curl -s http://localhost:${PORT:-3001}/)
echo "$HTML" | grep -q '<div id="root">' || { echo "FAIL: HTML missing root div"; exit 1; }

echo "==> Checking JS bundle loads without syntax errors..."
JS_FILE=$(echo "$HTML" | grep -o 'src="/assets/index-[^"]*\.js"' | head -1 | sed 's/src="//;s/"//')
if [ -z "$JS_FILE" ]; then
  echo "FAIL: Could not find JS bundle in HTML"
  exit 1
fi

JS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT:-3001}${JS_FILE})
if [ "$JS_STATUS" != "200" ]; then
  echo "FAIL: JS bundle returned $JS_STATUS"
  exit 1
fi

# Parse the JS as an ES module (the bundle is type=module; `new Function` would
# reject valid top-level import/export, which Vite emits once anything is
# code-split — e.g. a Capacitor plugin lazy-loading its web impl). Write to a
# temp .mjs and use `node --check`, which parses module syntax correctly.
JS_TMP=$(mktemp).mjs
curl -s "http://localhost:${PORT:-3001}${JS_FILE}" -o "$JS_TMP"
if node --check "$JS_TMP" 2>/tmp/smoke-js-err; then
  echo "JS bundle parses OK ($(($(wc -c < "$JS_TMP")/1024)) KB)"
  rm -f "$JS_TMP"
else
  echo "FAIL: JS bundle has errors:"
  cat /tmp/smoke-js-err
  rm -f "$JS_TMP"
  exit 1
fi

echo "==> Smoke test passed"
