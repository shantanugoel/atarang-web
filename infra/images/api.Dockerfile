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
RUN uv sync --locked --no-dev --no-editable --package atarang-api

FROM python:3.12.13-slim-bookworm
RUN useradd --system --uid 10001 --home /nonexistent --shell /usr/sbin/nologin atarang
COPY --from=build /app/.venv /app/.venv
COPY services/api/alembic.ini /app/alembic.ini
COPY services/api/migrations /app/migrations
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /app
USER 10001:10001
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn atarang_api.app:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*' "]
