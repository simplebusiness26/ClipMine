"""Build the six runtime narration tracks using Scoop's current voice.

Run manually when changing the three script presets. Provide the Kokoro v1.0
ONNX and voices-v1.0.bin files in a folder. Requires kokoro-onnx and FFmpeg.
The live renderer uses only the generated tracks.
"""

import subprocess
import sys
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from kokoro_onnx import Kokoro

from scoop.render import ASSETS, SCRIPT_CHOICES


def build_tracks(directory: Path) -> None:
    engine = Kokoro(
        str(directory / "kokoro-v1.0.onnx"), str(directory / "voices-v1.0.bin")
    )
    voices = {"bm_fable": 0.54, "bm_george": 0.31, "bm_daniel": 0.15}
    blend = sum(
        engine.get_voice_style(name) * weight for name, weight in voices.items()
    )
    with TemporaryDirectory(prefix="scoop-voice-") as work:
        dry = Path(work) / "dry.wav"
        for key, (_, *lines) in SCRIPT_CHOICES.items():
            for index, line in enumerate(lines, 1):
                audio, rate = engine.create(line, voice=blend, speed=1.06, lang="en-gb")
                with wave.open(str(dry), "wb") as wav:
                    wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                    wav.writeframes(
                        (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
                    )
                shifted_rate = round(rate * 1.175)
                filters = (
                    f"asetrate={shifted_rate},aresample={rate},atempo={rate / shifted_rate:.8f},"
                    "highpass=f=130,equalizer=f=1850:t=q:w=1.2:g=3.6,vibrato=f=7:d=0.13,"
                    "acompressor=threshold=0.09:ratio=2.7:attack=7:release=85:makeup=2.05,"
                    "silenceremove=start_periods=1:start_duration=0.005:start_threshold=-46dB:"
                    "start_silence=0.01,apad=pad_dur=0.16,loudnorm=I=-15:TP=-2:LRA=7,"
                    "aresample=48000,adelay=60"
                )
                subprocess.run(
                    [
                        "ffmpeg",
                        "-nostdin",
                        "-v",
                        "error",
                        "-y",
                        "-i",
                        str(dry),
                        "-af",
                        filters,
                        "-c:a",
                        "libopus",
                        "-b:a",
                        "40k",
                        "-ac",
                        "1",
                        str(ASSETS / f"{key}-{index}.ogg"),
                    ],
                    check=True,
                    timeout=30,
                )


if __name__ == "__main__":
    build_tracks(Path(sys.argv[1]))
