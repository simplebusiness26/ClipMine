# Technical Specification

Status: recommended implementation baseline  
Date: 2026-08-13

## 1. System shape

ClipMine is an asynchronous media-processing system with a responsive web client. Interactive requests must remain fast; uploads, transcription, analysis and rendering run as resumable background jobs.

Recommended initial stack:

| Layer | Baseline |
|---|---|
| Web | Next.js, React, TypeScript |
| API | Python FastAPI with generated OpenAPI contract |
| Media/AI workers | Python workers with FFmpeg |
| Database | PostgreSQL |
| Queue/cache | Redis-compatible queue with delayed retries |
| Media storage | Private S3-compatible object storage |
| Authentication | Managed OIDC/auth provider; verified server-side JWTs |
| Observability | Structured logs, traces, metrics and error reporting |
| Local environment | Docker Compose plus fixture media |

Provider selection remains reversible through adapters. The stack may be simplified during the technical proof, but boundaries and persisted job state must remain.

## 2. Repository layout

Proposed monorepo:

```text
apps/
  web/                 # Next.js client and server-rendered UI
services/
  api/                 # FastAPI control plane
workers/
  media/               # transcription, analysis, preview and render tasks
packages/
  contracts/           # generated clients/schemas and shared event definitions
  ui/                  # reusable web components
infra/
  docker/              # local services and images
  migrations/          # database migration source
tests/
  fixtures/            # small, permissioned media fixtures
docs/
```

## 3. Processing boundary

The API owns identities, projects, permissions, metadata and job creation. Workers receive opaque IDs, fetch only authorised job assets with short-lived credentials, write derived assets, and report stage results. Workers must not expose public endpoints.

Stages:

1. Upload finalisation and media probe
2. Proxy/audio preparation
3. Transcription and diarisation
4. Scene/visual analysis
5. Candidate generation and scoring
6. Candidate preview creation
7. User editing
8. Final render
9. Export or later publishing

Each stage persists input version, provider/model version, attempt count, output references, cost/usage and terminal error category.

## 4. Upload specification

- Browser requests an upload session from the API.
- API validates allowance and creates a project plus private object key.
- Browser uploads parts directly to object storage through short-lived signed URLs.
- API never proxies the entire source through an interactive application server.
- Completion requires server-side object confirmation, checksum where supported and `ffprobe` validation.
- Reject disguised extensions, malformed containers and unsupported codecs safely.
- Clean abandoned multipart uploads automatically.

Initial accepted containers/codecs should be based on tested fixtures rather than broad claims. MP4/H.264/AAC is the required happy path; MOV and WebM can be enabled after validation.

## 5. Job model

Job states:

`queued -> running -> succeeded`

Alternate transitions:

- `queued|running -> cancelling -> cancelled`
- `running -> retry_wait -> queued`
- `running -> failed`

Requirements:

- Idempotency key per stage and input version
- Heartbeat/lease to recover abandoned workers
- Bounded exponential retry for transient failures
- No retry for validation, rights or unsupported-media failures
- Dead-letter review after retry exhaustion
- Cancellation checked between safe processing boundaries

## 6. Media profiles

### Analysis proxy

Low-resolution, streamable proxy that preserves timestamps and aspect ratio. It is used for previews and visual analysis, not final output.

### Default final output

- Container: MP4
- Video: H.264, broadly compatible pixel format
- Audio: AAC
- Aspect ratio: 9:16
- Resolution target: 1080 × 1920 when source quality permits
- Frame rate: preserve sensible source rate or normalise through tested policy
- Captions: burned in; optional SRT/VTT sidecar

Exact encoder profile, loudness and bitrate settings must be benchmarked across fixture videos and documented in code.

## 7. Authentication and authorisation

- API validates issuer, audience, expiry and signature for every access token.
- Application membership is mapped to a workspace ID.
- Every query is scoped by workspace; asset access is never authorised by object key alone.
- Signed media URLs are short-lived and purpose-specific.
- Administrator support access requires a reason, elevated role and audit record.
- Social OAuth refresh tokens are encrypted separately and never returned to the browser.

## 8. Provider adapters

Define interfaces for:

- `TranscriptionProvider`
- `LanguageModelProvider`
- `EmbeddingProvider` if used
- `ObjectStore`
- `Publisher` per social platform
- `NotificationProvider`

Store provider name and version with every derived result. Business logic must not depend on a vendor-specific response shape outside its adapter.

## 9. Platform publishing

MVP exports files only. Later integrations must use official APIs and user OAuth:

- YouTube supports authorised video upload through the YouTube Data API.
- TikTok exposes draft upload and direct-post capabilities subject to its scopes, UX rules and app approval.
- Instagram content publishing supports Reels for eligible account/integration configurations.
- Facebook's Video API supports Page video/Reels publishing flows.

Platform constraints belong in a versioned capability registry and are revalidated before submission. Publishing is idempotent and requires a recorded user confirmation.

Official references:

- [YouTube upload guide](https://developers.google.com/youtube/v3/guides/uploading_a_video)
- [TikTok Content Posting API](https://developers.tiktok.com/products/content-posting-api/)
- [Instagram Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Facebook video publishing](https://developers.facebook.com/documentation/video-api/guides/publishing)

## 10. Configuration and secrets

- Environment variables contain references to secrets, not committed values.
- Validate required configuration at startup.
- Separate development, staging and production accounts/buckets/databases.
- Rotate provider and signing credentials.
- Feature flags control expensive or platform-reviewed capabilities.

## 11. Cost controls

- Estimate source minutes before full processing.
- Reserve usage allowance atomically before enqueueing.
- Record transcription, model, compute, storage and egress usage by project/stage.
- Cap concurrency by plan and system health.
- Stop runaway jobs by wall time, output size and attempt count.
- Use analysis proxies and avoid repeated transcription for edit-only changes.

## 12. Failure taxonomy

- `UPLOAD_INTERRUPTED`
- `MEDIA_UNSUPPORTED`
- `MEDIA_CORRUPT`
- `AUDIO_INSUFFICIENT`
- `PROVIDER_RATE_LIMIT`
- `PROVIDER_UNAVAILABLE`
- `ANALYSIS_NO_CANDIDATES`
- `RENDER_FAILED`
- `ALLOWANCE_EXCEEDED`
- `PUBLISH_AUTH_EXPIRED`
- `PUBLISH_VALIDATION_FAILED`
- `INTERNAL_ERROR`

User messages remain plain and actionable; logs carry correlation and technical detail without private transcript content.

## 13. Engineering quality gates

- Formatting, linting and type checks
- Unit and contract tests
- Database migration verification
- API authorisation integration tests
- Media golden-fixture tests
- Browser smoke tests for the core flow
- Dependency and secret scanning
- Container/image vulnerability checks before production

## 14. Performance and service objectives

Initial objectives, to be calibrated:

- Interactive API p95 under 500 ms excluding upload transfer and background work
- Upload sessions recover from ordinary network interruption
- No unreported stalled job beyond the worker lease/recovery window
- Processing progress survives client refresh/logout
- Export download begins promptly from object storage through a signed URL

Do not set a universal “minutes to process” promise until real source-duration and hardware benchmarks exist.

## 15. Migration strategy

- Schema changes use forward migrations checked into source control.
- Destructive changes use expand/migrate/contract phases.
- Worker and API versions tolerate one deployment window of mixed schema where practical.
- Derived media can be regenerated; source and user edits require stricter backup and migration protection.

