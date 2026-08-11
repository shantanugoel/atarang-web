#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo "usage: restore.sh BACKUP_DIRECTORY" >&2; exit 2; fi
source_directory=$1
(cd "$source_directory" && sha256sum -c SHA256SUMS)
docker compose -f infra/compose/compose.yaml exec -T postgres \
  pg_restore --clean --if-exists --no-owner --username=atarang --dbname=atarang < "$source_directory/postgres.dump"
echo "Run API readiness, migration status, retention audit, and a canary job before switching traffic."
