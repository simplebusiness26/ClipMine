# Local Development

## Prerequisites

- Node.js 24 and npm
- Python 3.12
- FFmpeg and FFprobe on `PATH`
- Docker with Compose for the simplest full-stack run

The app can run without PostgreSQL and without a paid AI key.

## Docker workflow

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8000>. Docker builds the React client, installs the API and local transcription runtime, installs FFmpeg, and mounts the persistent `clipmine-data` volume.

Useful commands:

```bash
docker compose ps
docker compose logs --follow clipmine
docker compose restart clipmine
docker compose down
```

`docker compose down` keeps the named data volume. Do not add `--volumes` unless deleting all local ClipMine media and state is intentional.

## Native development workflow

Install web dependencies:

```bash
npm ci
```

Create the Python environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r services/api/requirements-dev.txt
```

Optional local transcription runtime:

```bash
.venv/bin/python -m pip install -r services/api/requirements-ai.txt
```

Copy configuration:

```bash
cp .env.example .env
```

Run the API from the repository root:

```bash
.venv/bin/uvicorn clipmine_api.main:app \
  --app-dir services/api \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --env-file .env
```

In another terminal, run the Vite client:

```bash
npm run dev:web
```

Open <http://localhost:5173>. Vite proxies `/api` to port 8000.

To avoid downloading a Whisper model during interface development, set this in `.env`:

```dotenv
CLIPMINE_TRANSCRIPTION_PROVIDER=off
```

The pipeline will create timeline suggestions instead.

## Production-style local run without Docker

Build the client and let FastAPI serve it:

```bash
npm run build:web
.venv/bin/uvicorn clipmine_api.main:app \
  --app-dir services/api \
  --host 0.0.0.0 \
  --port 8000 \
  --env-file .env
```

The default `.env.example` points `CLIPMINE_STATIC_DIR` to `apps/web/dist`.

## Quality gates

Web and documentation:

```bash
npm run lint:docs
npm run check:links
npm run lint:web
npm run test:web
npm run build:web
```

API and media pipeline:

```bash
.venv/bin/ruff check services/api/clipmine_api services/api/tests
cd services/api
../../.venv/bin/pytest -q
```

The end-to-end API test uses FFmpeg to create a small synthetic video. It tests the whole private-MVP path without committing media fixtures.

## Runtime directories

```text
data/state/projects.json               JSON metadata when no database is set
data/projects/<project-id>/source/     Original uploads
data/projects/<project-id>/exports/    Rendered MP4 clips
```

These paths are excluded from Git. PostgreSQL replaces only metadata persistence; it does not move media files out of the configured data directory.

## API exploration

With the API running:

- OpenAPI UI: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/openapi.json>
- Health: <http://localhost:8000/api/health>
- Runtime configuration: <http://localhost:8000/api/config>

## Common problems

### FFmpeg is missing

Install FFmpeg through the operating system package manager and verify both commands:

```bash
ffmpeg -version
ffprobe -version
```

### Transcription falls back to the timeline

The AI extra may not be installed, the model may not have downloaded, or the machine may not have enough resources. This is a supported degraded mode. Install `requirements-ai.txt`, inspect the API log, and retry the project.

### Port already in use

Stop the conflicting process or change the Vite/API port. If the API port changes, update the proxy in `apps/web/vite.config.ts`.
