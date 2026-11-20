# ADR-011: Private Render pilot for permissioned Twitch capture

- Status: Pilot implementation
- Date: 2026-11-20

## Decision

Use a separate private-operator web service on Render's Free plan to verify
one permissioned Twitch capture from a phone. The operator sets one channel
in deployment configuration and explicitly starts each job. Capture is
bounded to ten minutes and one temporary MP4 at a time.

The result enters ClipMine via its existing MP4 upload boundary.
The pilot owns no Niches or social credentials. Render uses disposable disk
space and the operator downloads or removes the media via an authenticated page.

## Consequences

A Render restart or idle shutdown can erase the current capture. Cloudflare
triggers and signal ranking require further development and are evaluated only
after the pilot is verified with permissioned live video. Existing ClipMine rights,
media privacy and publishing approval requirements apply.

[Deployment instructions](../../ops/streamlink-pilot/README.md)
