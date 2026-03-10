#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MONGODB_URI:-}" && ( -z "${MONGO_USERNAME:-}" || -z "${MONGO_PASSWORD:-}" ) ]]; then
	echo "Set MONGODB_URI or both MONGO_USERNAME and MONGO_PASSWORD before running this script." >&2
	exit 1
fi

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
