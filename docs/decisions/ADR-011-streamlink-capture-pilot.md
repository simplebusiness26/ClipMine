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

Capture progress polls a small manifest until the batch is complete. Preview
media is transferred to IndexedDB before committing the run and opening its
stable review URL. The review page has no automatic reload. Drafts and
finished Reels are stored beside the source clips. The recorder frees
temporary capture files after save acknowledgement. The review page re-uploads
only the clip the operator has chosen for a hook check or Reel.

Use the Gameplay First layout with manual facecam overrides and a small
animated Scoop gesture. Keep the source audio. Add no publishing credentials.

## Consequences

Saved runs survive a recorder restart in the same browser, subject to browser
storage limits and site-data settings. Capture and analysis still need a
healthy recorder until archiving finishes. Analysis and rendering are
serialised for the free instance. Face detection, dialogue timing and
highlight ranking are heuristic. The operator needs permission to capture and
edit each source.

[Deployment instructions](../../ops/streamlink-pilot/README.md)
