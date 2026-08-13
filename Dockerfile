FROM node:24-bookworm-slim AS web-build

WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web apps/web
RUN npm run build:web

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CLIPMINE_DATA_DIR=/app/data \
    CLIPMINE_STATIC_DIR=/app/static \
    HF_HOME=/app/data/models/huggingface

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/api/requirements.txt services/api/requirements-ai.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-ai.txt

COPY services/api/clipmine_api /app/clipmine_api
COPY --from=web-build /build/apps/web/dist /app/static

RUN mkdir -p /app/data \
    && useradd --system --uid 10001 --create-home clipmine \
    && chown -R clipmine:clipmine /app /home/clipmine

USER clipmine
EXPOSE 8000

CMD ["uvicorn", "clipmine_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
