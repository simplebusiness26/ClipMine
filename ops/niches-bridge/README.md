# Niches operations bridge

Adapted from the inspected AISO operational approach. This directory is independent of AISO and does not import or modify its bridge.

- `check-config.mjs`: fail-closed Worker/database/bucket/account guard.
- `production-audit.sh`: read-only Cloudflare, migration, bucket metadata and exact-build health checks.
- `browser-smoke.mjs`: public/mobile smoke and optional dedicated-account login. Production content writes are prohibited.
- `local-test-server.mjs`: disposable D1/R2 application for local/browser CI only; never accepts production credentials.
- `clipmine-journey.mjs`: generated footage through protected FastAPI, FFmpeg render and direct transfer to a niche. No real customer media or remote state.
- `config.test.mjs`: prevents cross-project deployment targets.

The live deployment route is in `simplebusiness26/agentCart`, branch `ops/niches-cloudflare`: `.github/workflows/niches-access-check.yml` runs read-only checks and `.github/workflows/niches-portal-deploy.yml` deploys an immutable ClipMine source revision to the separate Niches Worker/database using the authorised AISO account credentials inside Actions. No credential values are copied or retrieved. The original AISO bridge remains read-only and unchanged.

Use this route by default. The owner has reported that Cloudflare browser login does not work; do not make it a prerequisite for routine deployment, inventory, secret-name checks or live testing. R2 entitlement and provider credentials must be checked through the existing runner. Account entitlement is separate from token authentication; no bridge can be assumed to bypass it or authorise new charges.

The ClipMine-repository `.github/workflows/niches-deploy.yml` and `.github/workflows/niches-production-check.yml` remain a separate project-credential path; its deploy switch remains disabled. The `niches` CI job runs disposable local tests.

For configuration, deployment, recovery and billing gates, see the [audit and rollout](../../docs/operations/niches-audit-and-rollout.md).
