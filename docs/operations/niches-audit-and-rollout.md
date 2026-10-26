# Niches audit and rollout

Audit date: 2026-10-26. The follow-up below supersedes the initial access/deployment blockers; the initial audit remains as historical evidence.

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

## Initial audit evidence

| Source | Finding |
| --- | --- |
| ClipMine main at `7af64f2` | React/Vite client; FastAPI, FFmpeg, optional local Whisper; JSON or PostgreSQL state; local media volume |
| ClipMine workflows | CI, Android build and Ghost Writer reports; no Cloudflare deployment configuration in the audited baseline |
| AISO `wrangler.toml` | Worker `agentcart`, database `aiseo`, database ID `2d15e48a-cd08-4910-9710-fcf4dac74e0d`; public URL `https://agentcart.ai-seo.workers.dev` |
| AISO `.github/workflows/deploy-cloudflare.yml` | Repository Cloudflare token/account secrets; migration recovery bookmark; tests; Wrangler deploy |
| AISO `.github/workflows/aiso-production-check.yml` | Separate read-only audit and Playwright mobile/authenticated smoke |
| AISO `ops/aiso-bridge/` | Read-only Cloudflare inventory, health, required secret names and browser checks; no deployment authority in the bridge itself |
| Local `wrangler whoami` | Not authenticated; no reusable Cloudflare credential in this session |
| Connected tools | GitHub reads work; branch creation returned HTTP 403 Resource not accessible by integration. Terminal push has no credentials. Cloudflare plugin search returned no matching plugin |

The actual AISO account ID is **unconfirmed**. Its workers.dev subdomain is known; that is not account identity proof. No AISO secret values were retrieved. Private AISO source was read through the connected GitHub application; direct Git clone could not authenticate. No AISO files or resources were changed.

## Architecture and isolation

| Component | Niches target | Current verification |
| --- | --- | --- |
| Frontend/API | `niches` Worker with static assets | Built and tested locally |
| Database | Separate D1 `niches` | Migration tested against local D1 emulator |
| Private media | R2 `niches-media` | Local R2 upload/read/isolation tests |
| Sessions | Niches HttpOnly cookie and hashed tokens | Two-user API tests |
| Rendering | Existing Python/FFmpeg service behind gateway key | Local media journey; see current test result |
| Scheduling | Separate Niches cron; bounded export reminders | Idempotent local tests |
| Social publishing | Official provider adapters | Not implemented or authorised |
| Domains | Dedicated `niches.<confirmed-account>.workers.dev` | Not provisioned |

No queues, Containers, paid AI, public bucket or shared AISO database is provisioned. AISO worker, database, cron and logs remain separate. Deployment guards reject known AISO resources and mismatched account identities.

## Deployment prerequisites

The owner or an authorised Cloudflare session must confirm the AISO account, inventory existing ClipMine hosting/data, and provision dedicated Niches resources within that account. Do not retrieve AISO Actions secrets or assume repo credentials are shared.

Configure in the ClipMine repository, preferably in its `niches-production` environment:

| Name | Kind | Meaning |
| --- | --- | --- |
| `NICHES_CLOUDFLARE_API_TOKEN` | Secret | Separate authorised token for Niches; minimum available Worker/D1/R2 permissions in the confirmed account |
| `NICHES_CLOUDFLARE_ACCOUNT_ID` | Secret | Deployment account ID |
| `NICHES_EXPECTED_ACCOUNT_ID` | Variable | Independently confirmed AISO account ID used as an equality pin |
| `NICHES_D1_DATABASE_ID` | Variable | New Niches D1 ID; never the AISO ID |
| `NICHES_URL` | Variable | Dedicated Niches workers.dev origin |
| `NICHES_DEPLOY_ENABLED` | Repository variable | Set `true` only after resource/billing and account verification; needed before the environment job can start |
| `NICHES_TEST_EMAIL`, `NICHES_TEST_PASSWORD` | Secrets | Dedicated Niches smoke account; never AISO test credentials |

The production audit workflow also needs the variables/secrets at repository scope or its job assigned the same environment. For least privilege, use environment-scoped values and assign both workflows to `niches-production`.

Application configuration on the Niches Worker:

- `CLIPMINE_ORIGIN`: trusted HTTPS renderer origin.
- `CLIPMINE_GATEWAY_KEY`: new secret; match renderer `NICHES_GATEWAY_KEY`. Never reuse AISO credentials.
- `RESET_EMAIL_ENDPOINT` and `RESET_EMAIL_KEY`: HTTPS email delivery adapter; receives `{to, template, reset_url}`. This contract requires an actual email service implementation and delivery verification.
- `APP_URL`: dedicated Niches origin, set during deployment.

The deployment workflow is opt-in. Once enabled it tests, builds, validates isolation, records a Niches D1 recovery bookmark, migrates only Niches and deploys only its Worker. Recovery-bookmark failure stops migration. No resource-creation or billing command is automated.

The read-only production workflow does not migrate, upload, publish or delete. Optional login creates a dedicated test session; it does not modify content. Missing credentials are logged as a skip, never as an authenticated pass. Local full-journey write tests explicitly refuse non-local origins.

## Existing deployment and migration

No existing hosted ClipMine URL, production database connection or media storage credentials were present in the audited source. Remote state is **not inventoried**. No database or media was copied, deleted or migrated.

Before migration:

1. Identify the old host, application version, JSON/PostgreSQL mode and actual media volume.
2. Stop new writes briefly or take a consistent snapshot while retaining the original service.
3. Back up `data/state/projects.json` when JSON is used. For PostgreSQL, take an encrypted `pg_dump` of the `clipmine` schema. Preserve the full media volume, including sources, exports, models and relative paths.
4. Store backups outside the running host and repository. Record encrypted backup location, checksum, timestamp and restore operator; never attach production exports to public Actions artifacts.
5. Assign legacy projects to an explicitly verified owner. Never expose all old single-operator projects to every Niches user. Automatic legacy-owner mapping is intentionally not implemented.
6. Restore a copy into an isolated renderer and reconcile project IDs, source/export counts and checksums.
7. Verify account isolation, login/recovery, original sources, downloads and real approved social tests before switching traffic.

Keep the former deployment and backups until all acceptance gates pass. No production traffic switch is included in the current changes.

## Rollback and recovery

- Worker: redeploy the previously verified Niches commit or use its recorded Worker version. Never roll back AISO for a Niches failure.
- Database: record the pre-migration Niches Time Travel bookmark. Recovery changes require a separate operator decision and a tested retention window; a bookmark is not an independent backup.
- Media: keep existing renderer files and private R2 originals. R2 is not automatically versioned or backed up by this implementation. Build and test a separate encrypted backup/restore procedure before launch.
- Old service: restore its prior route only after confirming data written since cutover will not be lost. Do not delete replacement resources to roll back.

## Costs and limits

No paid products or plan upgrades have been enabled. The partial Workers/D1 portal is now deployed. Actual account billing/usage has not been independently inspected, so no guaranteed monthly bill is claimed.

A small portal may fit Workers/D1 free allowances, but this is conditional on account usage, R2 eligibility and actual load. Workers Free has 10 ms CPU/request and 100,000 requests/day. Password hashing and authenticated workloads require a production benchmark; do not weaken password hashing to force a free-tier launch. Application uploads are capped at 25 MB each and nominally 250 MB/100 assets per user. Concurrent quota reservations, account creation abuse and resumable uploads remain launch work.

Cloudflare Containers require the Workers Paid plan (starting at US$5/month) plus usage. They are not enabled. There is no promised free always-on FFmpeg/Whisper hosting. An existing private machine can run the original Docker service while available; its uptime, tunnel, security and electricity costs still need assessment. Without authorised compute, the cloud studio stays unavailable while library/drafts work.

Official references checked on the audit date:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Containers availability](https://developers.cloudflare.com/containers/)
- [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
- [YouTube upload API](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)
- [TikTok publishing prerequisites](https://developers.tiktok.com/doc/content-posting-api-get-started/)
- [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)

## Real verification and remaining gates

See the [Niches roadmap](../product/niches-roadmap.md), CI run and pull request for exact current results. Provider app registration, OAuth callback/domain verification, permissions, review, account-owner consent and actual authorised test posts remain external gates. The OAuth/publisher code itself is also still roadmap work; this is not solely an approval wait.
