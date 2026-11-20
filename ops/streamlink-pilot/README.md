# Streamlink capture pilot

## Deploy from a phone

1. In Render, tap **+ → Blueprint** and connect the ClipMine GitHub repository.
2. Choose branch `clipcast-streamlink-pilot` and Blueprint Path `ops/streamlink-pilot/render.yaml`.
3. Enter a default Twitch username in `TWITCH_CHANNEL`. Confirm the service
   `clipcast-streamlink-pilot` is on the **Free** plan and deploy.
4. Open the service's **Environment** tab for the generated `RECORDER_PASSWORD`.
   Visit the service URL and sign in as `recorder` with that password.

## Record and export

1. Enter up to five live Twitch usernames in **Twitch channels**, separated by
   commas. Select **720p HD** or **Up to 1080p Full HD**, confirm permission,
   then tap **Record and find clips**.
2. Each streamer has a separate ten-minute capture and up to three highlights
   of about 35 seconds. **Download highlight** saves the original cut with its
   source framing, picture quality and sound.
3. Tap **Make ClipCast version** beside a highlight. The Reel is a 720 × 1280 MP4
   with full-screen gameplay, the reference GTA 6 ClipCast badge, the opening
   hook banner and cream caption boxes. The original audio plays at its source
   speed. Character art and voice are paused in the current export.
4. Leave **Top hook** blank to generate a title from sampled video frames and
   relevant dialogue or written narration. Use **Suggest hook first** to review
   and edit it before exporting. The local detector recognizes common subjects
   such as bikes, cars and boats. If it finds too little evidence, the Reel
   has no automatic hook. You can enter one in **Hook, written narration and framing**.
5. Leave written narration blank to transcribe the clip's English dialogue
   into timed captions. Enter a short line or two to use your own narration.
   This panel also controls the portrait crop.
6. Download the finished **ClipCast Reel**. Save any files you want before
   clearing a recording. Results require the recorder login.

[Render dashboard](https://dashboard.render.com/) · [Render free compute limits](https://render.com/docs/free)

## Pilot limits

Starts are manual. Five channels can capture at once, with six recordings
retained at a time when temporary storage has room. Streamlink shares the web
process but gives each channel its own HTTP session and HLS buffer. Rendering,
transcription and highlight analysis run one job at a time on the Free instance.
Per-capture limits are 500 MiB for the 720p preset and 650 MiB for the 1080p
preset. An offline channel or a size limit may end a capture early.

Public Twitch chat counts and local audio analysis inform highlight selection.
Chat can lag the video. If a capture has no strong signals it may have no
highlights. The portrait export uses local Whisper English speech recognition.
It can miss or mishear dialogue. Media remains on temporary disk and can be
cleared after inactivity, restart or redeploy. The recorder starts no social
publishing jobs.

## Test

Install `requirements.txt`, `httpx` and `pytest`, plus FFmpeg, FFprobe and the
DejaVu Sans bold and bold oblique fonts. Run `pytest -q`. The packaged model
for local transcription is `ggml-tiny.en-q5_1.bin`. Set
`CLIPCAST_TRANSCRIPT_MODEL` to its path when working outside the Docker image.
The vision model is EfficientDet-Lite0. Set `CLIPCAST_OBJECT_MODEL` to its
local `.tflite` path when running outside the image.
