# ADR-011: Private Render pilot for permissioned Twitch capture

- Status: Pilot implementation
- Date: 2026-11-21

## Decision

Use a private-operator web service on Render Free. The operator chooses up to
five Twitch channels and starts a capture of up to ten minutes on each.
Streamlink shares one process with separate HTTP sessions and HLS buffers.
FFmpeg stream-copies the source. Each channel gets independent timing and
signals. Rank action, story, chat and laughter leads together and cut a
maximum of ten highlights per run. Use transcript timing to move endings
to a natural break where possible. Select as many clips as the evidence earns.

Capture progress polls a manifest that lists playable clips as each channel is
checked. Allocate an early share of slots to each channel, then fill remaining
slots from the strongest remaining candidates. The review page reads clips and
queues edits directly on the recorder. Closing the page has no effect on the job
while the service is running. An explicit save copies clips and finished Reels to
IndexedDB. The recorder keeps its copy for editing and reclaims runs saved to
the device when a new run needs space, provided the archive includes the latest
edits. Browser-only entries upload the selected clip on request. The upload ID
is stored with the device copy so reopening the clip can resume an interrupted
upload while the recorder retains its parts.

Use the Gameplay First layout with manual facecam overrides and a small
animated Scoop gesture. Keep the source audio. Add no publishing credentials.

## Consequences

Saved runs survive a recorder restart in the same browser, subject to browser
storage limits and site-data settings. Before that save, an idle spin-down,
restart or redeploy loses the recorder's jobs and files. Analysis and rendering are
serialised for the free instance. Recording speech scans have a wall-clock
budget and keep completed windows if a scan runs out of time. Face
detection, dialogue timing and highlight ranking are heuristic. The operator needs permission to capture and
edit each source.

## Continuous capture and private Reel delivery

An opt-in single-channel session records consecutive windows independently
from the existing serialized analysis and rendering. Keep one candidate per
window and expose its transcript through the recorder's authenticated queue.
Grok Bot can supply the Channel VI headline through the existing Reel edit
endpoint and acknowledge delivery once the chat attachment is available.
Each window retains the campaign brief selected at capture time. The recorder
checks measurable duration limits, while the Bot reviews context and the
finished output against the remaining campaign requirements.
Maintain the recorder's existing storage bound and preserve pending Reels
under backpressure. Continuous sessions and pending windows share the pilot's
in-memory lifetime. A host must remain awake to run continuously.

[Deployment instructions](../../ops/streamlink-pilot/README.md)
