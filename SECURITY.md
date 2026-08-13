# Security Policy

ClipMine processes private, potentially unpublished video. Security, content rights and complete deletion are product-critical.

## Current private-MVP warning

Version `0.1.0` is a single-trusted-operator proof. It does **not** include authentication, workspace isolation, rate limiting or public object storage. Run it only on a trusted machine or private network. Do not expose port 8000 to the public internet.

PostgreSQL does not change this boundary. It makes project metadata durable; it does not add user authentication.

## Reporting a vulnerability

Do not post sensitive vulnerability details in a public issue. Use GitHub's private security-advisory feature for this repository. Add a dedicated monitored security contact before public beta.

## Sensitive data rules

- Never commit `.env`, database URLs, API keys, OAuth tokens or private media.
- Never paste credentials into issues, logs, test output or screenshots.
- Keep `CLIPMINE_DATA_DIR` on a private persistent volume.
- Treat source filenames, media metadata and transcripts as untrusted input.
- Use only original files the operator owns or is authorised to process.
- Delete test projects after verification when their media should not be retained.

## Implemented controls

- Generated project/candidate IDs and safe server filenames
- Streaming upload byte limit and accepted-extension check
- FFprobe stream/duration validation
- Parameterised Asyncpg queries
- Private PostgreSQL schema with public access revoked
- Atomic JSON state writes
- Candidate ownership check within the requested project
- Project-bound source/export paths
- No transcript body or database URL in normal application logs
- Project state and media directory deletion
- Git ignores for secrets, media, state and outputs
- Non-root Docker runtime user
- CI lint, type, unit and synthetic-media integration checks

These controls reduce private-prototype risk but do not make an unauthenticated service safe for public access.

## Required before public beta

- Managed authentication and server-verified sessions
- Workspace ownership on every project, job, asset and candidate query
- Private object storage with short-lived, purpose-specific signed access
- Content-based upload validation, malware/media sandboxing and resource limits
- CSRF/security headers plus strict production CORS
- Per-user upload, processing and request rate limits
- Durable job queue with idempotency and bounded retry
- Structured, redacted logs and security monitoring
- Retention/deletion reconciliation and backup policy
- Cross-tenant, guessed-ID and abuse/security tests
- Rights complaint, takedown and incident processes

See [privacy, security and content rights](docs/security/privacy-security-rights.md) for the full launch baseline.
