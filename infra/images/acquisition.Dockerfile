FROM python:3.12.13-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY services/api/pyproject.toml services/api/pyproject.toml
COPY services/acquisition/pyproject.toml services/acquisition/pyproject.toml
COPY services/worker/pyproject.toml services/worker/pyproject.toml
COPY bench/separation/pyproject.toml bench/separation/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace
COPY services/api services/api
COPY services/acquisition services/acquisition
COPY services/worker services/worker
COPY bench/separation bench/separation
RUN uv sync --locked --no-dev --no-editable --package atarang-acquisition

FROM denoland/deno:bin-2.6.3 AS deno

FROM python:3.12.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10003 --home /nonexistent --shell /usr/sbin/nologin atarang
COPY --from=deno /deno /usr/local/bin/deno
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10003:10003
CMD ["atarang-acquisition"]
