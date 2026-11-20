# ADR-011: Private Render pilot for permissioned Twitch capture

- Status: Pilot implementation
- Date: 2026-11-20

## Decision

Use one private-operator web service on Render Free. An operator chooses up to
five channels and starts a capture of up to ten minutes for each. Streamlink
shares the Python process with separate HTTP sessions and bounded HLS buffers.
FFmpeg stream-copies audio and video. Each recording has independent chat counts,
audio analysis, highlights and download paths. Up to six recordings can be
retained on temporary disk when sufficient space is available.

The current branded export uses the user's ClipCast logo badge, hook and caption
treatment. Captions come from local English transcription or operator-provided
narration. A blank hook is drafted from portrait-frame object detections
and relevant words when there is enough evidence. Hook suggestions can be
reviewed and edited before export. The original audio stays in place. Character art and speech are
paused. The original clip and branded version are both downloadable.

## Consequences

The recorder serializes transcription, laughter analysis and branding on the
512 MB Free instance. Render can erase local media after a restart, redeploy or
idle shutdown. Chat-to-video timing and automatic captions are approximate.
The operator must have the right to capture and edit the source. No social
credentials or publishing actions are included.

[Deployment instructions](../../ops/streamlink-pilot/README.md)
