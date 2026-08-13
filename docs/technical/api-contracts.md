# API Contracts

The production OpenAPI document will be generated from the API implementation. This file defines the intended resource and command boundaries.

Base path: `/v1`

## Conventions

- JSON uses `snake_case` or `camelCase` consistently; choose once in implementation.
- IDs are opaque.
- Timestamps are UTC ISO 8601.
- Commands that create work accept `Idempotency-Key`.
- Errors use a stable code, safe message, correlation ID and optional field details.
- Media bytes travel directly to/from object storage using signed instructions.

Error shape:

```json
{
  "error": {
    "code": "MEDIA_UNSUPPORTED",
    "message": "This video's codec is not supported yet.",
    "correlation_id": "opaque-id",
    "details": []
  }
}
```

## Projects

### `POST /projects`

Creates a draft project.

Request fields: title, language mode, desired clip count, target length range.  
Returns: project resource and current usage estimate if available.

### `GET /projects`

Cursor-paginated, workspace-scoped list with status filters.

### `GET /projects/{project_id}`

Returns project summary, processing stages and allowed actions.

### `DELETE /projects/{project_id}`

Starts an idempotent deletion request. Returns deletion status rather than claiming synchronous physical deletion.

## Uploads

### `POST /projects/{project_id}/uploads`

Creates multipart/direct upload instructions after allowance and rights confirmation.

### `POST /projects/{project_id}/uploads/{upload_id}/parts`

Issues or refreshes signed instructions for specific parts.

### `POST /projects/{project_id}/uploads/{upload_id}/complete`

Confirms uploaded parts, verifies the object and enqueues validation.

### `DELETE /projects/{project_id}/uploads/{upload_id}`

Aborts the active upload where possible.

## Processing

### `GET /projects/{project_id}/jobs`

Returns safe stage status, attempts, timestamps, user-facing error and overall progress semantics.

### `POST /projects/{project_id}/retry`

Retries the latest recoverable failed stage. Server decides whether retry is allowed.

### `POST /projects/{project_id}/cancel`

Requests cancellation at the next safe boundary.

## Transcript and candidates

### `GET /projects/{project_id}/transcript`

Returns paginated/ranged timestamped segments. Large transcripts are not embedded in the project response.

### `GET /projects/{project_id}/candidates`

Returns ranked candidates, reasons, preview status and user disposition.

### `POST /projects/{project_id}/candidates/{candidate_id}/accept`

Creates a logical clip from the candidate.

### `POST /projects/{project_id}/candidates/{candidate_id}/reject`

Records rejection under the feedback/retention policy.

### `POST /projects/{project_id}/candidate-generations`

Creates a new generation with changed length/topic/count settings; does not overwrite the prior version.

## Clips

### `GET /clips/{clip_id}`

Returns clip and latest editable version.

### `POST /clips/{clip_id}/versions`

Creates an immutable version from boundaries, crop track, caption cues and style references. Validates source-time bounds.

### `POST /clips/{clip_id}/versions/{version_id}/renders`

Queues preview or final render. Requires idempotency key.

### `GET /renders/{render_id}`

Returns status, output profile, safe error and download availability.

### `POST /renders/{render_id}/download-url`

Returns a short-lived, authenticated signed URL.

## Usage and settings

### `GET /usage`

Returns current allowance, reserved/consumed source minutes and reset/plan metadata.

### `GET|PATCH /settings/retention`

Displays or modifies allowed retention options.

## Later social APIs

- `POST /social/connections/{platform}/authorize`
- `GET /social/connections`
- `DELETE /social/connections/{connection_id}`
- `POST /clip-versions/{version_id}/publications`
- `GET /publications/{publication_id}`

Publication creation requires destination, metadata, platform validation result and explicit confirmation token/action.

## Internal job event

```json
{
  "event_version": 1,
  "job_id": "opaque-id",
  "project_id": "opaque-id",
  "workspace_id": "opaque-id",
  "stage": "transcribe",
  "input_version": "sha-or-version",
  "pipeline_version": "version",
  "attempt": 1,
  "trace_id": "opaque-id"
}
```

Queue payloads must not contain transcript text, OAuth tokens or signed media URLs.

