# ADR-009 — Instagram multi-format publishing

Date: 2026-11-11
Status: implementation candidate; production deployment gated on provider simulation, CI and private-queue verification.

## Decision

Keep one Niches publishing calendar and brand/account structure, while adding explicit post kinds: Reel, image, carousel and Story. Existing records use `auto`, preserving their current single-media behaviour. Carousels keep an ordered list of existing private media references; no existing media or outbox record is rewritten. New draft edits are refused once publication history exists.

Only Instagram may be chosen for carousel or Story direct delivery in the first release. Single JPEG images and MP4/MOV videos use the existing Instagram container flow. The outbox must create/poll each carousel child, then create/poll the parent, and finally publish with a durable uncertain-submission guard. Instagram fetches short-lived, token-protected media URLs through existing provider grants.

Interactive Story stickers, music catalog licensing, Live, and collaborative-post restrictions are not represented as API-deliverable actions; those remain Instagram-native.

## Safety and rollout

Migrate D1 with a fresh recovery bookmark and snapshot of existing Cartoons scheduled posts/publications; test existing automatic deliveries, partial publishing, retries and recovery before changing the production pin. No new paid storage or infrastructure is required. Keep pre-existing scheduled jobs and credentials untouched.
