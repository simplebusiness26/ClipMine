import json
import subprocess
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from clipcast_template import render


@pytest.mark.parametrize(
    ("written", "template"),
    [
        (True, render.DEFAULT_TEMPLATE),
        (False, render.DEFAULT_TEMPLATE),
        (True, render.CUSTOM_CHANNEL_VI_TEMPLATE),
        (True, render.CUSTOM_GTA_CLIPCAST_TEMPLATE),
        (True, render.LOGO_FREE_TEMPLATE),
        *((True, template) for template in render.CHANNEL_VI_TEMPLATES),
    ],
)
def test_template_keeps_audio_and_duration_and_draws_text(
    tmp_path: Path, written, template, monkeypatch
):
    source = tmp_path / "highlight.mp4"
    destination = tmp_path / "branded.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x180:r=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
        timeout=15,
    )
    monkeypatch.setattr(
        render, "auto_captions", lambda *_: [(1, 2, "One late arrival.")]
    )
    narration = "Four bikes.\nOne late arrival." if written else ""
    if template == render.LOGO_FREE_TEMPLATE:
        monkeypatch.setattr(render, "ASSETS", tmp_path / "no-brand-artwork")
    status = render.render_template(
        source, destination, "CUSTOM HOOK", narration, "center", template=template
    )
    title = render.CHANNEL_VI_TEMPLATES.get(template, "Custom Hook")
    assert status.hook.text == title.upper()
    assert status.caption_status.startswith(
        "Written narration" if written else "Automatic English captions"
    )

    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,width,height,duration",
            "-of",
            "json",
            str(destination),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    video, audio = json.loads(result.stdout)["streams"]
    assert (video["codec_name"], video["width"], video["height"]) == ("h264", 720, 1280)
    assert audio["codec_name"] == "aac"
    assert 2.95 <= float(video["duration"]) <= 3.05
    assert abs(float(video["duration"]) - float(audio["duration"])) < 0.05
    channel_vi = (
        template == render.CUSTOM_CHANNEL_VI_TEMPLATE
        or template in render.CHANNEL_VI_TEMPLATES
    )
    caption_crop = "crop=2:2:55:970" if channel_vi else "crop=2:2:38:896"
    if template == render.LOGO_FREE_TEMPLATE:
        caption_crop = "crop=2:2:42:944"

    def has_narration(timestamp: str) -> bool:
        frame = subprocess.check_output(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-ss",
                timestamp,
                "-i",
                str(destination),
                "-frames:v",
                "1",
                "-vf",
                caption_crop,
                "-pix_fmt",
                "rgb24",
                "-f",
                "rawvideo",
                "pipe:1",
            ],
            timeout=10,
        )
        return frame[0] > 150 and frame[1] > 150

    assert has_narration("1.5")
    assert has_narration("0.5") is written
    assert has_narration("2.5") is written
    if template != render.DEFAULT_TEMPLATE:
        raw = subprocess.check_output(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-ss",
                "2.5",
                "-i",
                str(destination),
                "-frames:v",
                "1",
                "-c:v",
                "png",
                "-threads",
                "1",
                "-f",
                "image2pipe",
                "pipe:1",
            ],
            timeout=10,
        )
        with Image.open(BytesIO(raw)).convert("RGB") as frame:
            if template == render.LOGO_FREE_TEMPLATE:
                assert frame.getpixel((350, 550))[2] > 180
                assert max(frame.getpixel((85, 105))) < 20
                assert max(frame.getpixel((540, 1130))) < 20
                assert min(frame.getpixel((45, 180))) > 150
                return
            if channel_vi:
                r, g, b = frame.getpixel((350, 550))
                assert b > 180 and r < 55 and g < 55
                logo = frame.crop((36, 154, 175, 283)).get_flattened_data()
                assert sum(r > 85 and b > 125 for r, _, b in logo) > 60
                panel = frame.crop((49, 840, 350, 920)).get_flattened_data()
                assert sum(r > 190 and g > 175 and b > 175 for r, g, b in panel) > 60
                bottom = frame.crop((460, 1010, 630, 1260)).get_flattened_data()
                assert not any(r > 150 and r > b + 40 for r, _, b in bottom)
                return
            for area in (
                (28, 62, 125, 157),
                (28, 166, 240, 228),
                (460, 1010, 630, 1260),
            ):
                pixels = frame.crop(area).get_flattened_data()
                assert sum(red > blue + 35 for red, _, blue in pixels) > 60


def test_recording_scan_keeps_whisper_windows_when_worker_times_out(
    tmp_path, monkeypatch
):
    commands = []

    def run(command, **kwargs):
        commands.append((command, kwargs))
        if command[0] == "ffmpeg":
            return subprocess.CompletedProcess(command, 0)
        raise subprocess.TimeoutExpired(
            command, kwargs["timeout"], output=b'[[3,5,"Story starts."]]\n[[15,'
        )

    monkeypatch.setattr(render.subprocess, "run", run)
    assert render.auto_captions(
        tmp_path / "capture.mp4", tmp_path, long_source=True
    ) == [[3, 5, "Story starts."]]
    assert commands[1][0][-1] == "--scan-recording"
    assert commands[1][1]["timeout"] == 62


@pytest.mark.parametrize(
    ("template", "position"),
    [
        (render.CUSTOM_CHANNEL_VI_TEMPLATE, (64, 400)),
        (render.CUSTOM_GTA_CLIPCAST_TEMPLATE, (16, 455)),
    ],
)
def test_brand_keeps_source_corner_overlay_with_protected_frame(tmp_path, template, position):
    source = tmp_path / "source.mp4"
    reel = tmp_path / "reel.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i",
        "color=blue:s=320x180:r=30,drawbox=x=0:y=0:w=32:h=32:color=yellow:t=fill",
        "-t", "1", "-c:v", "libx264", "-threads", "1", str(source),
    ], check=True, timeout=15)
    render.render_template(
        source, reel, "THE GETAWAY", "", "center", template=template,
        cached_cues=[], preserve_source_frame=True,
    )
    x, y = position
    corner = subprocess.check_output([
        "ffmpeg", "-v", "error", "-ss", "0.1", "-i", str(reel), "-frames:v", "1",
        "-vf", f"crop=2:2:{x}:{y}", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ], timeout=12)
    red, green, blue = corner[:3]
    assert red > 170 and green > 170 and blue < 70
