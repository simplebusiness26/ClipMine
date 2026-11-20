# ADR-011: Private Render pilot for permissioned Twitch capture

- Status: Pilot implementation
- Date: 2026-11-20

## Decision

Use a separate private-operator web service on Render's Free plan to verify
one permissioned Twitch capture from a phone. The operator sets one channel
in deployment configuration and explicitly starts each job. Capture is
bounded to ten minutes and one temporary MP4 at a time.

The recorder counts messages and laughter reactions in read-only public Twitch
chat, and scores audible laughter with a local model. FFmpeg cuts the highest
ranked moments as private short MP4s. The operator downloads clips or original
media from the recorder page. The recorder owns no Niches or social credentials.
Render uses disposable disk space.

## Consequences

A Render restart, redeploy or idle shutdown can erase the current capture.
Chat-to-video timing is estimated and should be confirmed in the exported
clips. Starts are manual. The operator must already have the rights to
record. The recorder does not post to connected platforms.

[Deployment instructions](../../ops/streamlink-pilot/README.md)
