#!/bin/sh
set -eu

: "${EMBEDDING_MODEL:?EMBEDDING_MODEL is required}"

ollama serve &
server_pid=$!

stop() {
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" || true
}
trap 'stop; exit 0' INT TERM

for attempt in $(seq 1 60); do
  if ollama list >/dev/null 2>&1; then
    ollama pull "$EMBEDDING_MODEL"
    wait "$server_pid"
    exit $?
  fi
  sleep 2
done

echo 'Ollama was not ready after 120 seconds' >&2
stop
exit 1
