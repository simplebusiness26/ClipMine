# Private MVP Handoff

## Handoff outcome

The repository contains a runnable single-user ClipMine vertical slice:

`upload → inspect → transcribe/fallback → suggest → edit → render → download → delete`

It runs before a database is connected. Adding PostgreSQL changes only metadata persistence.

## Tomorrow checklist

1. Clone or pull `main`.
2. Copy `.env.example` to `.env`.
3. Add `DATABASE_URL` using the [database checklist](database-connection.md).
4. Run `docker compose up --build --detach`.
5. Confirm `/api/health` reports PostgreSQL and FFmpeg.
6. Open <http://localhost:8000> and run the acceptance test below.

## Manual acceptance test

Use a short video you own or have permission to republish.

1. Open ClipMine at a phone or desktop width.
2. Select a supported MP4, MOV, M4V or WebM file.
3. Choose two to five suggestions and a sensible clip-length range.
4. Confirm the rights checkbox and upload.
5. Watch the progress move through inspection, transcription and candidate analysis.
6. Open a suggested clip and play the source preview.
7. Change the title, start/end time or caption text and save.
8. Render the clip.
9. Download the MP4 and confirm it is vertical, playable and captioned.
10. Refresh the browser; the project and edit should still exist.
11. Restart the container; the project should still exist.
12. Delete the project and confirm it disappears and its media files are removed.

## Automated evidence

CI repeats deterministic checks on every push and pull request:

- Markdown lint and local-link validation
- TypeScript type-check
- Vitest unit tests
- Vite production build
- Ruff Python lint
- Pytest model/store tests
- Synthetic FFmpeg end-to-end upload, fallback analysis, edit, render, download and deletion

## Supported private-MVP assumptions

- One trusted operator
- One API/container instance
- Media stored on one persistent private volume
- JSON or PostgreSQL metadata persistence
- Local CPU transcription, with timeline fallback
- Centre-fit vertical rendering rather than face tracking
- Manual MP4 download rather than social-platform OAuth

## Known limits before public use

Do not put this build on an open public URL. It does not yet include authentication, workspace authorisation, public abuse controls, object storage or a durable cross-process queue.

Before public beta, complete the security and scaling milestone in `PROJECT_CONTEXT.md` and the [roadmap](../product/roadmap.md). Connecting a database makes this private MVP durable; it does not by itself make the service production-ready.

## Recovery notes

- A failed transcription automatically uses timeline suggestions.
- A failed project exposes a Retry action when safe.
- A failed render preserves the candidate and its edits for another attempt.
- A restart resumes uploaded/processing projects and resets interrupted renders to idle.
- If PostgreSQL is unavailable, fix the URL and restart. The app intentionally fails rather than writing to an unexpected fallback store.
