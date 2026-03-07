#!/usr/bin/env bash
set -eo pipefail

# Wait for server health
for i in $(seq 1 30); do
  if curl -sS http://localhost:4000/health >/dev/null 2>&1; then
    echo "Server healthy"
    break
  fi
  sleep 1
done
if ! curl -sS http://localhost:4000/health >/dev/null 2>&1; then
  echo "ERROR: server did not become healthy"
  exit 1
fi

# Register
echo "== Registering test user =="
REG_RESP=$(curl -sS -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"CI Admin","email":"ci-admin@example.com","password":"Password123"}' || true)
echo "REGISTER RESPONSE:"
echo "$REG_RESP" | python3 - <<'PY'
import sys, json
try:
  print(json.loads(sys.stdin.read()))
except Exception:
  print('RAW:')
  print(sys.stdin.read())
PY

# Promote
echo "\n== Promoting to admin via bootstrap =="
PROM_RESP=$(curl -sS -X POST http://localhost:4000/api/admin/bootstrap/promote-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"ci-admin@example.com","bootstrapKey":"local-bootstrap-key"}' || true)
echo "PROMOTE RESPONSE:"
echo "$PROM_RESP" | python3 - <<'PY'
import sys, json
try:
  print(json.loads(sys.stdin.read()))
except Exception:
  print('RAW:')
  print(sys.stdin.read())
PY

# Login
echo "\n== Logging in to get token =="
LOGIN_RESP=$(curl -sS -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ci-admin@example.com","password":"Password123"}' || true)
echo "LOGIN RESPONSE:"
echo "$LOGIN_RESP" | python3 - <<'PY'
import sys, json
try:
  print(json.loads(sys.stdin.read()))
except Exception:
  print('RAW:')
  print(sys.stdin.read())
PY

TOKEN=$(echo "$LOGIN_RESP" | python3 - <<'PY'
import sys, json
try:
  d=json.loads(sys.stdin.read())
  print(d.get('token',''))
except Exception:
  print('')
PY
)
if [ -z "$TOKEN" ]; then echo "ERROR: failed to get token"; exit 1; fi

# Fetch users
echo "\n== Fetching admin users with token =="
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/admin/users | python3 -m json.tool || true

USER_ID=$(curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/admin/users | python3 -c "import sys,json; arr=json.load(sys.stdin); print(arr[0]['id'] if arr else '')")
if [ -z "$USER_ID" ]; then echo "ERROR: no user id found"; exit 1; fi

# Patch user
echo "\n== Patching user name/email =="
PATCH_RESP=$(curl -s -S -X PATCH http://localhost:4000/api/admin/users/$USER_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"CI Admin Updated","email":"ci-admin2@example.com"}' || true)
echo "PATCH RESPONSE:"
echo "$PATCH_RESP" | python3 - <<'PY'
import sys, json
try:
  print(json.loads(sys.stdin.read()))
except Exception:
  print('RAW:')
  print(sys.stdin.read())
PY

# Fetch users after update
echo "\n== Fetching admin users after update =="
curl -s -S -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/admin/users | python3 -m json.tool || true
