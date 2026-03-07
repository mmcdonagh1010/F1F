#!/usr/bin/env bash
set -euo pipefail

export MONGODB_URI='mongodb+srv://<REDACTED>@f1-fantasy-league.40bag.mongodb.net/'
export NODE_ENV=production
export DEBUG=false

node src/index.js > server.log 2>&1 &
PID=$!
echo $PID > /tmp/f1f_server.pid
sleep 3
echo "----- server.log (last 200 lines) -----"
tail -n 200 server.log || true
echo "----- health check -----"
curl -sS http://localhost:4000/health || true
