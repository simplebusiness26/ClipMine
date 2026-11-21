# Streamlink capture pilot

## Deploy from a phone

1. In Render, tap **+ → Blueprint** and connect the ClipMine GitHub repository.
2. Choose branch `clipcast-streamlink-pilot` and Blueprint Path `ops/streamlink-pilot/render.yaml`.
3. Enter a default Twitch username in `TWITCH_CHANNEL`. Confirm that
   `clipcast-streamlink-pilot` is on the **Free** plan and deploy.
4. Open the service's **Environment** tab for the generated `RECORDER_PASSWORD`.
   Visit the service URL and sign in as `recorder` with that password.

## Record, review and export

1. Enter up to five live Twitch usernames, separated by commas. Pick **720p HD**
   or **Up to 1080p Full HD**, confirm permission, and tap **Record and find clips**.
2. You can close the tab after the run starts. Go back to the recorder and tap
   **Open recording run** to check progress or review the clips. A queued channel
   shows that it is waiting for its turn. **Review available clips** opens the clips
   that are ready so far. ClipCast selects at most ten clips per run.
   Action sounds, gameplay movement, short speech windows, laughter and chat
   can all contribute. Timing follows dialogue and pauses where enough
   evidence is available. Longer exchanges can run past 60 or 90 seconds.
3. Watch the clips, edit **Top hook** or use **Suggest hook first**, and tap
   **Make ClipCast version** when ready. For a run still on the recorder, ClipCast
   renders from its copy. You can leave once it says the Reel is queued. Reopen the
   run for its status and download. Hook text and framing choices save to the
   browser as you edit.
4. The Gameplay First template uses a slim top camera strip when a steady corner
   facecam is detected. The gameplay fills the rest of the frame, with Scoop
   standing at the bottom right and making one brief wink and head tilt.
   Under **Reel template**, choose **It Was Going Well**, **Roll That Back** or
   **Scoop Was There** for a Channel VI design with a fixed headline and Scoop
   artwork. The selected template is saved with the clip draft.
   Under **Captions and framing**, choose the facecam corner manually or turn
   the camera off, reposition the gameplay crop, or type written narration.
5. Download the finished 720 × 1280 Reel. **Save run to this device** copies
   the originals and any finished Reels to **Saved clips** in the current browser.
   The recorder can still use its copy for edits. Keep the page open during the
   optional transfer.

[Render dashboard](https://dashboard.render.com/) · [Render free compute limits](https://render.com/docs/free)

## Consecutive captures and automatic Reels

Enter one authorised Twitch username, select **720p HD**, confirm permission,
and choose **Record consecutive 10-minute windows**. ClipCast starts the next
capture as soon as the preceding one is saved. Captures reconnect to Twitch at
the boundary, so a reconnect can cause a gap or overlap. Analysis runs
independently and still uses chat reactions, audio, dialogue and gameplay.
Each window offers up to three distinct highlights with natural endings by
default. Set `CLIPCAST_HIGHLIGHTS_PER_WINDOW` to a number from 1 to 5 to adjust
the cap. A window without a suitable highlight is skipped. If the stream is unavailable,
ClipCast retries after one minute. **Stop after this capture** lets the current
window finish and stops new ones.

For campaign work, expand **Campaign brief and clip length** and enter the
name and brief. If the campaign has a duration limit, enter it in seconds.
ClipCast checks the cut media's actual duration before queuing a highlight.
The brief is attached to each window, even when you switch campaigns after
the current capture closes. It stays on the private recorder. Review the other
rules against the finished export. The current portrait render is 720 × 1280.

To dedicate an instance to a single campaign, set its `TWITCH_CHANNEL` to one
Twitch username and set `CLIPCAST_CAMPAIGN` in the host's environment. For example:

```json
{"name":"Campaign name","brief":"Campaign requirements","min_seconds":30,"max_seconds":60}
```

The duration bounds are optional. The worker displays the configured brief
read-only and rejects other accounts, other briefs and batch recording. Each
new capture uses the configured brief, including after an app restart. To run
another campaign at the same time, deploy another instance with its own
`TWITCH_CHANNEL`, `CLIPCAST_CAMPAIGN` and password. The lock does not resume a
capture after a host restart.

Optional `required_category` checks the Twitch game category at both ends of
each capture. `preserve_source_frame` fits the whole input picture into each
branded layout, with headlines and captions outside it so source overlays
can survive reframing. Review the actual finished Reel for logo legibility
and verify the content against the brief. Set `require_custom_hook` to require
non-empty headlines for both branded exports.

ClipCast transcribes the highlight and chooses a short on-screen hook from
spoken details. If the transcript offers no useful hook, ClipCast can use
recognised objects or a recorded chat or laughter signal. A campaign that
requires a specific hook skips footage without enough evidence to support one.
Analysis and rendering run locally on the recorder's compute.

ClipCast automatically renders a **Channel VI** and a **GTA ClipCast** Reel
for each selected highlight. Channel VI uses the purple gradient and fitted
headline panel. The GTA ClipCast layout carries Scoop. Both 720 × 1280 outputs
reuse the same source and dialogue captions and are encoded in sequence.

Reopen the recording run to download either finished MP4 or choose
**Download both Reels** for one ZIP. If an encode fails, **Retry render**
uses the existing hook and keeps any successful export. The recorder marks
an export pair as delivered after streaming the whole ZIP or both MP4s.

If processing falls behind and reaches the recorder's storage limit, capture
pauses until there is room. Finished deliveries and windows with no highlights
can be reclaimed when needed. Save source footage separately if you want to keep
it. A recorder restart clears the in-memory session and queue, so start the
session again after a restart. Run the recorder on a host that stays awake for
continuous use. Render Free is suitable for a smoke test while it is awake.

## Storage, privacy and capacity

The archive stores clip files, run details, drafts, and Reel files in the active
browser's IndexedDB. Saved runs can be reopened after a page reload or recorder
restart on that browser. Clearing site data, private browsing or browser storage
eviction can remove that device's copies. Save important finished Reels
separately. **Delete copy on this device** clears that browser's copy.
Capture files on the server are temporary. The recorder reclaims older copies
when a new run needs space, prioritising runs saved to the device with their
latest edits. Render Free can spin down after 15
minutes without incoming traffic, and its temporary files and jobs are lost on
spin-down, restart, or redeploy. A recording or Reel continues with the tab closed
while the recorder stays running. Save important media before it expires.
For a run saved only in the browser, starting a hook or Reel requires sending
that clip to the recorder. Mobile browsers can pause this upload when the page
is closed or hidden. Reopen the clip to resume from the last received part if
the recorder still has it. Once it is queued, processing runs on the recorder.

Five channels can capture in parallel with independent HLS buffers. Footage
analysis, cut creation, hook checks and branded exports are serialised on the
Free instance. Highlight speech analysis samples short windows across each
recording with a 62-second process limit and retains completed windows.
Selected clips still receive the usual transcription during Reel rendering. Each raw source is limited to ten minutes and 500 MiB (720p) or
650 MiB (1080p). An offline channel or size limit can end the capture early.
Twitch chat can lag the broadcast. Action and story cues are best-effort, and
automatic transcript words and facecam framing may need review. ClipCast
starts no social publishing jobs.

## Test

Install `requirements.txt`, `httpx` and `pytest`, plus FFmpeg, FFprobe and the
DejaVu Sans bold and bold oblique fonts. Run `pytest -q`. The packaged models
for transcript, hook subjects, and facecam are included by the Docker build.
For local runs set `CLIPCAST_TRANSCRIPT_MODEL`, `CLIPCAST_OBJECT_MODEL`, and
`CLIPCAST_FACE_MODEL` to the corresponding model files.
