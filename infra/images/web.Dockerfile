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

FROM caddy:2.11.4-alpine
COPY infra/compose/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv/web
COPY --from=build /src/model-files /srv/web/models/htdemucs-web-onnx
