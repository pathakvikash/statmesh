# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# deps first (cached until the lockfile changes), then the project itself
COPY pyproject.toml uv.lock README.md LICENSE ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim
RUN useradd --uid 1000 --create-home statmesh && mkdir /data && chown statmesh /data
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH STATMESH_DATA_DIR=/data PYTHONUNBUFFERED=1
USER statmesh
WORKDIR /data
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]
CMD ["statmesh", "serve", "--host", "0.0.0.0", "--port", "8000"]
