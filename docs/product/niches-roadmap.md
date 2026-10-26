# Niches implementation roadmap

The owner's 2026-10-26 brief is the target scope. A feature is not production verified just because it is implemented. No live Niches URL exists yet.

| Phase / requirement | State | Evidence or next step |
| --- | --- | --- |
| Audit both repositories and AISO bridge/workflows | Implemented | Source audit recorded in operations rollout |
| Exact AISO Cloudflare account identity and permissions | Blocked | No Cloudflare authentication; account ID secret is not retrieved |
| Same-account separate Worker/D1/R2 config | Partial | Guarded config exists; resources not provisioned |
| Niches rebrand and main portal after login | Locally verified | Browser register/login journey |
| User accounts, sessions, ownership | Locally verified | Two-user API isolation suite |
| Password recovery | Partial | One-time reset/session revocation implemented; real email adapter/delivery unconfigured |
| Niche create/edit and individual workspaces | Locally verified | API and mobile navigation |
| Content library, search and batch upload | Locally verified | R2 emulator upload/access and browser journey; large/resumable uploads remain |
| Drafts and master/platform metadata | Locally verified | API and browser save/review |
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
| AISO-style deploy and independent audit workflows | Partial | Implemented and locally guarded; not run on production |
| Mobile browser testing | Locally verified | 12 sections at 320/375/390/430/1440 px, Chromium; no physical Android proof |
| Full public production launch | Blocked | Access, hosting, security, email, provider implementation/review and real acceptance outstanding |

## Next milestones

1. Confirm Cloudflare account and resource access; inspect legacy deployment/data; deploy the verified portal to isolated free-eligible resources without switching old traffic.
2. Implement one official provider end to end with encrypted OAuth and durable publication reconciliation, then test an owner-authorised post before adding the others.
3. Connect private rendering compute and transactional email; prove real device, backup/restore and production acceptance before public launch.
