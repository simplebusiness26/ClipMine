# Streamlink capture pilot

## Deploy from a phone

1. In Render, tap **+ → Blueprint** and connect the ClipMine GitHub repository.
2. Choose branch `clipcast-streamlink-pilot` and Blueprint Path `ops/streamlink-pilot/render.yaml`.
3. Enter a default Twitch username in `TWITCH_CHANNEL`. Confirm the service
   `clipcast-streamlink-pilot` is on the **Free** plan and deploy.
4. Open the service's **Environment** tab for the generated `RECORDER_PASSWORD`.
   Visit the service URL and sign in as `recorder` with that password.

## Record and export

1. Enter up to two live Twitch usernames in **Twitch channels**. Separate two names
   with a comma. Select **720p HD** or **Up to 1080p Full HD**, confirm permission,
   then tap **Record and find clips**.
2. Each channel gets its own ten-minute capture and up to three highlights of about
   35 seconds. Keep the page open to see the results. **Download highlight** saves
   the original cut in its source orientation and resolution.
3. Tap **Make Scoop version** on a highlight to add the standing Scoop template.
   Wait for **Download Scoop MP4**. The export is a 720 × 1280, 30 fps H.264/AAC
   video with full-screen gameplay, ClipCast branding and Scoop at the lower right.
   The opening hook and closing punchline bracket the original scene and dialogue.
4. **Scoop lines and framing** lets you choose one of three voiced scripts or adjust
   the portrait crop. The default script comes from the clip's detected signal.
   **Redo Scoop version** replaces the branded export when the new one is ready.
5. **Original recording** opens the full capture. Save any clips you want before
   clearing a recording. Downloads require the recorder login.

[Render dashboard](https://dashboard.render.com/) · [Render free compute limits](https://render.com/docs/free)

## Pilot limits

Each start is manual. Two channels can capture at once, with three recordings
retained at a time. An offline channel or a file size limit may end a capture
early. The 720p and 1080p source presets are capped at 500 MiB and 650 MiB
respectively. The results show the actual source resolution Twitch supplied.
Original captures and highlight cuts copy their video and audio into MP4 unchanged.

The recorder keeps anonymous counts of public Twitch chat activity and checks the
recorded audio with a local YAMNet model for laughter. Chat delivery is not
perfectly aligned with the video. The results indicate the signals that matched
or were unavailable. A capture may have zero highlights. Capture downloads and
branded renders live on temporary disk. Render can clear them after inactivity,
restart or redeploy. The page starts no social publishing jobs.

## Update the Scoop template

The compositor uses the flattened brand and right-facing standing poses from the
full-body Scoop commentary template. Its runtime assets live in `scoop/assets`.
`scoop/render.py` sets the layout, crop and three presets. The first preset starts
from the detected highlight signal. These are voiced presets, with no
transcription or scene-specific script generation. Rebuild the voice assets with
`python -m scoop.build_voice <local-model-folder>` after changing the lines.
The authoring script uses `kokoro-onnx==0.4.9` and the local Kokoro v1.0 model
and voice pack. The live service only renders the bundled short tracks.
Change the existing flattened runtime visuals when updating the source template.
Heavy rendering and audio analysis run one at a time on the Free instance.

## Test

Install the packages in `requirements.txt`, plus `httpx` and `pytest`, with
`ffmpeg` and `ffprobe` on the path. From this directory run `pytest -q`.
