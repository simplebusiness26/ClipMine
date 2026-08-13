# Deployment and Observability

## Current supported deployment

ClipMine `0.1.0` supports a private single-instance Docker deployment for one trusted operator. It is not approved for an open public URL.

```bash
cp .env.example .env
docker compose up --build --detach
docker compose ps
curl --fail http://localhost:8000/api/health
```

The multi-stage image:

1. Builds the React/Vite client with Node 24.
2. Installs Python 3.12 dependencies, Faster Whisper and FFmpeg.
3. Copies built web assets beside FastAPI.
4. Runs the service as a non-root `clipmine` user.
5. Exposes port 8000 and uses the persistent `/app/data` volume.

## Configuration

Start from `.env.example`. Required production-like choices for the private MVP:

- `DATABASE_URL`: optional PostgreSQL metadata; leave blank for JSON.
- `CLIPMINE_MAX_UPLOAD_MB`: match disk and operator needs.
- `CLIPMINE_MAX_SOURCE_MINUTES`: cap processing work.
- `CLIPMINE_WORKER_CONCURRENCY`: keep at one until memory/CPU benchmarks justify more.
- Whisper model/device/compute type: fit the host.
- CORS origins: keep limited to actual private origins.

Do not commit `.env` or print the database URL.

## Persistence and backup

### Without PostgreSQL

Back up the named `clipmine-data` Docker volume. It contains JSON metadata, source files and exports.

### With PostgreSQL

Back up both:

1. PostgreSQL `clipmine.projects`
2. The `clipmine-data` media volume

They form one logical project state. A database-only restore leaves media references missing; a volume-only restore lacks PostgreSQL project metadata.

The private MVP has no automated backup or point-in-time restore workflow. Configure and test those before relying on important media.

## Health and logs

Health endpoint:

```text
GET /api/health
```

It reports selected persistence, FFmpeg availability and transcription provider. Docker Compose checks it every 30 seconds after startup grace.

Runtime configuration endpoint:

```text
GET /api/config
```

It exposes only non-secret limits/status for the UI.

Logs:

```bash
docker compose logs --follow --tail 200 clipmine
```

Current logs include startup persistence, transcription fallback codes and safe stack traces for unexpected errors. They should not contain transcript text or credentials. Before public beta, replace basic logging with structured correlation IDs, stage duration, queue age, failure category and redaction tests.

## Deploy and rollback

Private deploy:

```bash
git pull --ff-only
docker compose build
docker compose up --detach
curl --fail http://localhost:8000/api/health
```

Before updating, record the Git commit and back up state/media. To roll back, deploy the previous known-good commit/image without deleting the data volume. Do not reverse database/schema changes destructively; the current schema creation is additive and idempotent.

## Capacity notes

- Upload bytes pass through the API to local disk.
- Transcription and rendering are CPU/memory intensive.
- A single semaphore bounds both processing and render work.
- Multiple API replicas would have separate task registries and shared-volume assumptions; they are unsupported.
- The Docker volume must have space for sources, exports and temporary media work.

## Public-beta deployment target

Use separate resources for web/API, durable workers/queue, PostgreSQL, object storage, identity, secrets and monitoring. Required operational signals include:

- Projects and jobs by state/failure
- Queue depth and oldest age
- Processing/render latency per source minute
- Worker lease/retry/heartbeat
- API error rate and latency
- Storage/egress and provider cost
- Authorisation denials and rate limits
- Deletion reconciliation backlog

Required alerts/runbooks cover stuck jobs, provider outage, render regressions, database/storage degradation, media exposure, credential compromise, deletion failure and cost spikes.

Public launch also requires automated backups with restore drills, object lifecycle controls, immutable build artifacts, staging smoke tests, security scanning, an incident process and explicit production promotion.
