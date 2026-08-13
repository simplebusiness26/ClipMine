# ClipMine Project Context

Last updated: 2026-08-13

## Current state

- Repository created.
- Product and engineering documentation baseline created.
- No application scaffold, infrastructure or production account setup exists yet.
- No technology vendor has been irreversibly selected.

## Confirmed product direction

ClipMine is a mobile-first service for turning long-form, creator-owned video into multiple short-form video drafts. The system analyses speech and visuals, proposes the strongest self-contained moments, renders vertical captioned clips, and gives the creator final editorial control.

## Confirmed MVP boundary

Included:

- Account and private workspace
- Resumable original-file upload
- Transcript and processing progress
- AI-generated clip candidates
- Vertical auto-reframing
- Editable captions and basic trim/crop controls
- Rendered MP4 downloads
- Job recovery, deletion and basic usage limits

Excluded from initial MVP:

- Downloading arbitrary YouTube URLs
- Fully automatic public posting
- Native iOS/Android applications
- Full timeline editor
- Generative avatars, voice cloning or synthetic presenters
- Team approvals, agencies and advanced analytics

## Product decisions

1. Build a responsive web application/PWA first.
2. Accept original media uploads first for reliability and rights compliance.
3. Require human approval before publishing.
4. Keep speech-to-text, language-model and social-platform integrations behind adapters.
5. Export first; add approved platform publishing incrementally.
6. Never promise virality. Optimise for usefulness, completeness and editability.

## Open decisions

- Final brand and trademark clearance
- Exact infrastructure vendors and launch budget
- Free allowance and paid-plan limits
- Maximum upload duration and file size after cost testing
- Initial transcription and language-model providers
- Whether first beta targets podcasters, educators, business creators or a narrower group

## Immediate next milestone

Build a thin technical proof:

`upload -> transcript -> candidate timestamps -> one rendered 9:16 clip`

The proof is successful when a real user can upload a permitted video, receive at least three sensible candidate moments, render one playable clip and delete the project.

## Instructions for future agents

Before changing scope or code:

1. Read this file, the PRD and relevant architecture decision records.
2. Inspect the actual repository and report the current branch and working tree.
3. Treat unconfirmed choices as assumptions, not requirements.
4. Keep the first vertical slice small and test it with real footage.
5. Update this file when the confirmed state changes.

