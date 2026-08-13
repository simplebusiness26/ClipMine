# ClipMine

[![CI](https://github.com/simplebusiness26/ClipMine/actions/workflows/ci.yml/badge.svg)](https://github.com/simplebusiness26/ClipMine/actions/workflows/ci.yml)

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
