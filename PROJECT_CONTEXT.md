# Niches Project Context

Last updated: 2026-10-26

## Current product and source of truth

Niches is the new product inside this existing ClipMine repository. ClipMine remains the long-video studio. The owner explicitly authorised this expansion on 2026-10-26. The private-only scope below is historical, not the new target.

Start with the [Niches roadmap](docs/product/niches-roadmap.md), [audit/rollout](docs/operations/niches-audit-and-rollout.md) and [architecture decision](docs/decisions/ADR-007-niches-cloudflare-boundary.md). Exact checks belong in CI/PR evidence.

Implemented locally: authenticated niche portal, D1 ownership model, private R2 library, upload/search, drafts and platform metadata, export reminders/calendar, brand kits, ideas, manual revenue, notifications and guarded ClipMine gateway/import.

Production follow-up (2026-10-27): the isolated Niches portal is deployed in AISO’s Cloudflare account. Registration, sessions, multiple planning accounts per niche, drafts and mobile smoke passed. R2 remains denied by the account entitlement, but a project-only free Workers KV namespace now backs private authenticated 25 MiB beta uploads; real remote upload/full and ranged download/anonymous denial passed in [the isolated deployment run](https://github.com/simplebusiness26/agentCart/actions/runs/40452645608). Beta KV data is eventually consistent and not suited to large uploads or permanent storage. Encryption/OAuth and per-account publishing outbox are implemented and simulated-provider tested, **not** real-provider verified. Optional Brevo reset sender code is implemented but requires dedicated secrets and a verified sender; email delivery is **not** verified. Remote render hosting, real device/backup recovery and direct social integrations are still blocked. Never describe a planned account as connected or an export reminder as a published post; the Cloudflare deployment guard must not be bypassed.

## Historical ClipMine baseline

Last updated: 2026-08-13

## Current state

ClipMine has a tested private MVP in this repository. It is no longer documentation-only.

Implemented:

- React 19, TypeScript and Vite mobile-first interface
- FastAPI API with generated OpenAPI documentation
- Original-file upload with size, extension and rights checks
- FFprobe inspection and background progress states
- Optional local Faster Whisper transcription
- Explainable transcript heuristics plus timeline fallback candidates
- Candidate title, trim and caption editing
- FFmpeg vertical centre-fit/blurred-background render with burned captions
- MP4 source preview and export download
- Retry and full project/file deletion
- JSON state persistence with atomic writes
- PostgreSQL adapter selected automatically by `DATABASE_URL`
- Docker image, Compose stack, environment template and health check
- Frontend, API, media end-to-end, lint, build, Markdown and link checks in CI

## Verified baseline

At handoff, the repository passes:

- TypeScript type-check and production Vite build
- Vitest unit suite
- Ruff linting
- Pytest unit/integration suite
- Synthetic media path: upload → analyse → edit → render → download → delete
- Markdown linting and relative-link validation

Exact live results belong in the final implementation handoff and CI run rather than being hard-coded forever in this file.

## Persistence boundary

With no database URL, the API uses `data/state/projects.json`. With `DATABASE_URL`, it uses PostgreSQL and creates `clipmine.projects` in a private schema. Media bytes remain in `data/projects/` in both modes.

This separation means the database can be connected without changing application code. It does not yet migrate existing JSON projects into PostgreSQL automatically.

## Confirmed product direction

ClipMine is a mobile-first service for turning long-form, creator-owned video into multiple short-form video drafts. The creator retains editorial control. Original upload and MP4 export remain the first supported boundaries; arbitrary public-video downloading and unattended publishing remain excluded.

## Private MVP boundary

Included now:

- Single trusted operator
- Original video upload
- Processing progress and recoverable error state
- Transcription when the local model is available
- Multiple candidate ranges with confidence and reasons
- Lightweight trim/title/caption editor
- Vertical captioned render and download
- Project deletion
- Optional PostgreSQL state persistence

Not included now:

- Authentication, workspaces or cross-user isolation
- Resumable multipart/object-storage upload
- Separate durable job queue and worker service
- Face/active-speaker tracking or manual crop controls
- Brand kits, billing or usage metering
- Social OAuth or direct publishing
- Public-production monitoring, backups and retention automation

## Decisions in force

1. Responsive web/PWA direction before native applications.
2. Original media uploads only; no arbitrary YouTube downloader.
3. Human review before export or later publishing.
4. Export-first MVP.
5. Provider and persistence boundaries remain replaceable.
6. Private single-user proof before multi-tenant public beta.
7. PostgreSQL state is optional locally and activated only by configuration.

## Tomorrow's handoff action

Follow [database connection checklist](docs/operations/database-connection.md): put one PostgreSQL URL in `.env`, restart the stack, and verify the health endpoint reports `postgres`. The schema is created automatically.

After that, run the [MVP acceptance test](docs/operations/mvp-handoff.md). No AI vendor key or social-platform account is required.

## Next engineering milestone

Before anyone exposes ClipMine publicly:

1. Add authentication and workspace-scoped authorisation.
2. Move media to private object storage with signed access.
3. Separate durable processing workers and job recovery from the API process.
4. Add upload rate/size abuse controls and retention jobs.
5. Test with a permissioned, labelled real-video evaluation set.

## Instructions for future agents

1. Read this file, the PRD and relevant ADRs before changing scope.
2. Inspect the actual branch and working tree before editing.
3. Treat the current implementation and target architecture as distinct.
4. Never claim a deferred public-production control is already present.
5. Keep private media, credentials and real customer footage out of Git.
6. Update this file after a material implementation or scope change.
