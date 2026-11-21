import json
import subprocess
from pathlib import Path

import pytest

from clipcast_template import render


@pytest.mark.parametrize("written", [True, False])
def test_template_keeps_audio_and_duration_and_draws_text(
    tmp_path: Path, written, monkeypatch
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
    status = render.render_template(
        source, destination, "IT WAS GOING WELL", narration, "center"
    )
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
                "crop=2:2:38:896",
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
