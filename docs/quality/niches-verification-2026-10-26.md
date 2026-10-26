# Niches local verification — 2026-10-26

## Result

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

- Authorised GitHub push/PR and remote CI.
- Exact AISO account identity, available Cloudflare permissions, resource inventory and free-allowance eligibility.
- New Niches resources and live deployment, migrations, private storage and browser smoke.
- Legacy hosting, database and media inventory plus backup/restore proof.
- Hosted renderer access and real email reset delivery.
- Official OAuth, encrypted social token lifecycle, direct-publishing adapters, provider approval and owner-authorised test posts.
- Production security review, durable publishing recovery, metrics and physical Android acceptance.

See the [roadmap](../product/niches-roadmap.md) for feature-level status and the [rollout runbook](../operations/niches-audit-and-rollout.md) for configuration and recovery.
