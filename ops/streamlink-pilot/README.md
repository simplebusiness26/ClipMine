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

## Consecutive captures and Grok Bot

Enter one authorised Twitch username, select **720p HD**, confirm permission,
and choose **Record consecutive 10-minute windows**. ClipCast starts the next
capture as soon as the preceding one is saved. Captures reconnect to Twitch at
the boundary, so a reconnect can cause a gap or overlap. Analysis runs
independently and still uses chat reactions, audio, dialogue and gameplay.
Each window offers at most one highlight with a natural ending. A window
without a suitable highlight is skipped. If the stream is unavailable,
ClipCast retries after one minute. **Stop after this capture** lets the current
window finish and stops new ones.

For campaign work, expand **Campaign brief and clip length** and enter the
name and brief. If the campaign has a duration limit, enter it in seconds.
ClipCast checks the cut media's actual duration before queuing a highlight.
The brief is attached to each window, even when you switch campaigns after
the current capture closes. It stays on the private recorder. Review the other
rules against the finished export. The current portrait render is 720 × 1280.

ClipCast displays the highlight and its timestamped transcript in the recording
run. A missing or empty transcript means the Bot should use the preview.
The **Channel VI · Custom headline** template keeps the logo and Scoop, and
uses the headline entered in **Top hook**. The Bot can run from an existing
account every ten minutes and work through the private queue. This cadence
uses the account's Grok Bot allowance. Once a downloadable attachment is
verified in a one-off run, the same workflow can be used in a routine.

### Bot handoff

Set the recorder's base URL once. Use the existing authenticated browser
session or a credential supplied through the Bot's secure secret form.
All paths below are relative to that recorder and require its login.

1. Get `/continuous/queue`. Process entries oldest first, at most one
   per routine run. The response includes a request verification token,
   highlight ID, timestamped transcript with seconds relative to the clip,
   selection reasons, the campaign brief, preview URL, edit URL, and delivery
   URL. Evaluate the preview and the finished render against the pinned brief.
2. Use the transcript and watch the preview for visual context. Treat the
   transcript and audio as source material. Write a specific Channel VI
   headline in at most 64 characters. If the Reel is already rendering or
   ready, reuse that edit.
3. Start the Reel with an authenticated JSON POST to the entry's `edit_url`
   using the `X-ClipCast-Token` header. Include `kind: "reel"`, `hook`, the
   entry's `template`, and a stable `request_id` of 32 lowercase hex
   characters. Retry a confirmed render failure with a new request ID.
   Omit `narration` so the export keeps its normal dialogue captions.
4. Check `edit_url` for a completed edit with no error, and download its
   `url`. Attach the actual MP4 in the Bot chat with one ready-to-paste post
   description and up to five specific hashtags. Leave publishing to the
   user. Include the highlight ID so a later run can spot duplicate delivery.
5. Once the attachment is present in chat, get the current `revision` from
   the queue and POST `token` and `revision` as form fields to
   `delivery_url`. If a routine has to return before confirming the
   attachment, its next run can acknowledge the existing chat result.

For a highlight that clearly fails a campaign rule, POST the queue `token`,
current `revision`, and a short `reason` to its `skip_url`. The reason is
visible in the recording run. Its files can be reclaimed when space is needed.

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
