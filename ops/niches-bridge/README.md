# Niches operations bridge

Adapted from the inspected AISO operational approach. This directory is independent of AISO and does not import or modify its bridge.

- `check-config.mjs`: fail-closed Worker/database/bucket/account guard.
- `production-audit.sh`: read-only Cloudflare, migration, bucket metadata and exact-build health checks.
- `browser-smoke.mjs`: public/mobile smoke and optional dedicated-account login. Production content writes are prohibited.
- `local-test-server.mjs`: disposable D1/R2 application for local/browser CI only; never accepts production credentials.
- `clipmine-journey.mjs`: generated footage through protected FastAPI, FFmpeg render and direct transfer to a niche. No real customer media or remote state.
- `config.test.mjs`: prevents cross-project deployment targets.

Launchers are `.github/workflows/niches-deploy.yml`, `.github/workflows/niches-production-check.yml` and the `niches` CI job. Deployment remains disabled until the account and distinct resources are confirmed. No AISO credentials are copied or retrieved.

For configuration, deployment, recovery and billing gates, see the [audit and rollout](../../docs/operations/niches-audit-and-rollout.md).
