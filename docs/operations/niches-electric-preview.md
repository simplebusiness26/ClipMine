# Niches electric preview (no production skin replacement)

Owner-approved image reference: purple-electric mobile-first UI, real library thumbnails, queue and social account statuses.

- Source branch: `design/niches-electric-preview`; production `main` unchanged.
- Preview URL after deployment: `https://niches-electric.ai-seo.workers.dev`.
- Current stable URL: `https://niches.ai-seo.workers.dev`.
- Preview is an **independent Worker with static assets and a Service-Binding-only /api proxy**, not a second app backend.
- Existing production Niches Worker continues to own D1, media KV, sessions, OAuth, provider approvals, publishing and cron. The preview has one service binding to the existing `niches` Worker, but no D1/R2/KV bindings, no migrations and no cron; never create a second publishing scheduler.
- Browser auth is per hostname. Sign in on preview separately. Both sessions refer to the same users and database; the existing backend enforces ownership.
- Important OAuth constraint: developer redirect URIs are registered to the stable site. Connect/reconnect accounts from the original Niches site until a preview OAuth roundtrip is explicitly tested. Existing accounts, library, drafts and calendar can be managed from preview after logging in.
- UI must never display fictitious posts, provider connections or fabricated growth metrics. Avatar/banner decoration uses the niche name, not a fake profile photo.
- Do not deploy preview if an identical Worker already exists without verifying ownership.
- Do not run production migrations from the preview workflow, and never modify the existing `niches` Worker to enable this skin.
- A D1 time-travel recovery bookmark before preview deployment should be recorded by the deployment runner. This is a point-in-time recovery checkpoint, **not** an exported database+media backup. Media must remain in current storage.
- Default preview build uses `VITE_NICHES_SKIN=electric`. Default/production build has existing appearance.
- Tests: TypeScript, web unit tests, edge tests, `node --test services/preview/*.test.mjs`, preview build, then staging HTTP + mobile login/asset/API smoke. No production publishing during acceptance.

Rollback: keep the original live URL; if preview has problems, stop visiting it or roll back the `niches-electric` Worker. Never restore D1 merely for a styling bug.
