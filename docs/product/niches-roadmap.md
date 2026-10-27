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

## Next milestones

1. Keep the free KV beta upload boundary; resolve R2 eligibility or an approved scalable private storage alternative before supporting larger media. Verify live ClipMine-to-Niches transfer after renderer hosting. Inventory legacy deployment/data before any migration.
2. Configure approved social developer applications and run one genuine owner-authorised OAuth connection and post end to end, then repeat for each provider. Do not enable provider flags before approvals.
3. Connect private rendering compute and project-specific Brevo/transactional email secrets; prove real delivery, physical device use, KV backup/restore and production acceptance before public launch.
