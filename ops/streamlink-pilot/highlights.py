"""Read-only Twitch chat signals and local, private highlight extraction."""

import logging
import re
import secrets
import subprocess
from collections import Counter
from dataclasses import dataclass
from math import floor
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
MAX_CLIPS = 10
MAX_HIGHLIGHT_SECONDS = 110
AUDIO_RATE = 16000
LAUGH_CHAT = re.compile(
    r"\b(?:lulw?|lol+|lmao+|lmfao+|kekw|rofl|x+d|(?:ha){2,})\b|[😂🤣]", re.IGNORECASE
)
ACTION_CLASSES = {
    "Vehicle horn, car horn, honking",
    "Siren",
    "Police car (siren)",
    "Skidding",
    "Tire squeal",
    "Crash",
    "Explosion",
    "Gunshot, gunfire",
    "Car passing by",
}
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
    start: float
    end: float
    reasons: tuple[str, ...] = ()
    score: float = 0


@dataclass(frozen=True)
class SoundSignals:
    laughter: dict[int, float]
    action: dict[int, float]


def detect_sound(
    recording: Path, model: Path, *, scan_budget: float = 28
) -> SoundSignals:
    """Score one second of mono audio at a time. Keys are media offsets."""
    with ZipFile(model) as metadata:
        labels = metadata.read("yamnet_label_list.txt").decode().splitlines()
    indices = [i for i, label in enumerate(labels) if label in LAUGH_CLASSES]
    action_indices = [i for i, label in enumerate(labels) if label in ACTION_CLASSES]
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
        timeout=24,
    ).stdout
    samples = np.frombuffer(waveform, dtype="<f4")
    deadline = monotonic() + scan_budget
    interpreter = Interpreter(model_path=str(model), num_threads=1)
    interpreter.allocate_tensors()
    (input_tensor,) = interpreter.get_input_details()
    (output_tensor,) = interpreter.get_output_details()
    frame_size = int(np.prod(input_tensor["shape"]))
    scores = {}
    action = {}
    last = (len(samples) - frame_size) // AUDIO_RATE
    if last < 0:
        return SoundSignals(scores, action)
    # Probe the whole timeline at low density and prioritise loud changes.
    spacing = max(1, (last + 95) // 95)
    uniform = list(range(0, last + 1, spacing))
    seconds = uniform[::3]
    if last:
        signal = samples[: last * AUDIO_RATE].reshape(last, AUDIO_RATE)
        peaks = np.max(np.abs(signal), axis=1)
        attacks = peaks - np.r_[0.0, peaks[:-1]]
        seconds.extend(
            int(index)
            for index in np.argsort(attacks)[-55:][::-1]
            if attacks[index] > 0.05
        )
    seconds.extend(uniform[1::3])
    seconds.extend(uniform[2::3])
    for second in dict.fromkeys(seconds):
        if monotonic() >= deadline:
            break
        offset = second * AUDIO_RATE
        frame = samples[offset : offset + frame_size].reshape(input_tensor["shape"])
        if float(np.max(np.abs(frame))) < 0.015:
            continue
        interpreter.set_tensor(input_tensor["index"], frame)
        interpreter.invoke()
        values = interpreter.get_tensor(output_tensor["index"]).reshape(-1)
        scores[second] = float(np.max(values[indices]))
        if action_indices:
            action[second] = float(np.max(values[action_indices]))
    return SoundSignals(scores, action)


def detect_laughter(recording: Path, model: Path) -> dict[int, float]:
    return detect_sound(recording, model).laughter


STORY = re.compile(
    r"\b(?:mission (?:complete|failed)|plot twist|we have to|we need to|"
    r"i have to tell you|i need to tell you|i never told you|the truth is|"
    r"here'?s the plan|what really happened|turns out|i found out|"
    r"this changes everything|i can explain|we finally (?:found|made|did)|"
    r"(?:i|we|they) (?:just )?(?:beat|finished|completed) the game)\b",
    re.IGNORECASE,
)
ACTION = re.compile(
    r"\b(?:crashed|rolled over|wrecked|police chase|cops behind|"
    r"they(?:'re| are) chasing|just blew up|incoming|flipped the car|stunt jump)\b",
    re.IGNORECASE,
)
COMEDY = re.compile(
    r"\b(?:why is (?:he|she|there|that)|you can'?t park there|what is he doing|"
    r"did (?:he|she|they) really|you'?ve got to be kidding|"
    r"this is the worst|what just happened)\b",
    re.IGNORECASE,
)
Speech = tuple[float, float, str]


def detect_motion(recording: Path) -> dict[int, float]:
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "1",
            "-skip_frame",
            "nokey",
            "-i",
            str(recording),
            "-an",
            "-filter_threads",
            "1",
            "-vf",
            "fps=1,crop=iw*0.65:ih*0.74,scale=64:36:flags=area,format=gray",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=22,
    )
    frames = np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, 36, 64)
    if len(frames) < 4:
        return {}
    strength = np.mean(np.abs(np.diff(frames.astype(np.int16), axis=0)), axis=(1, 2))
    baseline = float(np.median(strength))
    threshold = max(24, baseline * 1.8)
    return {
        i + 1: float(value)
        for i, value in enumerate(strength[:-1])
        if value >= threshold
        and np.max(strength[i + 1 : i + 4]) >= max(14, baseline * 1.2)
    }


def natural_bounds(
    event: int, length: int, speech: list[Speech], story: bool
) -> tuple[float, float, bool]:
    lead, tail = (15, 32) if story else (10, 17)
    start = max(0, event - lead)
    end = min(length, max(start + 17, event + tail))
    if not speech:
        return start, end, False

    for left, right, _ in speech:
        if left < start < right:
            start = max(0, floor(left - 0.15))
            break

    # Use an actual gap after a complete line or exchange. Keep the next line
    # through short gaps, and leave a little room before the cut.
    maximum = min(length, start + MAX_HIGHLIGHT_SECONDS)
    minimum = min(maximum, max(event + (18 if story else 8), start + 16))
    stops = []
    complete_lines = []
    for index, (_, right, text) in enumerate(speech):
        if not minimum <= right <= maximum:
            continue
        following = speech[index + 1][0] if index + 1 < len(speech) else length
        gap = following - right
        sentence = text.rstrip().endswith((".", "!", "?", "…"))
        if gap >= (1.4 if story else 0.9) or (
            sentence and gap >= (0.85 if story else 0.55)
        ):
            stops.append(right + min(gap / 2, 0.65))
        elif sentence and gap >= 0.12:
            complete_lines.append(right + min(gap / 2, 0.1))
    safe_stops = stops or complete_lines
    if safe_stops:
        end = min(maximum, round(min(safe_stops, key=lambda time: abs(time - end)), 2))
        return start, end, False
    incomplete = end >= length - 1 and speech[-1][1] >= length - 1.2
    for index, (left, right, text) in enumerate(speech):
        if left < end < right:
            following = speech[index + 1][0] if index + 1 < len(speech) else length
            gap = max(0, following - right)
            end = min(maximum, round(right + min(gap / 2, 0.22), 2))
            incomplete = (
                end < right
                or (gap < 0.12 and not text.rstrip().endswith((".", "!", "?", "…")))
                or (end >= length - 1 and speech[-1][1] >= length - 1.2)
            )
            break
    return start, end, incomplete


def select_clips(
    duration: float,
    counts: Counter[int],
    chat_laughter: Counter[int],
    audio_laughter: dict[int, float],
    *,
    speech: list[Speech] | None = None,
    action: dict[int, float] | None = None,
    motion: dict[int, float] | None = None,
) -> list[Clip]:
    length = int(duration)
    if length < 12:
        return []
    speech = sorted(speech or [])
    action = action or {}
    motion = motion or {}
    speech_signals: dict[int, list[tuple[int, str]]] = {}
    for left, right, text in speech:
        event = int((left + right) / 2)
        for pattern, reason in (
            (STORY, "Story beat"),
            (ACTION, "Action in dialogue"),
            (COMEDY, "Funny exchange"),
        ):
            if pattern.search(text):
                speech_signals.setdefault(event // CHAT_BUCKET, []).append(
                    (event, reason)
                )
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
        seconds = range(first, first + CHAT_BUCKET)
        nearby = range(max(0, first - 2), min(length, first + CHAT_BUCKET + 2))
        laugh_at = max(nearby, key=lambda i: audio_laughter.get(i, 0))
        audio = audio_laughter.get(laugh_at, 0)
        action_at = max(seconds, key=lambda i: action.get(i, 0))
        action_score = action.get(action_at, 0)
        movement = max((motion.get(second, 0) for second in seconds), default=0)
        dialogue = speech_signals.get(bucket, [])
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
        if action_score >= 0.46 and (movement or action_score >= 0.64):
            reasons.append("Action sounds")
            score += 2.5 * action_score + (0.7 if movement else 0)
        if movement >= 31 or (movement and (dialogue or "Chat spike" in reasons)):
            reasons.append("Gameplay movement")
            score += 1.9 if movement >= 31 else 0.7
        for reason in dict.fromkeys(reason for _, reason in dialogue):
            reasons.append(reason)
            score += {
                "Story beat": 2.7,
                "Action in dialogue": 2.2,
                "Funny exchange": 1.7,
            }[reason]
        if not reasons:
            continue
        event = (
            dialogue[0][0]
            if dialogue
            else laugh_at
            if audio >= 0.44
            else action_at
            if "Action sounds" in reasons
            else first + CHAT_BUCKET // 2
        )
        start, end, incomplete = natural_bounds(
            event, length, speech, "Story beat" in reasons
        )
        if incomplete:
            reasons.append("Dialogue may continue past the cut")
            score *= 0.7
        if end - start >= 10:
            candidates.append(Clip(start, end, tuple(reasons), score))

    selected: list[Clip] = []
    for candidate in sorted(candidates, key=lambda clip: -clip.score):
        if any(
            min(candidate.end, clip.end) - max(candidate.start, clip.start)
            >= min(candidate.end - candidate.start, clip.end - clip.start) * 0.42
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
