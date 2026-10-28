# Niches implementation roadmap

The owner's 2026-10-26 brief is the target scope. A feature is not production verified just because it is implemented. The beta portal is live at <https://niches.ai-seo.workers.dev>. Private KV uploads are enabled and passed actual remote upload/download/range checks on 2026-10-27; direct social publishing is not authorised or verified.

| Phase / requirement | State | Evidence or next step |
| --- | --- | --- |
| Audit both repositories and AISO bridge/workflows | Implemented | Source audit recorded in operations rollout |
| AISO Cloudflare account and permission reuse | Partial | Same account context verified inside AISO Actions; Workers/D1 work, R2 returns 403; no credentials exported |
| Same-account separate Worker/D1/media config | Partial | Dedicated Worker, D1 and KV namespace deployed; R2 remains blocked by account entitlement |
| Niches rebrand and main portal after login | Live verified | HTTP registration/login and authenticated browser dashboard passed |
| User accounts, sessions, ownership | Partial production proof | Live registration/session/login passed; two-user isolation verified in CI |
| Password recovery | Partial | One-time reset/session revocation implemented; optional direct Brevo sender added, still needs dedicated API key/verified sender and actual delivered-email test |
| Niche create/edit and individual workspaces | Partial production proof | Live niche creation passed; editing and all workspace/mobile sections passed CI |
| Content library, search and batch upload | Limited beta live | Actual live authenticated upload, range download and access denial passed on Workers KV; 25 MiB/file, conservative shared cap, eventual consistency |
| Drafts and master/platform metadata | Partial production proof | Live text draft persisted; complete media/metadata review passed CI |
| Automatic destinations from niche accounts | Partial | Server/UI default logic; no real authorised accounts yet |
| Immediate direct publishing | Implemented, not authorised | Encrypted official OAuth/approval-bound adapters and mocked provider tests exist; external app credentials/approvals and real test posts are missing |
| Scheduling/calendar | Partial | Export reminders live; approval-bound scheduled social outbox implemented but not production verified, month-grid view incomplete |
| Autopilot ZIP-to-campaign import | Planned (discussion approved for roadmap; not implemented) | Parse an uploaded ZIP with videos and a filename-linked manifest of titles, descriptions, hashtags and per-platform overrides; safe ingestion and human-review exception queue |
| Autopilot hands-off campaign scheduling | Planned (not implemented) | Create a queue, choose per-niche/account frequencies and timezones, auto-fill calendar and allow a one-time campaign/preset approval; no universal 'best hour' claims |
| Autopilot multi-account distribution, monitoring and optimisation | Planned (not implemented) | Official authorised per-account publishing, pause/retry/deduplicate, real analytics-based scheduling; prerequisite: actual platform approvals and verified publishing |
| Autopilot content reserve and future assisted production | Future exploration only | Evergreen queue, optional content suggestions/scripts and later optional creator-pipeline handoff; no fully autonomous generation or publishing promised |

| Publish history, failure recovery and deduplication | Locally tested | Per-account outbox, leases, provider statuses and uncertain-write retry safeguards; no real provider completion has been verified |
| ClipMine upload/transcribe/review/edit/render/export | Preserved | Existing Python media suite; optional local model not downloaded in this run |
| ClipMine protected gateway and Send to Niches | Locally verified | Real synthetic FFmpeg journey and R2 transfer/deduplication |
| Official Facebook Pages/Reels integration | Coded, unverified | OAuth/provider adapter tested with simulated responses; Meta app credentials, permissions and real authorised post outstanding |
| Official Instagram professional/Reels integration | Coded, unverified | OAuth/provider adapter tested with simulated responses; Meta app credentials, permissions and real authorised post outstanding |
| Official TikTok integration | Coded, unverified | Creator-info/OAuth/provider video adapter tested with simulated responses; app approval, verified domain and real post outstanding |
| Official YouTube/Shorts integration | Coded, unverified | OAuth and resumable upload adapter tested with simulated responses; Google credentials/consent and real post outstanding |
| Covers, thumbnails and platform validation | Planned | Implement against current supported official capabilities |
| Brand kits, ideas and manual GBP revenue | Locally verified | Scoped API controls and mobile forms |
| Analytics | Partial | Honest unavailable metrics plus actual manual revenue; no fabricated performance |
| Notifications | Locally verified | Idempotent export reminder notifications |
| Optional caption AI, recycling, niche intelligence | Planned | Do after functional authorised publishing; no paid AI activated |
| Token encryption and reconnect lifecycle | Coded, unverified | AES-GCM token vault, encrypted OAuth state and refresh code covered by unit tests; no real owner-authorised connection |
| Rate limiting, CSRF, private media and audit | Locally verified | API tests; public launch still needs threat review/abuse hardening |
| Backup/rollback runbook | Partial | Documented; no remote backup or restore has been tested |
| AISO-style deploy and independent audit workflows | Partial | Isolated AISO operations branch deployed Niches and passed live checks; source pin updates still required |
| Mobile browser testing | Locally verified | 12 sections at 320/375/390/430/1440 px, Chromium; no physical Android proof |
| Full public production launch | Blocked | Beta media uploaded successfully; hosted rendering, live email, provider credentials/review, real publishing, backup/restore and device testing remain |

## Proposed feature: Niches Autopilot — ZIP upload to hands-off publishing (added 2026-10-28)

**Status: ROADMAP ONLY — not built, deployed, connected or verified.** Product intent agreed in discussion: Niches should be as hands-off as possible once the owner connects eligible accounts, sets preferences and approves an initial campaign/publishing policy. This is an extension of the existing niche, multi-account, draft, calendar and approval-bound outbox architecture, not a replacement for ClipMine or a claim that live social publishing works today. Do not activate paid products or publish to real accounts without the owner's authorisation and the applicable provider permissions.

### Intended user journey

1. Choose a niche and upload one ZIP containing e.g. 20 videos plus accompanying titles, descriptions, hashtags and optionally platform-specific metadata. Prefer a **manifest** (`manifest.json` or `posts.csv`) referencing the exact video filenames; support a documented filename convention or sidecar metadata for compatibility. Do not blindly guess metadata matches.
2. Safely unpack and import the batch as unpublished content-library drafts. Match by declared file path/ID, display import totals, flag duplicate files, missing/ambiguous metadata, invalid video formats and incompatible platform requirements. Hold exceptions for a concise review rather than silently mixing captions and videos.
3. In the niche's **Autopilot** settings, configure connected destination accounts (including multiple accounts per platform), posting frequency, timezone, allowed hours, start date, content order/mix, platform caption adaptations, budget limits and optional campaign end date. Allow defaults per niche with overrides per account.
4. Preview a complete campaign and approve it **once**, or save an authorised reusable publishing policy for future batches, with explicit destinations and account-level scope. Queue only eligible content; keep all unapproved/invalid items as drafts. Make an immediately accessible pause-all/kill switch, edit/reschedule, and account disconnect option.
5. Publish at the scheduled times via the existing official, permission-scoped provider adapters and durable per-account outbox (not browser automation or password collection). Show scheduled/publishing/published/failed/needs-attention status, provider post links when confirmed, missed-slot handling, bounded retries, duplicate guards and alerts only when attention is needed. Respect platform-specific privacy choices, rate limits and required creator interaction.
6. Track **real** provider performance data when permissioned and available; suggest smarter future posting times, frequency and content mix with clear confidence and no fabricated metrics. Initially use transparent default time windows and simple experiments; don't claim universal 'best times'. Maintain an optional **Content Reserve** of additional imported posts to keep the queue full.

### Implementation phases and priorities

- **A — Dependable ingestion and review (first):** define portable manifest schema with `video_filename`, `title`, `description`, `hashtags[]`, optional `account_ids[]` / platform overrides and optional posting hints. Support CSV/JSON, UTF-8, file-size/count limits, preview, validation and mapping errors. Reject path traversal, archive bombs, nested/unsafe archives, unsupported formats and oversized batches. Use streamed/chunked processing or approved backend staging; **current Workers KV beta has a 25 MiB per-file cap and is not suitable for large ZIP/video batches without a reviewed storage/upload design**. Never expose another user's private uploads.
- **B — Autopilot queue and scheduling:** build schedule generator, per-niche and per-account frequencies/timezones, allowed windows, spacing, queued reserve, manual rearrangement, easy rescheduling, campaign/preset approval and bulk pause. Account for daylight saving time, posting collisions, quotas, missing metadata, disconnected accounts, provider limits and retry policies. Make schedule generation deterministic and idempotent; one video can produce several destination-specific delivery jobs, each tracked independently.
- **C — Actual distribution and reliability:** integrate with the existing secure OAuth, scheduler and per-account outbox; harden queue claiming/leases, outage recovery, idempotency, approval auditing, token-expiry notifications, accurate provider confirmation and failure states. Do not auto-republish after uncertain platform responses without checking provider state. **Gate rollout on successful genuine owner-authorised social publishing tests for every enabled provider.**
- **D — Feedback and intelligence:** import supported analytics, compare content by topic/hook/length/platform, recommend publishing windows and test changes conservatively; never imply causation from tiny samples. Offer a periodic concise digest and flag depleted reserves, errors or required account actions.
- **E — Optional future creator loop (separate decision):** recommend new topics/scripts from observed results, optionally hand off to the existing video-production pipeline and automatically ingest finished output after rights/quality/brand checks. This is exploration, not an approved autonomous video generator or an unconditional autopublish promise. Any paid AI/API use requires explicit owner approval.

### Acceptance criteria for a future implementation

- A test ZIP with 20 uniquely named videos and matching manifest entries yields exactly 20 correctly paired drafts, including preserved hashtags, platform variations and originals; malformed/ambiguous metadata is flagged, not guessed.
- One niche can target several eligible accounts (including two on the same platform) with distinct schedules, timezone handling, destination-specific captions and accurate per-destination states.
- One-time campaign approval or a clear reusable approved policy produces the expected queued jobs; pause/disconnect stops subsequent dispatch, and unapproved material never reaches provider APIs.
- A missed cron tick, token expiry, provider rate limit or ambiguous API result does not silently lose or duplicate a scheduled post; the owner gets a meaningful actionable alert.
- A real authorised end-to-end posting and reporting test passes on each enabled provider. Local mocks, code-complete adapters and a visible calendar **do not** count as working social publishing.
- UI works on a mobile browser, including ZIP progress, exception review, calendar, queue, pause and results. Private media is isolated, recoverable and subject to sensible limits.

### Dependencies and non-goals for now

The beta Worker currently supports private KV uploads up to 25 MiB/file with conservative aggregate limits, while scalable private media storage, provider credentials/review, real posts, renderer hosting and backup/restore remain unfinished. Solve those production blockers before claiming an unattended Autopilot release. Not every social provider/account/media type permits unattended direct posting; where official API rules require creator approval or in-app completion, provide an honest pending/manual-completion state. Avoid fake analytics, invented schedule benefits, paid service activation and background posting to accounts without affirmative authorisation.

## Next milestones

1. Keep the free KV beta upload boundary; resolve R2 eligibility or an approved scalable private storage alternative before supporting larger media. Verify live ClipMine-to-Niches transfer after renderer hosting. Inventory legacy deployment/data before any migration.
2. Configure approved social developer applications and run one genuine owner-authorised OAuth connection and post end to end, then repeat for each provider. Do not enable provider flags before approvals.
3. Connect private rendering compute and project-specific Brevo/transactional email secrets; prove real delivery, physical device use, KV backup/restore and production acceptance before public launch.
