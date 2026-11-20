# Streamlink capture pilot

## Deploy from a phone

1. In the Render dashboard, tap **+ → Blueprint** and connect the ClipMine GitHub repository.
2. Choose branch `clipcast-streamlink-pilot` and Blueprint Path `ops/streamlink-pilot/render.yaml`.
3. Enter one Twitch username you have permission to capture as `TWITCH_CHANNEL`.
   Use the channel name without a URL or `@`. Confirm the only new service is
   `clipcast-streamlink-pilot` on the **Free** plan, then deploy.
4. Open the service and copy the generated `RECORDER_PASSWORD` from its **Environment** tab.
   Open its `onrender.com` URL in your phone's browser and sign in as `recorder` with that password.
5. While the channel is live, confirm permission and tap **Record up to 10 minutes**.
   When ready, tap **Download MP4** and import the file into ClipMine. Delete the capture after download.

[Render dashboard](https://dashboard.render.com/) · [Render free compute limits](https://render.com/docs/free)

## Pilot limits

Each run starts with an explicit browser action. Render uses temporary storage and can sleep
after idle periods or restart. Download the recording promptly. A stream that goes offline
or a storage limit can end a capture early. The UI reports a short capture when it has a
playable MP4, or an error if it has none. Keep the generated password private.

Live alerts, Twitch chat and laughter ranking are future milestones. The pilot
hands off through the existing ClipMine MP4 upload path.

## Run tests

Install the packages in `requirements.txt`, plus `httpx` and `pytest`, with the
`ffmpeg` and `ffprobe` executables on the path. From this directory run `pytest -q`.
The media test generates its own HLS sample and runs Streamlink and FFmpeg end to end on loopback.
