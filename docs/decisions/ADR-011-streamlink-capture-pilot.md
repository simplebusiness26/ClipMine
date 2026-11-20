# ADR-011: Private Render pilot for permissioned Twitch capture

- Status: Pilot implementation
- Date: 2026-11-20

## Decision

Use a private-operator web service on Render Free. The operator sets a default
Twitch handle in deployment configuration and explicitly starts captures from
the page. A run per channel is bounded to ten minutes and up to 1080p. The
recorder permits two simultaneous source captures and up to three retained
recordings. Each capture has separate chat counts, findings and download paths.

The recorder counts activity and laugh reactions in read-only public Twitch
chat, and scores audible laughter locally. FFmpeg cuts the highest ranked
moments as private short MP4s. The operator may also render any selected clip
with the standing Scoop template. The approved voice is prepared as short
tracks for the bundled scripts, keeping inference memory and service costs
within the free deployment constraints. The recorder serializes audio analysis
and branded encoding and shows when either is waiting or working.

## Consequences

Render uses disposable disk space. A restart, redeploy or idle shutdown can
erase the current captures. Chat-to-video timing is approximate. An operator
must already hold the rights to record and edit the stream. Original
highlights and portrait renders are available through the recorder login.
The service owns no Niches or social credentials.

[Deployment instructions](../../ops/streamlink-pilot/README.md)
