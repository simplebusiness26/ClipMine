# Niches

[![CI](https://github.com/simplebusiness26/ClipMine/actions/workflows/ci.yml/badge.svg)](https://github.com/simplebusiness26/ClipMine/actions/workflows/ci.yml)

Niches is a portal for independent content brands. Its beta is live at **<https://niches.ai-seo.workers.dev>** with verified accounts, niche creation, multiple planning accounts per niche, text drafts and **private media upload/download through a dedicated free Workers KV namespace**. Production synthetic upload, full/range download and anonymous-denial checks passed in [the AISO-isolated deployment run](https://github.com/simplebusiness26/agentCart/actions/runs/40452645608). The free beta limits uploads to 25 MiB each and a conservative 500 MiB shared application cap; KV is eventually consistent and not intended as permanent bulk video storage. R2 remains disabled by the Cloudflare account entitlement. **Real social OAuth/publishing, password reset delivery and hosted ClipMine rendering are not yet production verified.**

Start with the [Niches roadmap](docs/product/niches-roadmap.md) and [Cloudflare audit and rollout](docs/operations/niches-audit-and-rollout.md). The dedicated Worker, database and bucket must be configured in the confirmed AISO account, without touching AISO resources.

## Run the Niches local acceptance app

```bash
npm ci
npm run build:web
node ops/niches-bridge/local-test-server.mjs
```

Open <http://localhost:8787>. This disposable test app uses local D1/R2 and loses its test state when stopped. For the complete isolated checks, run `npm run test:edge` and `node --test ops/niches-bridge/config.test.mjs`. The browser journey needs Playwright Chromium installed; see the CI workflow.

The sections below document the preserved **private ClipMine studio**, including its original storage and processing boundaries. For local Vite studio development use `VITE_APP_MODE=clipmine npm run dev:web`. Docker and the legacy Android build keep that mode.

## Preserved ClipMine studio

ClipMine turns creator-owned long-form video into several editable vertical clips. It finds candidate moments, lets the creator trim and correct them, burns captions into a 9:16 MP4, and keeps a human in control of every export.

**Upload once. Find the gold. Publish everywhere.**

> Status: working private MVP. It runs with built-in file/JSON persistence today and switches to PostgreSQL when `DATABASE_URL` is set. It is not yet a multi-user public service.

## What works now

| Capability | MVP status |
|---|---|
| Responsive upload and project workspace | Implemented |
| MP4, MOV, M4V and WebM source uploads | Implemented |
| Rights confirmation before processing | Implemented |
| FFprobe validation and visible processing progress | Implemented |
| Local Faster Whisper transcription | Implemented with automatic fallback |
| Ranked, explained clip suggestions | Implemented |
| Timeline suggestions when transcription is unavailable | Implemented |
| Title, start, end and caption editing | Implemented |
| 720 × 1280 vertical H.264/AAC render | Implemented |
| Burned-in captions and MP4 download | Implemented |
| Project deletion, source cleanup and retry | Implemented |
| JSON persistence without a database | Implemented |
| PostgreSQL/Supabase persistence switch | Implemented; connection required |
| Accounts, tenant isolation and public deployment security | Deferred |
| Face tracking and active-speaker crop | Deferred; safe centre-fit layout used |
| Direct posting to social platforms | Deferred; export first |

## Quick start with Docker

Requirements: Docker with Compose and enough disk space for source videos, rendered clips and the local transcription model.

```bash
git clone https://github.com/simplebusiness26/ClipMine.git
cd ClipMine
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8000>. The first image build installs FFmpeg and the local transcription runtime. The Whisper model downloads on first transcription; if it cannot load, ClipMine remains usable with timeline-based suggestions.

No database or paid AI key is required for this first run. Project state is saved in the `clipmine-data` Docker volume.

## Connect the database

Put a PostgreSQL connection string in `.env`:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

Then restart:

```bash
docker compose up --build --detach
curl http://localhost:8000/api/health
```

When the health response says `"persistence":"postgres"`, the connection is live. ClipMine creates its private `clipmine.projects` table automatically. Follow the exact [database connection checklist](docs/operations/database-connection.md), including the Supabase connection-mode notes and verification queries.

## Local development

The monorepo contains:

```text
apps/web/                 React, TypeScript and Vite client
apps/web/android/         Capacitor Android shell around the built client
services/api/             FastAPI API and background pipeline
db/schema.sql             Inspectable PostgreSQL MVP schema
docs/                     Product, design, engineering and operations docs
.github/workflows/ci.yml  Automated quality gates
```

See [local development](docs/operations/local-development.md) for the non-Docker setup. Common checks are:

```bash
npm ci
npm run lint:docs
npm run check:links
npm run lint:web
npm run test:web
npm run build:web

python3 -m venv .venv
.venv/bin/pip install -r services/api/requirements-dev.txt
.venv/bin/ruff check services/api/clipmine_api services/api/tests
cd services/api && ../../.venv/bin/pytest -q
```

The backend test suite generates synthetic footage during the test, then exercises upload, analysis, edit, render, download and deletion. No customer or copyrighted fixture is committed.

## Build the Android APK

`apps/web/android` is a Capacitor shell that loads the built React client in a native WebView. It is a packaging layer only; every upload, transcript and render still runs on the FastAPI service.

An installable debug APK comes from the **Build Android APK** workflow. Run it from the Actions tab, then download the `clipmine-debug-apk` artifact from the finished run.

The packaged app has no same-origin backend, so the API origin is compiled in. Set a `VITE_API_URL` repository secret to a reachable ClipMine origin under **Settings → Secrets and variables → Actions**, and add that origin to `CLIPMINE_CORS_ORIGINS` on the server. Without the secret the workflow still produces an APK, but it cannot reach any API.

To build locally you need the Android SDK and a JDK 21:

```bash
npm ci
VITE_API_URL=https://api.example.com npm run build:web
npm --workspace @clipmine/web exec cap sync android
cd apps/web/android && ./gradlew assembleDebug
```

The APK is written to `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`. It is debug-signed, so it is for sideloading onto your own device, not for store distribution.

## Current architecture

The browser talks to one FastAPI service. FastAPI persists state through a `ProjectStore` adapter and runs bounded media tasks in the process. FFmpeg/FFprobe handle inspection and rendering; Faster Whisper is the credential-free speech-to-text option. Source and export files live on the private application volume.

This deliberately small shape is suitable for a private single-user proof. Before a public multi-user beta, split workers from the API, move media to private object storage, add authentication/workspace authorisation, rate limits, retention automation and production monitoring. Those boundaries are documented in the [technical specification](docs/technical/technical-spec.md).

## Product boundaries

- Upload original files that you own or are authorised to process.
- ClipMine does not download arbitrary YouTube URLs.
- Candidate scores are editorial signals, not promises of virality.
- A creator reviews and downloads every output.
- Direct YouTube, TikTok, Instagram and Facebook publishing is a later official-API integration.

## Documentation

Start with the [documentation index](docs/README.md). Useful handoff documents include:

- [MVP handoff and acceptance test](docs/operations/mvp-handoff.md)
- [Database connection checklist](docs/operations/database-connection.md)
- [Product requirements](docs/product/prd.md)
- [API contracts](docs/technical/api-contracts.md)
- [AI clipping pipeline](docs/technical/ai-pipeline.md)
- [Privacy, security and content rights](docs/security/privacy-security-rights.md)
- [Roadmap](docs/product/roadmap.md)

## Important limitations

This build has no sign-in or workspace isolation. Keep it on a trusted machine or private network; do not expose it as a public service. Media remains on the configured local/Docker volume even when project metadata uses PostgreSQL. Review [SECURITY.md](SECURITY.md) before any hosted deployment.

ClipMine is a working product name. Domain, handle and trademark clearance remain outstanding. No open-source licence has been selected, so public visibility does not grant reuse rights.
