# Technical Specification

Status: implemented private-MVP baseline plus documented production path

Date: 2026-08-13

## 1. Scope

This specification separates two system shapes:

- **Private MVP now:** one trusted operator, one FastAPI process, local persistent media, JSON or PostgreSQL metadata.
- **Public beta target:** authenticated tenants, object storage, durable workers/queue, production controls.

The current code is intentionally small but keeps a persistence interface and background-pipeline boundary so later services can replace those implementations.

## 2. Implemented stack

| Layer | Current implementation |
|---|---|
| Web | React 19, TypeScript 7, Vite 8 |
| API | Python 3.12, FastAPI, Pydantic |
| Media | FFmpeg and FFprobe subprocesses |
| Transcription | Faster Whisper local CPU option in an isolated subprocess |
| Candidate analysis | Deterministic transcript heuristics with timeline fallback |
| Metadata | Atomic JSON file or Asyncpg/PostgreSQL adapter |
| Media storage | Private application filesystem/Docker volume |
| Background work | Bounded in-process asynchronous tasks |
| Packaging | Multi-stage Docker image and Docker Compose |
| Quality | Vitest, TypeScript, Ruff, Pytest, synthetic media integration test, GitHub Actions |

## 3. Repository layout

```text
apps/web/                  React application
services/api/clipmine_api/ FastAPI and media pipeline
services/api/tests/        Unit and end-to-end tests
db/schema.sql              PostgreSQL schema reference
scripts/                   Repository validation helpers
docs/                      Product and engineering source of truth
.github/workflows/ci.yml   CI pipeline
Dockerfile                 Production-style single-container image
docker-compose.yml         Local/private deployment
```

## 4. Current processing flow

1. Browser uploads a supported original file through multipart form data.
2. API streams it to a per-project source directory with a byte limit.
3. API persists the project and starts a bounded background task.
4. FFprobe validates duration and video metadata.
5. An isolated Faster Whisper process attempts timestamped transcription unless disabled.
6. Candidate scoring selects diverse transcript windows; a timeline fallback runs if no transcript candidates exist.
7. Browser polls the project and exposes candidate editing.
8. A render command starts FFmpeg in the background.
9. FFmpeg produces a vertical H.264/AAC MP4 with optional burned captions.
10. The user downloads the file or deletes the project.

No long operation blocks the upload response after the source bytes have arrived. Processing progress is persisted and recoverable across page refreshes.

## 5. Persistence

`ProjectStore` defines initialise, close, list, get, save and delete operations.

### JSON mode

- Selected when `DATABASE_URL` is empty.
- Uses `data/state/projects.json`.
- Serialises the complete Pydantic project document.
- Uses an asynchronous lock plus write-to-temporary-and-replace for atomic updates.

### PostgreSQL mode

- Selected when `DATABASE_URL` is non-empty.
- Opens an Asyncpg pool with one to five connections.
- Disables the statement cache for connection-pooler compatibility.
- Creates a private `clipmine` schema and `projects` JSONB table.
- Upserts one document per project and indexes `updated_at`.

The private schema is server-only and intentionally not granted to Supabase browser roles. See [database connection](../operations/database-connection.md).

### Media mode

Source and export bytes remain under `CLIPMINE_DATA_DIR`. PostgreSQL stores paths/references, not video blobs. One persistent volume is therefore required even after connecting the database.

## 6. Upload contract

- Containers accepted by extension: MP4, MOV, M4V and WebM.
- Default maximum: 1,024 MB, configurable.
- Default source duration maximum: 180 minutes, configurable.
- User must affirm authorisation to process and republish.
- Original filenames are reduced to a safe project title; stored filenames are generated.
- FFprobe must find a playable video stream and positive duration.
- Failed or oversized uploads are removed.

The private MVP proxies upload bytes through FastAPI. Resumable direct-to-object-storage uploads remain a public-beta requirement.

## 7. Background task behaviour

- One `PipelineManager` owns processing and render tasks.
- A semaphore limits concurrent media work.
- Duplicate task keys do not start duplicate active work.
- Uploaded or processing projects are re-enqueued at startup.
- Interrupted queued/rendering candidates return to idle at startup.
- Deletion cancels matching tasks, deletes state and removes the project directory.

This is restart-tolerant for a single process, not a distributed durable queue. A crash can repeat a processing stage; stages are designed to overwrite their own project results safely.

## 8. Candidate model

Candidate inputs are timestamped transcript segments. The algorithm proposes the first valid-length window from each segment start, scores observable features, sorts, suppresses heavy overlap and returns the requested count in source order.

Signals include question/hook language, complete ending, payoff language, speaking density, lexical concentration, filler penalty and preferred duration. The displayed score is an editorial heuristic, never a prediction of platform performance.

When transcription is disabled, unavailable, fails or yields no valid candidates, the system spreads experimental fixed-length ranges across the source.

## 9. Render profile

Default private-MVP output:

- MP4 container
- H.264 video, YUV 4:2:0
- AAC audio when source audio exists
- 720 × 1280 (9:16)
- CRF 22, `veryfast` preset
- Fast-start metadata
- Source centred and scaled over a blurred full-frame background
- Captions grouped into approximately seven-word SRT cues and burned with FFmpeg subtitles

The render uses a safe centre-fit fallback. It does not yet perform face detection, active-speaker tracking, crop animation or audio loudness normalisation.

## 10. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | empty | Enable PostgreSQL metadata |
| `CLIPMINE_DATA_DIR` | `data` | State and media root |
| `CLIPMINE_STATIC_DIR` | `static` | Built web assets served by FastAPI |
| `CLIPMINE_CORS_ORIGINS` | local ports | Allowed development origins |
| `CLIPMINE_MAX_UPLOAD_MB` | `1024` | Upload byte limit |
| `CLIPMINE_MAX_SOURCE_MINUTES` | `180` | Duration limit |
| `CLIPMINE_WORKER_CONCURRENCY` | `1` | Concurrent media tasks |
| `CLIPMINE_TRANSCRIPTION_PROVIDER` | `faster-whisper` | `faster-whisper` or `off` |
| `CLIPMINE_WHISPER_MODEL` | `tiny` | Local model name |
| `CLIPMINE_WHISPER_DEVICE` | `cpu` | Inference device |
| `CLIPMINE_WHISPER_COMPUTE_TYPE` | `int8` | Inference quantisation |
| `CLIPMINE_RENDER_WIDTH` | `720` | Output width |
| `CLIPMINE_RENDER_HEIGHT` | `1280` | Output height |

The complete safe template is `.env.example`. Real values never belong in Git.

## 11. Failure taxonomy

Implemented media errors include:

- `MEDIA_TOOL_MISSING`
- `MEDIA_TIMEOUT`
- `MEDIA_PROCESSING_FAILED`
- `MEDIA_CORRUPT`
- `MEDIA_UNSUPPORTED`
- `MEDIA_TOO_LONG`
- `TRANSCRIPTION_UNAVAILABLE`
- `TRANSCRIPTION_PROVIDER_UNKNOWN`
- `TRANSCRIPTION_FAILED`
- `RENDER_RANGE_INVALID`
- `INTERNAL_ERROR`

Transcription errors degrade to timeline suggestions. Inspection and unexpected pipeline errors mark the project failed with a safe message. Render errors remain on the candidate without deleting its edits.

## 12. Current security boundary

The application does not implement accounts or tenant isolation. It must remain on a trusted machine/private network. The server validates project/candidate existence and safe file locations, and Git excludes local media and secrets, but those controls do not replace authentication.

Do not expose this build publicly until the controls in [security and rights](../security/privacy-security-rights.md) are complete.

## 13. Public-beta target

The next architecture replaces, rather than stretches, private-MVP components:

| Current | Public-beta replacement |
|---|---|
| In-process tasks | Durable queue and separately scaled workers |
| Local volume | Private object storage with short-lived signed access |
| Single operator | Managed authentication and workspace authorisation |
| Whole-project JSONB | Normalised tenant-scoped relational model |
| Direct API upload | Resumable multipart object upload |
| Local CPU transcription | Benchmarked provider adapters/local workers |
| Basic logs | Structured traces, metrics, alerts and runbooks |
| Manual limits | Per-user quotas, rate limits and cost reservations |

Public production also requires backups, retention/deletion reconciliation, security tests, dependency/secret scanning and a permissioned real-media quality evaluation set.

## 14. Social publishing path

The MVP downloads files only. Later integrations use official APIs, OAuth, explicit user confirmation, platform-specific validation and idempotent publication records:

- [YouTube upload guide](https://developers.google.com/youtube/v3/guides/uploading_a_video)
- [TikTok Content Posting API](https://developers.tiktok.com/products/content-posting-api/)
- [Instagram Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Facebook video publishing](https://developers.facebook.com/documentation/video-api/guides/publishing)
