#!/bin/sh
set -eu
: "${REGISTRY:?set REGISTRY}"
: "${VERSION:?set VERSION}"
: "${MODEL_ARTIFACT_SHA256:?set MODEL_ARTIFACT_SHA256}"
test -f uv.lock
test -f models/server/htdemucs.th
echo "$MODEL_ARTIFACT_SHA256  models/server/htdemucs.th" | sha256sum -c -
uv lock --check
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
REGISTRY=$REGISTRY VERSION=$VERSION MODEL_ARTIFACT_SHA256=$MODEL_ARTIFACT_SHA256 \
  docker buildx bake -f infra/release/docker-bake.hcl --push
for image in web api worker-cpu worker-cuda; do
  reference=$REGISTRY/$image:$VERSION
  digest=$(docker buildx imagetools inspect "$reference" --format '{{json .Manifest.Digest}}' | tr -d '"')
  test -n "$digest"
  cosign sign --yes "$REGISTRY/$image@$digest"
  cosign verify "$REGISTRY/$image@$digest" >/dev/null
  echo "$image@$digest"
done
