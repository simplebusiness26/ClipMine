# Security Policy

ClipMine will process private, potentially unpublished video. Security and deletion behaviour are therefore product-critical.

## Reporting a vulnerability

Do not post sensitive vulnerability details in a public issue. Use GitHub's private security-advisory feature for this repository. A dedicated security contact can be added before public beta.

## Sensitive data rules

- Never commit API keys, OAuth tokens, service credentials or private media.
- Use short-lived signed URLs for direct upload and download.
- Encrypt media in transit and at rest.
- Keep OAuth tokens server-side, encrypted and revocable.
- Redact transcripts, media URLs and credentials from logs.
- Enforce workspace ownership on every media and project query.

See [privacy, security and content rights](docs/security/privacy-security-rights.md) for the full baseline.

