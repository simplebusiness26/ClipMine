# Niches implementation roadmap

The owner's 2026-10-26 brief is the target scope. A feature is not production verified just because it is implemented. The partial portal is live at <https://niches.ai-seo.workers.dev>. Uploads and social publishing are not enabled.

| Phase / requirement | State | Evidence or next step |
| --- | --- | --- |
| Audit both repositories and AISO bridge/workflows | Implemented | Source audit recorded in operations rollout |
| AISO Cloudflare account and permission reuse | Partial | Same account context verified inside AISO Actions; Workers/D1 work, R2 returns 403; no credentials exported |
| Same-account separate Worker/D1/R2 config | Partial | Dedicated niches Worker and D1 deployed; R2 omitted pending storage access |
| Niches rebrand and main portal after login | Live verified | HTTP registration/login and authenticated browser dashboard passed |
| User accounts, sessions, ownership | Partial production proof | Live registration/session/login passed; two-user isolation verified in CI |
| Password recovery | Partial | One-time reset/session revocation implemented; real email adapter/delivery unconfigured |
| Niche create/edit and individual workspaces | Partial production proof | Live niche creation passed; editing and all workspace/mobile sections passed CI |
| Content library, search and batch upload | Blocked in production | Local R2 tests pass; live uploads explicitly disabled until storage access works |
| Drafts and master/platform metadata | Partial production proof | Live text draft persisted; complete media/metadata review passed CI |
| Automatic destinations from niche accounts | Partial | Server/UI default logic; no real authorised accounts yet |
| Immediate direct publishing | Planned | No provider adapters or OAuth implemented |
| Scheduling/calendar | Partial | Working export-reminder agenda; no automatic social posting or month-grid view |
| Publish history, failure recovery and deduplication | Partial | Audit and approval guards; provider reconciliation/retries remain |
| ClipMine upload/transcribe/review/edit/render/export | Preserved | Existing Python media suite; optional local model not downloaded in this run |
| ClipMine protected gateway and Send to Niches | Locally verified | Real synthetic FFmpeg journey and R2 transfer/deduplication |
| Official Facebook Pages/Reels integration | Planned | OAuth, provider adapter, app review and real test all required |
| Official Instagram professional/Reels integration | Planned | OAuth, provider adapter, app review and real test all required |
| Official TikTok integration | Planned | Creator-info UX, OAuth, API adapter, app review and real test required |
| Official YouTube/Shorts integration | Planned | OAuth, resumable upload adapter, processing status and real test required |
| Covers, thumbnails and platform validation | Planned | Implement against current supported official capabilities |
| Brand kits, ideas and manual GBP revenue | Locally verified | Scoped API controls and mobile forms |
| Analytics | Partial | Honest unavailable metrics plus actual manual revenue; no fabricated performance |
| Notifications | Locally verified | Idempotent export reminder notifications |
| Optional caption AI, recycling, niche intelligence | Planned | Do after functional authorised publishing; no paid AI activated |
| Token encryption and reconnect lifecycle | Planned | No tokens stored yet; schema alone does not count |
| Rate limiting, CSRF, private media and audit | Locally verified | API tests; public launch still needs threat review/abuse hardening |
| Backup/rollback runbook | Partial | Documented; no remote backup or restore has been tested |
| AISO-style deploy and independent audit workflows | Partial | Isolated AISO operations branch deployed Niches and passed live checks; source pin updates still required |
| Mobile browser testing | Locally verified | 12 sections at 320/375/390/430/1440 px, Chromium; no physical Android proof |
| Full public production launch | Blocked | Access, hosting, security, email, provider implementation/review and real acceptance outstanding |

## Next milestones

1. Resolve R2 access (HTTP 403) and private media storage, then prove real uploads and server-to-server clip transfer on the live portal. Inventory legacy deployment/data before any migration.
2. Implement one official provider end to end with encrypted OAuth and durable publication reconciliation, then test an owner-authorised post before adding the others.
3. Connect private rendering compute and transactional email; prove real device, backup/restore and production acceptance before public launch.
