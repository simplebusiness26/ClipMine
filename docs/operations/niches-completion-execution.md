# Niches completion execution — 2026-10-28

Status: IN PROGRESS, not production-complete. Owner approved full implementation using isolated AISO operations deployment. No paid product activation permitted without separate approval.

## Confirmed baseline
- Production origin: https://niches.ai-seo.workers.dev
- Latest verified AISO operations deployment: https://github.com/simplebusiness26/agentCart/actions/runs/40452645608
- Source pin in operations launcher: `0c6ac9f915386a52efdbfe121cfc781c9a6503ce`.
- Dedicated `niches` Worker and D1, dedicated `niches-media-kv` free KV media beta.
- Live acceptance: auth, niche and planning-account creation, draft persistence, real private media write/read, byte-range, anonymous denial.
- KV media is a limited beta, not durable scalable video storage. R2 remains disabled by entitlement error 10042.

## Execution order and acceptance gates
1. **Media durability:** document and test backup/restore and concurrency-safe upload quotas. Preserve privacy and ownership. Confirm real video uploads within 25 MiB cap; do not market KV as long-term unlimited storage.
2. **Renderer:** select a genuinely free authorised hosting option for Python/FFmpeg/Whisper, deploy isolated renderer with Niches gateway key, and verify upload → transcribe → clip → render → export through the live portal. If no feasible free compute is available, report the cost/availability blocker rather than pretending it works.
3. **OAuth:** obtain separate developer applications and approved scopes for Google/YouTube, Meta/Instagram/Facebook and TikTok. Never reuse AISO credentials. Validate each callback and real user-owned connection, including multiple accounts per niche.
4. **Publishing:** enable platform flags one at a time only after credentials and permissions are verified. Confirm approved test posts on real accounts, platform post IDs, schedule timing, retries, failures, privacy choices and deduplication. Never post without explicit user review/approval.
5. **Email:** configure project-specific Brevo credentials and verified sender, test genuine password-reset delivery and expiration. No secret values in Git.
6. **Product quality:** verify multi-account composer, content library, post history, actual analytics (no synthetic provider metrics), responsive layouts and mobile accessibility. Reconcile any stale roadmap claims.
7. **Production safety:** test session isolation, malicious upload rejection, CSRF, quotas, backups, rate limits, rollback, and cross-device account recovery.
8. **Release:** run source CI and AISO isolated workflow, pin reviewed source SHA, verify live build SHA and real end-to-end journeys; only then call Niches fully functional.

## External gates requiring owner action
- Social platform developer accounts, permissions/reviews, OAuth consent and authorised real test accounts.
- A verified Brevo sender/API key for Niches reset emails.
- Any non-free video compute or durable storage option requires explicit cost approval first.

Do not touch AISO's `aiseo` D1 or `agentcart` Worker. Do not change the existing production source pin until the replacement passes CI and staging acceptance.
