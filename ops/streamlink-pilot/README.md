# Streamlink capture pilot

## Deploy from a phone

1. In the Render dashboard, tap **+ → Blueprint** and connect the ClipMine GitHub repository.
2. Choose branch `clipcast-streamlink-pilot` and Blueprint Path `ops/streamlink-pilot/render.yaml`.
3. Enter one Twitch username you have permission to capture as `TWITCH_CHANNEL`.
   Use the channel name without a URL or `@`. Confirm the only new service is
   `clipcast-streamlink-pilot` on the **Free** plan, then deploy.
4. Open the service and copy the generated `RECORDER_PASSWORD` from its **Environment** tab.
   Open its `onrender.com` URL in your phone's browser and sign in as `recorder` with that password.
5. While the channel is live, confirm permission and tap **Record and find clips**.
   Keep the page open while the recorder captures up to ten minutes and checks for highlights.
6. Under **Best bits**, tap **Download clip** for each clip you want. The finished
   clips are MP4 files at the captured orientation, ready for your edit or template.
   **Original recording** is available if you want the source file.

[Render dashboard](https://dashboard.render.com/) · [Render free compute limits](https://render.com/docs/free)

## What the recorder uses

The recorder reads the channel's public Twitch chat while Streamlink captures video.
It counts messages and laugh reactions in short buckets and estimates their times
against FFmpeg's media clock. A local YAMNet model looks for audible laughter
after the capture. The recorder ranks matching signals and cuts up to three
non-overlapping clips of about 35 seconds. It labels why it picked them and
can return no clips when a recording has no strong highlight signals. It
stores only chat counts, never chat text or user names.

## Pilot limits

Each run begins with a browser tap. An offline channel or file size limit may
end a capture early. If chat is unreachable or audio analysis fails, the page
shows the affected signal and uses the available signal to make clips. Twitch
chat and video delivery can have different latencies, so check the cut before use.

Render can clear media after inactivity, restart, or redeployment. Download
the clips you want before tapping **Clear and record again**. Download any
existing capture before deploying an update. Capture downloads remain private
to the recorder login.

## Run tests

Install the packages in `requirements.txt`, plus `httpx` and `pytest`, with the
`ffmpeg` and `ffprobe` executables on the path. From this directory run `pytest -q`.
The media test generates its own HLS sample and runs Streamlink and FFmpeg end to end on loopback.
