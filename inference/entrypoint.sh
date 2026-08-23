#!/bin/sh
set -eu

: "${EMBEDDING_MODEL:?EMBEDDING_MODEL is required}"
: "${MODEL_FILE:?MODEL_FILE is required}"
: "${MODEL_SHA256:?MODEL_SHA256 is required}"
: "${MODEL_URL:?MODEL_URL is required}"

case "$MODEL_FILE" in
  */* | .* | '')
    echo 'MODEL_FILE must be a plain filename' >&2
    exit 1
    ;;
esac

umask 077
model="/models/$MODEL_FILE"
temporary="${model}.part"

if ! test -f "$model" || ! printf '%s  %s\n' "$MODEL_SHA256" "$model" | sha256sum --check --status -; then
  rm -f "$temporary"
  curl --fail --location --retry 3 --output "$temporary" "$MODEL_URL"
  printf '%s  %s\n' "$MODEL_SHA256" "$temporary" | sha256sum --check --status -
  mv "$temporary" "$model"
fi

exec /app/llama-server \
  --model "$model" \
  --alias "$EMBEDDING_MODEL" \
  --embedding \
  --pooling last \
  --host 0.0.0.0 \
  --port 8080 \
  "$@"
