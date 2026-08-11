#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "usage: backup.sh OUTPUT_DIRECTORY" >&2; exit 2; fi
destination=$1
mkdir -p "$destination"
umask 077
docker compose -f infra/compose/compose.yaml exec -T postgres \
  pg_dump --format=custom --no-owner --username=atarang atarang > "$destination/postgres.dump"
docker compose -f infra/compose/compose.yaml config > "$destination/compose.resolved.yaml"
date -u +%Y-%m-%dT%H:%M:%SZ > "$destination/created-at.txt"
sha256sum "$destination/postgres.dump" "$destination/compose.resolved.yaml" > "$destination/SHA256SUMS"
echo "Temporary source and result objects are intentionally excluded from long-term backup."
