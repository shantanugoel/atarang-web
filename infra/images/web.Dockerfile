FROM oven/bun:1.3.14-debian AS build
WORKDIR /src
COPY package.json bun.lock tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY models/web models/web
RUN bun run build
RUN bun models/web/download.ts

# Two targets, because a deployment whose frontend lives on a static host wants
# this container as the /api/* proxy and nothing else. Building `proxy` skips
# the stage above entirely — no bun install, no bundle, no 126 MB of weights —
# which is the difference between a minute and half an hour on small hardware.
# The default target is the last stage, so a full-stack build is unchanged.
FROM caddy:2.11.4-alpine AS proxy
COPY infra/compose/Caddyfile /etc/caddy/Caddyfile

FROM proxy AS web
COPY --from=build /src/apps/web/dist /srv/web
COPY --from=build /src/model-files /srv/web/models/htdemucs-web-onnx
