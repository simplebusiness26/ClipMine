import json
import subprocess
from pathlib import Path

import pytest

from scoop.render import choose_script, render_scoop


@pytest.mark.parametrize("has_audio", [True, False])
def test_export_uses_portrait_template_and_adds_voice(tmp_path: Path, has_audio: bool):
    source = tmp_path / "highlight.mp4"
    destination = tmp_path / "scoop.mp4"
    audio = (
        ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-c:a", "aac"]
        if has_audio
        else []
    )
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
            *audio,
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            str(source),
        ],
        check=True,
        timeout=15,
    )
    assert choose_script(("Laugh reactions in chat",)) == "chat-laugh"
    render_scoop(source, destination, "chat-laugh", "center")

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
    video, voice = json.loads(result.stdout)["streams"]
    assert (video["codec_name"], video["width"], video["height"]) == ("h264", 720, 1280)
    assert voice["codec_name"] == "aac"
    assert 6 < float(video["duration"]) < 14
    assert abs(float(video["duration"]) - float(voice["duration"])) < 0.1
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-xerror",
            "-i",
            str(destination),
            "-f",
            "null",
            "-",
        ],
        check=True,
        timeout=15,
    )
