#!/bin/sh
set -eu

destination="${1:-.env}"
if [ -e "$destination" ]; then
  echo "Refusing to overwrite $destination" >&2
  exit 1
fi

umask 077
postgres_password="$(openssl rand -hex 32)"
minio_root_user="atarang-$(openssl rand -hex 12)"
minio_root_password="$(openssl rand -hex 32)"
deployment_key="$(openssl rand -hex 32)"

{
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  printf 'MINIO_ROOT_USER=%s\n' "$minio_root_user"
  printf 'MINIO_ROOT_PASSWORD=%s\n' "$minio_root_password"
  printf 'DEPLOYMENT_KEY=%s\n' "$deployment_key"
  printf 'MODEL_ARTIFACT_SHA256=8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4\n'
  printf 'PUBLIC_ORIGIN=https://atarang.shaanlab.com\n'
  printf 'SITE_ADDRESS=:80\n'
  printf 'HOST_HTTP_PORT=4173\n'
  printf 'YOUTUBE_ENABLED=true\n'
  printf 'IMAGE_REVISION=development-20260811\n'
} > "$destination"

echo "Created $destination with mode 0600."
