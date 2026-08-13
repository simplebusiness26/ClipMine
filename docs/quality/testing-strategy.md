# Testing Strategy

## Objective

Prove that ClipMine protects private media, survives unreliable processing and produces clips humans consider useful. A green unit-test suite alone is insufficient.

## Test layers

### Static checks

- Formatting and linting
- Type checks
- OpenAPI/schema compatibility
- Migration lint/verification
- Secret, dependency and container scanning

### Unit tests

- State transitions and retry classification
- Candidate boundary and diversity logic
- Caption grouping and safe-area calculations
- Usage reservation and idempotency
- Permission predicates
- Platform capability validation

### Integration tests

- PostgreSQL constraints and migrations
- Object-storage multipart lifecycle
- Queue lease, retry, cancellation and dead-letter behaviour
- Provider adapters through recorded/synthetic contract fixtures
- Signed URL purpose and expiry
- Deletion across related records/assets

### Media golden tests

Use small permissioned fixture videos with known characteristics:

- Landscape single speaker
- Two-person conversation
- Portrait source
- Screen share plus speaker
- Rotation metadata
- Variable frame rate
- Noisy/quiet audio
- No speech
- Unsupported/corrupt file

Assert duration tolerance, A/V sync, aspect ratio, codec/profile, caption timing, crop stability and deterministic render instructions. Store compact fixtures or generate synthetic fixtures; never commit customer footage.

### API/security tests

- Unauthenticated and expired token access
- Cross-workspace read/write attempts for every resource
- Guessed asset IDs and object keys
- Upload content/type mismatch
- Oversized/resource-exhaustion media
- Idempotency replay
- CSRF/CORS/rate limiting
- OAuth token redaction and revocation

### Browser end-to-end tests

Critical path:

1. Sign in
2. Create project
3. Upload fixture with progress/recovery
4. Observe persisted job progress
5. Review candidate
6. Edit caption/trim/crop
7. Render
8. Download and verify output
9. Delete project

Run core flows at desktop and phone widths, including software-keyboard behaviour.

## AI quality evaluation

### Dataset

Use permissioned source videos separated by creator/video across calibration and test sets. Label genre, language, speaker count, audio quality and visual format.

### Human rubric

Reviewers independently score:

- Opening clarity
- Standalone context
- Complete payoff
- Boundary quality
- Caption accuracy
- Visual framing
- Amount of editing required
- Overall usable/not usable

Resolve rubric disagreement before tuning models. Keep the untouched test set hidden from prompt/weight iteration.

### Baselines

Compare against:

- Random valid-length ranges
- Pause/sentence-boundary heuristic
- Transcript-only semantic ranking
- Current production pipeline

The full pipeline should beat simple baselines on top-k usable precision and edit burden, not only an internal model score.

### Regression gates

- No statistically meaningful drop on overall top-k utility
- No critical regression for a major source format/language in scope
- Boundary and caption metrics remain within tolerance
- Cost/latency change is documented
- Pipeline/config version is recorded and rollback available

## Reliability tests

- Worker dies mid-stage and lease is recovered
- Provider returns rate limit, timeout, malformed output and partial success
- Browser disconnects during multipart upload
- Duplicate completion/render requests
- Object exists but database callback fails, and vice versa
- Cancellation races with stage completion
- Database/object-store temporary outage
- Deletion while job is queued/running

## Performance and cost tests

Benchmark by source minute, resolution and concurrency:

- Upload finalisation
- Proxy/audio creation
- Transcription
- Candidate analysis
- Preview/final render
- Storage and egress

Record CPU/GPU time, memory peak, output bytes, provider usage and wall-clock time. Production limits must follow measured data.

## Test environments

- Local: deterministic emulators/containers and tiny fixtures
- CI: unit, integration, security and selected golden media tests
- Staging: production-shaped services with non-sensitive test media and sandbox OAuth
- Production: synthetic canary project plus privacy-safe health telemetry

## Release evidence

Every release records:

- Commit/deployment ID
- Schema migration result
- Automated gate results
- Media pipeline version
- Known limitations
- Rollback plan

