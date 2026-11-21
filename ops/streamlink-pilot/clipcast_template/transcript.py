"""Transcribe a short mono PCM wave in an isolated, single-threaded process."""

import json
import os
import re
import sys
import wave

import numpy as np
from pywhispercpp.model import Model


def transcribe(path: str, scan_recording: bool = False) -> list[list[str | float]]:
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
    if not scan_recording:
        return transcribe_window(model, audio)
    for offset in scan_windows(len(audio) / 16000):
        sample = audio[round(offset * 16000) : round((offset + 18) * 16000)]
        # Flush each completed window so a time limit preserves partial cues.
        print(json.dumps(transcribe_window(model, sample, offset)), flush=True)
    return []


def scan_windows(duration: float) -> list[float]:
    last = max(0.0, duration - 18)
    if duration < 55:
        return [0.0, last] if last >= 18 else [0.0]
    return [
        round(last * fraction, 2) for fraction in (0.46, 0.08, 0.81, 0.27, 0.64, 1.0)
    ]


def transcribe_window(
    model: Model, audio: np.ndarray, offset: float = 0.0
) -> list[list[str | float]]:
    if not audio.size or np.max(np.abs(audio)) < 0.004:
        return []
    cues = []
    for segment in model.transcribe(audio):
        text = re.sub(r"\[[^\]]+\]|\([^)]+\)|[♪♫]", "", segment.text).strip()
        if text and segment.t1 > segment.t0:
            cues.append(
                [
                    offset + float(segment.t0) / 100,
                    offset + float(segment.t1) / 100,
                    text,
                ]
            )
    return cues


if __name__ == "__main__":
    scan = "--scan-recording" in sys.argv[2:]
    result = transcribe(sys.argv[1], scan)
    if not scan:
        print(json.dumps(result))
