# ClipMine

ClipMine turns creator-owned long-form video into a set of polished, vertical short-form clips. It finds self-contained moments, reframes the active speaker, adds editable captions, and lets the creator approve every result before export or publishing.

> Status: documentation baseline. No production application code exists yet.

## Product promise

**Upload once. Find the gold. Publish everywhere.**

ClipMine is not intended to be a blind video chopper or a promise of virality. Its job is to reduce the manual work between a long recording and several credible short-form drafts while keeping the creator in control.

## MVP

The first usable version will:

1. Accept an original video file that the user owns or is authorised to process.
2. Transcribe it with word-level timestamps.
3. Identify and rank complete, high-value moments.
4. Generate several vertical 9:16 drafts with speaker-aware framing and captions.
5. Let the user preview, trim, recrop and correct captions.
6. Export standard MP4 files ready for short-form platforms.

Direct social publishing is a later capability because each platform requires separate OAuth permissions, product review and platform-aware validation.

## Documentation

Start with the [documentation index](docs/README.md). The main sources of truth are:

- [Product requirements](docs/product/prd.md)
- [Technical specification](docs/technical/technical-spec.md)
- [AI clipping pipeline](docs/technical/ai-pipeline.md)
- [Design specification](docs/design/design-spec.md)
- [Privacy, security and content rights](docs/security/privacy-security-rights.md)
- [Market validation](docs/product/market-validation.md)
- [Business model and launch](docs/product/business-model-and-launch.md)
- [Delivery roadmap](docs/product/roadmap.md)
- [Sprint plan](docs/project/sprint-plan.md)

## Working principles

- Original uploads first; arbitrary YouTube downloading is out of scope.
- Human approval before any public post.
- AI suggestions are explainable, editable and reversible.
- Platform limits are configuration, not hard-coded assumptions.
- Raw media is private by default and deleted according to a visible retention policy.
- The architecture remains vendor-portable where AI and social APIs are involved.

## Name status

ClipMine is the working product name. Domain, app-store, social-handle and trademark clearance have not yet been completed.

## Repository status

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the latest confirmed state, decisions, blockers and next action.
