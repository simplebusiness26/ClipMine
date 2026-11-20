"""Read-only Twitch chat signals and local, private highlight extraction."""

import logging
import re
import secrets
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from threading import Event, Thread
from time import monotonic
from zipfile import ZipFile

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from websocket import WebSocketException, WebSocketTimeoutException, create_connection

LOGGER = logging.getLogger(__name__)
CHAT_URL = "wss://irc-ws.chat.twitch.tv:443"
CHAT_BUCKET = 5
CHAT_LEAD = 5
MAX_CLIPS = 3
CLIP_LENGTH = 35
CONTEXT_BEFORE = 18
AUDIO_RATE = 16000
LAUGH_CHAT = re.compile(
    r"\b(?:lulw?|lol+|lmao+|lmfao+|kekw|rofl|x+d|(?:ha){2,})\b|[😂🤣]", re.IGNORECASE
)
LAUGH_CLASSES = {
    "Laughter",
    "Baby laughter",
    "Giggle",
    "Snicker",
    "Belly laugh",
    "Chuckle, chortle",
}


class ChatMonitor:
    """Aggregate reactions in memory. Never retain chat text or user names."""

    def __init__(self, channel: str) -> None:
        self.channel = channel.lower()
        self.connected = False
        self.counts: Counter[int] = Counter()
        self.laughter: Counter[int] = Counter()
        self._media_clock: tuple[float, float] | None = None
        self._stop = Event()
        self._thread = Thread(target=self._watch, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=7)

    def progress(self, seconds: float) -> None:
        if seconds >= 0:
            self._media_clock = (seconds, monotonic())

    def consume(self, line: str, now: float) -> None:
        if line.startswith("@"):
            _, _, line = line.partition(" ")
        header, marker, message = line.partition(" :")
        if not marker or not header.endswith(f" PRIVMSG #{self.channel}"):
            return
        if self._media_clock is None:
            return
        seconds, last_update = self._media_clock
        estimate = seconds + min(4, max(0, now - last_update)) - CHAT_LEAD
        if estimate < 0:
            return
        bucket = int(estimate // CHAT_BUCKET)
        self.counts[bucket] += 1
        if LAUGH_CHAT.search(message):
            self.laughter[bucket] += 1

    def _watch(self) -> None:
        # Twitch's public read-only chat. There is no token or chat write path.
        for _ in range(2):
            if self._stop.is_set():
                return
            socket = None
            try:
                socket = create_connection(CHAT_URL, timeout=3)
                for command in (
                    "PASS SCHMOOPIIE",
                    f"NICK justinfan{secrets.randbelow(900000) + 100000}",
                    "CAP REQ :twitch.tv/commands",
                    f"JOIN #{self.channel}",
                ):
                    socket.send(f"{command}\r\n")
                while not self._stop.is_set():
                    try:
                        payload = socket.recv()
                    except WebSocketTimeoutException:
                        continue
                    if not payload:
                        break
                    if isinstance(payload, bytes):
                        payload = payload.decode("utf-8", errors="replace")
                    for line in payload.splitlines():
                        if line.startswith("@"):
                            _, _, line = line.partition(" ")
                        if line.startswith("PING "):
                            socket.send(f"PONG {line[5:]}\r\n")
                            continue
                        if (
                            " NOTICE " in line
                            and "authentication failed" in line.lower()
                        ):
                            return
                        if " RECONNECT" in line:
                            break
                        if " 366 " in line or f" ROOMSTATE #{self.channel}" in line:
                            self.connected = True
                        if f" PRIVMSG #{self.channel} :" in line:
                            self.connected = True
                            self.consume(line, monotonic())
                    else:
                        continue
                    break
            except (OSError, WebSocketException) as error:
                LOGGER.info(
                    "Twitch chat connection finished (%s)", type(error).__name__
                )
            finally:
                if socket is not None:
                    socket.close(timeout=1)


@dataclass(frozen=True)
class Clip:
    start: int
    end: int
    reasons: tuple[str, ...] = ()
    score: float = 0


def detect_laughter(recording: Path, model: Path) -> dict[int, float]:
    """Score one second of mono audio at a time. Keys are media offsets."""
    with ZipFile(model) as metadata:
        labels = metadata.read("yamnet_label_list.txt").decode().splitlines()
    indices = [i for i, label in enumerate(labels) if label in LAUGH_CLASSES]
    if not indices:
        raise ValueError("Laughter labels missing from model")

    waveform = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "1",
            "-i",
            str(recording),
            "-vn",
            "-map",
            "0:a:0?",
            "-ac",
            "1",
            "-ar",
            str(AUDIO_RATE),
            "-t",
            "601",
            "-f",
            "f32le",
            "pipe:1",
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=55,
    ).stdout
    samples = np.frombuffer(waveform, dtype="<f4")
    interpreter = Interpreter(model_path=str(model), num_threads=1)
    interpreter.allocate_tensors()
    (input_tensor,) = interpreter.get_input_details()
    (output_tensor,) = interpreter.get_output_details()
    frame_size = int(np.prod(input_tensor["shape"]))
    scores = {}
    for offset in range(0, len(samples) - frame_size + 1, AUDIO_RATE):
        frame = samples[offset : offset + frame_size].reshape(input_tensor["shape"])
        if float(np.max(np.abs(frame))) < 0.015:
            continue
        interpreter.set_tensor(input_tensor["index"], frame)
        interpreter.invoke()
        scores[offset // AUDIO_RATE] = float(
            np.max(interpreter.get_tensor(output_tensor["index"]).reshape(-1)[indices])
        )
    return scores


def select_clips(
    duration: float,
    counts: Counter[int],
    chat_laughter: Counter[int],
    audio_laughter: dict[int, float],
) -> list[Clip]:
    length = int(duration)
    if length < 12:
        return []
    candidates = []
    for bucket in range((length + CHAT_BUCKET - 1) // CHAT_BUCKET):
        first = bucket * CHAT_BUCKET
        baseline = (
            median(counts[i] for i in range(max(0, bucket - 6), bucket))
            if bucket
            else 0
        )
        messages = counts[bucket]
        reactions = chat_laughter[bucket]
        audio = max(
            (
                audio_laughter.get(second, 0)
                for second in range(max(0, first - 2), first + CHAT_BUCKET + 2)
            ),
            default=0,
        )
        reasons = []
        score = 0.0
        if messages >= max(6, baseline * 2.0, baseline + 5):
            reasons.append("Chat spike")
            score += min(3, messages / max(3, baseline) / 2)
        if reactions >= max(3, messages * 0.15):
            reasons.append("Laugh reactions in chat")
            score += min(2, reactions / 3)
        if audio >= 0.44:
            reasons.append("Laughter in stream audio")
            score += 3 * audio
        if not reasons:
            continue
        event = first + CHAT_BUCKET // 2
        start = max(0, min(event - CONTEXT_BEFORE, length - CLIP_LENGTH))
        candidates.append(
            Clip(start, min(start + CLIP_LENGTH, length), tuple(reasons), score)
        )

    selected = []
    for candidate in sorted(candidates, key=lambda clip: -clip.score):
        if any(
            candidate.start < clip.end - 4 and clip.start < candidate.end - 4
            for clip in selected
        ):
            continue
        selected.append(candidate)
        if len(selected) == MAX_CLIPS:
            break
    return selected


def cut_clip(recording: Path, output: Path, clip: Clip) -> None:
    # Copy the captured codecs for quick cut-only exports on the free instance.
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-ss",
            str(clip.start),
            "-i",
            str(recording),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-t",
            str(clip.end - clip.start),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
        stderr=subprocess.DEVNULL,
        timeout=30,
    )
    if not output.is_file() or not output.stat().st_size:
        raise ValueError("Clip encoding produced no file")
