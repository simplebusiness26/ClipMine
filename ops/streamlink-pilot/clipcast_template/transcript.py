"""Transcribe a short mono PCM wave in an isolated, single-threaded process."""

import json
import os
import re
import sys
import wave

import numpy as np
from pywhispercpp.model import Model


def transcribe(path: str) -> list[list[str | float]]:
    with wave.open(path, "rb") as file:
        samples = np.frombuffer(file.readframes(file.getnframes()), dtype="<i2")
    audio = samples.astype(np.float32) / 32768
    if not audio.size or np.max(np.abs(audio)) < 0.004:
        return []
    model = Model(
        os.environ.get("CLIPCAST_TRANSCRIPT_MODEL", "/app/ggml-tiny.en-q5_1.bin"),
        n_threads=1,
        language="en",
        translate=False,
        no_context=True,
        split_on_word=True,
        max_len=52,
        suppress_blank=True,
        no_speech_thold=0.60,
        temperature_inc=0.0,
        print_realtime=False,
        print_progress=False,
        print_timestamps=False,
        redirect_whispercpp_logs_to=os.devnull,
    )
    cues = []
    for segment in model.transcribe(audio):
        # Only put spoken lines in the lower caption strip.
        text = re.sub(r"\[[^\]]+\]|\([^)]+\)|[♪♫]", "", segment.text).strip()
        if text and segment.t1 > segment.t0:
            cues.append([float(segment.t0) / 100, float(segment.t1) / 100, text])
    return cues


if __name__ == "__main__":
    print(json.dumps(transcribe(sys.argv[1])))
