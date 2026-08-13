# Delivery Plan

This plan starts from the implemented private MVP. Dates depend on team capacity, real-media evaluation and infrastructure budget.

## Delivered — private vertical slice

- Monorepo with React web and FastAPI API
- Docker/Compose private runtime
- Original upload, FFprobe validation and progress UI
- Local Faster Whisper integration and graceful timeline fallback
- Candidate heuristics, confidence and selection reasons
- Lightweight title/trim/caption editing
- Vertical captioned render, download, retry and deletion
- JSON/PostgreSQL persistence adapter
- CI and synthetic end-to-end media test
- Product, design, technical, security and operations documentation

Acceptance evidence: automated upload-to-delete media test and repository quality gates pass.

## Immediate handoff — database and real-footage smoke

Deliverables:

- Add a PostgreSQL/Supabase URL in local secret configuration
- Verify the private schema and health response
- Complete the manual MVP acceptance test
- Record CPU time, memory, disk growth and first-model download behaviour
- Test at least three short, authorised real videos

Acceptance:

- Project metadata survives refresh and container restart in PostgreSQL mode
- Rendered outputs play correctly on a phone
- Deleting a project removes its local source and exports
- Known quality failures are recorded, not hidden by score changes

## Milestone 1 — identity and tenant boundary

Deliverables:

- Managed authentication
- Personal workspace ownership on every resource
- Server-side authorisation and cross-tenant tests
- Session/logout/account deletion baseline
- Production CORS, CSRF/security headers and rate limits

Acceptance:

- Unauthenticated and cross-workspace media/state access fail closed
- Public ingress cannot reach private projects without a valid session
- Security policy and actual implementation match

## Milestone 2 — durable media and jobs

Deliverables:

- Private object-store adapter
- Resumable direct multipart upload
- Explicit assets and jobs schema
- Durable queue, worker leases, idempotency, retry and cancellation
- Retention/deletion reconciliation

Acceptance:

- Interrupted upload resumes
- Worker death recovers without duplicate logical output
- API replicas do not own irreplaceable in-memory job state
- Project deletion covers database, objects and queued work

## Milestone 3 — quality and editor

Deliverables:

- Permissioned labelled evaluation set
- Word/sentence boundary and caption timing improvements
- Language-aware semantic candidate ranking
- Scene/face/person tracks and safe layout fallbacks
- Crop focus override and caption themes
- Browser/accessibility suite

Acceptance:

- Top candidates beat timeline/random baselines on held-out review
- Outputs pass dimension, codec, duration and A/V-sync golden checks
- Phone editor remains usable with software keyboard open
- Low-confidence/no-suitable-content behaviour is honest

## Milestone 4 — private alpha operations

Deliverables:

- Usage reservation and cost caps
- Structured logging, metrics, alerts and runbooks
- Backups and restore drills
- Rights complaint, takedown, privacy and incident processes
- Dependency, secret and container scanning
- Support tooling with audited exceptional access

Acceptance:

- Invited creators complete projects without developer intervention
- Cost and processing latency are measurable by source minute
- Incident, deletion and provider-outage drills succeed
- All PRD launch gates pass

## Milestone 5 — beta and distribution

- Brand kits and reusable templates
- Billing/allowance experience if appropriate
- Onboarding and lifecycle recovery
- Official YouTube, TikTok, Instagram and Facebook OAuth/API integrations
- Explicit publishing confirmation, destination validation and reconciliation

Publishing work must not block the export-based product.

## Explicitly deferred

- Arbitrary public-video downloading
- Unattended mass posting
- Voice cloning or synthetic presenters
- Full multitrack editor
- Claims of guaranteed virality
