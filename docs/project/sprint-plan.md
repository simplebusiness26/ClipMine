# Sprint Plan

This is a dependency-ordered build plan. Time estimates should be added only after the team, weekly capacity and provider budget are confirmed.

## Milestone 0 — Discovery and evaluation foundation

Deliverables:

- Choose one initial creator segment
- Complete at least 10 discovery interviews or equivalent observed workflows
- Collect permissioned evaluation videos and labels
- Establish transcript-only and heuristic candidate baselines
- Benchmark transcription/render cost on representative files

Acceptance:

- Clear beta persona and top workflow documented
- Evaluation rubric produces reasonable reviewer agreement
- Initial upload duration/size limits based on measured costs

## Milestone 1 — Repository and local platform

Deliverables:

- Monorepo scaffold
- Web/API/worker services
- Docker local environment
- PostgreSQL migrations
- Authentication and personal workspace
- CI quality gates and tiny media fixtures

Acceptance:

- New developer can start the stack from documented commands
- Authenticated user can create/list a tenant-scoped project
- Cross-user project tests fail closed

## Milestone 2 — Resumable upload and job skeleton

Deliverables:

- Private object storage
- Multipart upload session API/UI
- Media validation/probe
- Queue, worker lease, retry and cancellation model
- Project progress UI

Acceptance:

- Upload resumes after an interrupted connection
- Unsupported/corrupt media fails clearly
- Worker death is recovered without duplicate project state

## Milestone 3 — Transcript and candidate proof

Deliverables:

- Proxy/audio stage
- Transcription adapter with word timing
- Transcript storage/view
- Candidate generation, scoring reasons and diversity selection
- Evaluation harness/version provenance

Acceptance:

- One real project yields ranked timestamped candidates
- Top candidates beat defined baselines on the held-out set
- “No suitable clips” works without fabricated candidates

## Milestone 4 — Vertical preview and final render

Deliverables:

- Visual focus/face tracks with fallback
- 9:16 reframing
- Caption cue generation and theme
- Candidate preview and final MP4 render
- Render retry, signed download and golden tests

Acceptance:

- Output passes codec/dimension/A/V-sync checks
- Multi-speaker fallback is usable
- Failed render does not lose candidate/edit state

## Milestone 5 — Review and lightweight editor

Deliverables:

- Candidate review/accept/reject
- Transcript-synchronised trim
- Caption correction/grouping
- Crop focus override
- Mobile-safe editor and version history

Acceptance:

- User completes upload-to-download on phone and desktop
- Keyboard does not cover active caption controls
- Saved edits reproduce the same versioned render

## Milestone 6 — Trust, operations and private alpha

Deliverables:

- Usage reservation and cost caps
- Full deletion workflow and reconciliation
- Admin health/support tooling with audited access
- Monitoring, alerts, backups and runbooks
- Rights/takedown and privacy materials
- Accessibility and security testing

Acceptance:

- All launch gates in the PRD pass
- Invited users process projects without developer database intervention
- Incidents, deletion and provider outage drills complete

## Milestone 7 — Beta improvements

- Brand kits and templates
- Quality calibration from consented feedback
- Better onboarding/recovery
- Plan/allowance experience
- Broader source formats/languages based on evidence

## Milestone 8 — Platform publishing

- Official OAuth connections
- Capability registry
- YouTube upload
- TikTok/Meta integrations subject to review and account eligibility
- Publication reconciliation, status and idempotency

Publishing work must not block the export-based MVP.

