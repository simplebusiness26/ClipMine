# ADR-003: Vendor Integrations Behind Adapters

- Status: Accepted
- Date: 2026-08-13

## Context

Transcription, language models, storage and social APIs change capabilities, prices and policies. Provider-specific payloads spread quickly if used directly throughout business logic.

## Decision

Use explicit internal interfaces for transcription, language analysis, storage and each publisher. Convert provider responses into versioned internal schemas at the boundary and record provider/model provenance.

## Consequences

- Slightly more initial interface work
- Easier testing, fallback, cost comparison and migration
- Provider-specific features require explicit capability exposure
- Business logic and historical results remain understandable after provider changes

## Reversal trigger

None expected. A single adapter may be the only implementation initially; the boundary remains.

