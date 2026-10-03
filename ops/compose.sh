#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -P "$(dirname "$0")" && pwd -P)
project_dir=$(CDPATH='' cd -P "$script_dir/.." && pwd -P)
cd "$project_dir"

if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi

echo "Docker Compose CLI not found; use the DSM Docker Project UI or install the Compose CLI." >&2
exit 127
