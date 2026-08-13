# Testing Strategy

## Current automated baseline

GitHub Actions runs two independent jobs on pull requests and `main`.

### Web and documentation

- Markdownlint across repository Markdown
- Relative Markdown link validator
- TypeScript no-emit type-check
- Vitest unit tests for time/size formatting helpers
- Vite production build

### API and media

- Ruff linting for API and tests
- Pydantic/candidate scoring tests
- JSON-store round trip and deletion
- Persistence-adapter selection from `DATABASE_URL`
- Synthetic FFmpeg end-to-end API test

The end-to-end test generates a 12-second test-pattern video and tone, then verifies:

1. Health reports JSON and FFmpeg.
2. Missing rights confirmation is rejected.
3. Valid upload returns HTTP 202.
4. FFprobe and timeline fallback reach ready state.
5. Source preview is available.
6. Candidate title/range/caption edits persist.
7. Render reaches ready state.
8. Download returns a non-empty MP4.
9. Deletion removes project access.

No real or customer footage is stored in the repository.

## Local commands

```bash
npm run lint:docs
npm run check:links
npm run lint:web
npm run test:web
npm run build:web
.venv/bin/ruff check services/api/clipmine_api services/api/tests
cd services/api && ../../.venv/bin/pytest -q
```

## Manual private-MVP acceptance

Run the [handoff acceptance test](../operations/mvp-handoff.md) with short authorised footage on phone and desktop widths. Confirm playback, captions, downloaded orientation, persistence across refresh/restart and deletion.

## Missing tests before public beta

### Authentication and isolation

- Unauthenticated/expired access
- Cross-workspace reads, edits, media and deletes
- Guessed project/asset IDs
- Administrator access auditing

### Database and durability

- Real PostgreSQL schema/bootstrap in CI
- Concurrent updates and worker retries
- JSON-to-PostgreSQL migration utility if required
- Backup/restore with media reconciliation
- Schema migration forward compatibility

### Upload and media safety

- Content/type mismatch and malformed containers
- Oversized/very long resource exhaustion
- Rotation, variable frame rate and uncommon audio layouts
- Portrait, landscape, screen-share and multiple speakers
- No audio, quiet/noisy speech and no-speech source
- FFmpeg timeout/cancellation and disk-full behaviour

### Browser/accessibility

- Upload/progress/recovery browser flow
- 360 px, common phone, tablet and laptop widths
- Software keyboard while editing captions
- Keyboard navigation, focus and accessible labels
- Reduced motion and offline/interrupted states

### Operations/security

- Dependency, secret and container scanning
- Rate limits and cost quotas
- Structured-log redaction
- Queue worker death/lease recovery
- Complete deletion from database, storage, cache, providers and backups

## AI quality evaluation

Use a permissioned dataset separated by creator/video across calibration and held-out test sets. Human reviewers score opening clarity, standalone context, payoff, boundary quality, caption accuracy, framing, editing effort and usable/not usable.

Compare random ranges, timeline fallback, current transcript heuristic and any proposed semantic/visual model. Adopt changes only when top-k utility improves without unacceptable latency, cost or subgroup regressions.

## Release evidence

Every release/handoff records:

- Commit/deployment ID
- Exact automated command results
- Database/schema action
- Manual media smoke result
- Known limitations
- Rollback plan
