#!/usr/bin/env bash
# Frees up the ports the dev servers bind to (api :3001, web :5173), so a leftover
# process from a previous `pnpm dev` doesn't block the next one with EADDRINUSE.
set -euo pipefail

PORTS=(3001 5173)

for port in "${PORTS[@]}"; do
  # -sTCP:LISTEN matters: without it, lsof also matches unrelated client sockets that merely
  # happen to reference this port (e.g. a browser tab's CLOSE_WAIT connection to it), which
  # would kill the wrong process entirely.
  pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -z "$pids" ]; then
    echo "Port ${port}: free."
  else
    echo "Port ${port}: killing PID(s) ${pids}"
    kill -9 $pids 2>/dev/null || true
  fi
done
