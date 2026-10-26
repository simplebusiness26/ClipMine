# ADR-007: Niches portal and protected ClipMine rendering boundary

- Status: Accepted for implementation; production deployment blocked on access
- Date: 2026-10-26

## Context

The owner explicitly expanded ClipMine into Niches inside the existing repository. The private ClipMine pipeline is useful and tested, but its filesystem, Python and FFmpeg subprocesses do not run in a JavaScript Worker. AISO already uses Cloudflare deployment and separate read-only audit workflows. Its credentials are repository-scoped, not available to this execution environment.

## Decision

Use a dedicated `niches` Worker to serve the React portal and authenticated API, a distinct `niches` D1 database, and private `niches-media` R2 objects. Store session/reset token hashes, user-scoped niche relationships and immutable approval state in D1. No AISO resource identifiers are permitted in deployment configuration. Pin the independently confirmed Cloudflare account before enabling deployments.

Preserve the existing Python engine as a separately hosted private renderer. The edge gateway holds its project-to-niche ownership map and forwards only allowlisted routes. A shared gateway secret protects the renderer whenever it is hosted. Completed exports transfer server-to-server into R2 after ownership validation. Legacy local ClipMine Docker and Android builds use `VITE_APP_MODE=clipmine` and remain private single-operator tools.

Start with draft/export and scheduled export reminders. Do not mark a post as published, an account connected, or analytics populated without provider evidence. OAuth, encrypted token lifecycle and direct publishing adapters require a subsequent implementation and provider authorisation. A schema column is not an integration.

## Consequences

- No changes to AISO production code, resources, workflows or secrets.
- No Cloudflare account is guessed from a workers.dev subdomain.
- Production deployment is gated until scoped credentials and dedicated resources exist.
- Rendering needs available private compute. Containers are a paid option and remain disabled.
- The cron processes a bounded D1 outbox of export reminders; no paid queue is provisioned.
- The current API is a beta foundation, not a public-launch security certification.
- Public launch still needs password-cost review, verified reset email delivery, malware/quota hardening, retention/deletion and recovery proof.

## Superseded scope

The owner's 2026-10-26 brief supersedes the private-only product scope in the original PRD. Original upload rights, human approval and private media invariants remain in force. The legacy single-operator pipeline stays available only behind its documented private boundary.
