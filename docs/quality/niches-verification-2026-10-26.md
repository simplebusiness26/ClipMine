# Niches local verification — 2026-10-26

## Live portal follow-up — 2026-10-26

The portal is live at <https://niches.ai-seo.workers.dev>. It uses a distinct `niches` Worker and D1 database `4f2a701e-6960-48b3-82b5-096cabb3aeaf` in the account reached by AISO's existing deployment credentials. Credentials stayed inside AISO Actions; their values were not retrieved or copied into ClipMine.

- Deployed source: `60065bab5bbbe8bf678d7fc9bc52e37750f55689`.
- Worker version: `e3ef8e5e-8f88-459c-9ea6-dca44e11adb9`.
- [Successful isolated deployment and live acceptance](https://github.com/simplebusiness26/agentCart/actions/runs/40263889919).
- [Successful source CI](https://github.com/simplebusiness26/ClipMine/actions/runs/40263868870).
- [Foundation PR](https://github.com/simplebusiness26/ClipMine/pull/2) and [browser policy correction](https://github.com/simplebusiness26/ClipMine/pull/3) are merged.
- Actual live checks passed: anonymous protection, registration, session cookie, niche creation, text draft persistence, logout, login, public mobile layout and authenticated dashboard heading.
- Source CI passed 12 edge tests, 3 configuration/target-policy tests, 9 Python tests and 3 frontend tests, plus the real local FFmpeg/R2 journey and 12-section/five-width browser matrix.

R2 access returned HTTP 403. The reason (token scope versus service availability) is not yet established. Production deliberately omits the R2 binding, shows a storage-unavailable notice and disables uploads; media writes return an explicit 503. Library transfer and rendering remain verified locally only. No R2, Containers, queues or paid AI product was enabled. Hosted ClipMine, reset email, official social OAuth/publishing and provider analytics remain unfinished.

Operational launcher: `.github/workflows/niches-portal-deploy.yml` on `ops/niches-cloudflare` in `simplebusiness26/agentCart`. Pushes changing that launcher trigger it with an immutable ClipMine revision. A separate read-only access check is in the same branch. These operations do not trigger AISO's main-branch application deploy workflow. Future source revisions require updating the launcher's pin; fully automatic cross-repository release triggering remains roadmap work. ClipMine's separate environment-based deploy workflow remains disabled until its project-specific credentials are configured.

No legacy deployment or data was migrated or deleted, and AISO main/application resources were unchanged. A Niches D1 recovery bookmark was retained before the second migration pass. This is a partially operational portal, not completion of the full product.

## Initial local result

The foundation passes local acceptance. It is not pushed, deployed or production verified. GitHub branch creation was denied with HTTP 403 (`Resource not accessible by integration`); terminal push cannot authenticate. Local Cloudflare Wrangler reports not authenticated. No paid service was enabled, no AISO resource was changed and no legacy data was migrated.

## Checks actually run

| Check | Exact result |
| --- | --- |
| `npm run build:web` | TypeScript and Vite production build passed |
| `npm run test:web` | 3 tests passed |
| `npm run test:edge` | 11 tests passed against local D1/R2/workerd |
| `node --test ops/niches-bridge/config.test.mjs` | 2 deployment-isolation tests passed |
| `python -m ruff check services/api/clipmine_api services/api/tests` | Passed |
| `python -m pytest -q services/api/tests` | 9 tests passed; one upstream Starlette/httpx deprecation warning |
| `node ops/niches-bridge/clipmine-journey.mjs` | Real synthetic upload, editing, FFmpeg rendering, direct R2 import, duplicate import and cross-user denial passed |
| Local Playwright full journey | Register, create niche, upload image, save draft and schedule export reminder passed |
| Local Playwright viewport matrix | All 12 workspace sections checked at 320, 375, 390, 430 and 1440 pixels; no detected page overflow or page errors |
| `npm run lint:docs` | 39 files, no lint issues before this verification document was added |
| `npm run check:links` | All relative links resolved |
| `npx wrangler d1 migrations apply niches --local` | Migration `0001_niches.sql` applied locally |
| `npx wrangler deploy --dry-run` | Niches Worker bundled with distinct D1/R2/assets bindings; no remote deployment |

The local rendering test deliberately disables transcription and uses timeline suggestions. Existing transcription-boundary tests pass, but no real Whisper model or permissioned human footage was evaluated in this run. Browser testing uses desktop Chromium viewport emulation, not a physical Android phone. Screenshots were inspected locally and are not published.

## Remaining proof

- R2 access, complete resource/legacy inventory and free-allowance/billing eligibility.
- Private storage and full media journey in production; portal deployment, migrations and limited browser smoke already passed.
- Legacy hosting, database and media inventory plus backup/restore proof.
- Hosted renderer access and real email reset delivery.
- Official OAuth, encrypted social token lifecycle, direct-publishing adapters, provider approval and owner-authorised test posts.
- Production security review, durable publishing recovery, metrics and physical Android acceptance.

See the [roadmap](../product/niches-roadmap.md) for feature-level status and the [rollout runbook](../operations/niches-audit-and-rollout.md) for configuration and recovery.
