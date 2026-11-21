"""Suggest short hooks using observed objects and relevant spoken details."""

import logging
import os
import re
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from zipfile import BadZipFile, ZipFile

import numpy as np
from ai_edge_litert.interpreter import Interpreter

LOGGER = logging.getLogger(__name__)
OBJECT_MODEL = Path(
    os.environ.get("CLIPCAST_OBJECT_MODEL", "/app/efficientdet-lite0.tflite")
)
MODEL_SIZE = 320
PORTRAIT_WIDTH = 180
PADDING = (MODEL_SIZE - PORTRAIT_WIDTH) / 2
OBJECTS = {
    "car": "car",
    "truck": "truck",
    "bicycle": "bike",
    "motorcycle": "bike",
    "bus": "bus",
    "train": "train",
    "boat": "boat",
    "airplane": "plane",
    "dog": "dog",
    "horse": "horse",
    "cat": "cat",
    "skateboard": "skateboard",
}
VEHICLES = {"car", "truck", "bike", "bus", "boat", "plane", "train"}
SPOKEN_EVENTS = (
    (
        r"\b(?:i|we|they) (?:just )?(?:beat|finished|completed) the game\b",
        "THEY FINALLY BEAT THE GAME",
    ),
    (
        r"\b(?:we|they) (?:just )?(?:won|finished) (?:the|that) race\b",
        "THE MOMENT THE RACE ENDS",
    ),
    (
        r"\b(?:he|she|they|we) (?:just )?(?:pulled up|showed up|turned up)\b",
        "LOOK WHO JUST SHOWED UP",
    ),
    (
        r"\b(?:one late arrival|(?:he|she|they|we) (?:was|were) late)\b",
        "WHO SHOWED UP LATE?",
    ),
    (r"\b(?:mission failed|we failed the mission)\b", "THAT MISSION DIDN'T GO TO PLAN"),
    (
        r"\b(?:i|we|they|he|she) (?:just )?lost (?:the|my|our|his|her) getaway (?:car|vehicle)\b",
        "THERE GOES THE GETAWAY CAR",
    ),
    (
        r"\b(?:i|we|they|he|she) (?:just )?(?:escaped|lost the cops|got away)\b",
        "HOW DID THEY GET AWAY WITH THAT?",
    ),
    (
        r"\b(?:the|my|our) (?:car|truck|bike) (?:just )?exploded\b",
        "THAT ESCALATED FAST",
    ),
)
CRASH = re.compile(r"\b(?:i|we|he|she|they) (?:just )?(?:crashed|wrecked)\b")
CHASE = re.compile(
    r"\b(?:they(?:'re| are) (?:chasing|following) us|cops (?:are )?behind us)\b"
)
REACTION = re.compile(
    r"^(?:wait[,! .]+|hold up[,! .]+)?((?:did you see|where did|why is|how did)\b.{12,42}\?)$",
    re.IGNORECASE,
)
SWEARING = re.compile(r"\b(?:f\w{2}k\w*|shit\w*|bitch\w*|cunt\w*)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    x: float
    y: float
    area: float


@dataclass(frozen=True)
class HookSuggestion:
    text: str = ""
    source: str = ""


def frame_samples(source: Path, duration: float, crop_filter: str) -> np.ndarray:
    # Sample the same portrait area the viewer will see, across the highlight.
    fps = 6 / duration
    video_filter = (
        f"fps={fps:.8f}:round=up,{crop_filter},"
        f"scale={PORTRAIT_WIDTH}:{MODEL_SIZE}:flags=bilinear,"
        f"pad={MODEL_SIZE}:{MODEL_SIZE}:{int(PADDING)}:0"
    )
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "1",
            "-i",
            str(source),
            "-an",
            "-vf",
            video_filter,
            "-filter_threads",
            "1",
            "-frames:v",
            "6",
            "-threads",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=65,
    )
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(
        -1, MODEL_SIZE, MODEL_SIZE, 3
    )


def detect_objects(frames: np.ndarray, model: Path) -> list[list[Detection]]:
    with ZipFile(model) as metadata:
        labels = metadata.read("labelmap.txt").decode().splitlines()
    detector = Interpreter(model_path=str(model), num_threads=1)
    detector.allocate_tensors()
    (images,) = detector.get_input_details()
    boxes, categories, scores, count = (
        tensor["index"] for tensor in detector.get_output_details()
    )
    observations = []
    for frame in frames:
        detector.set_tensor(images["index"], frame[None, ...])
        detector.invoke()
        detections = []
        detected = int(detector.get_tensor(count).item())
        for box, category, score in zip(
            detector.get_tensor(boxes)[0, :detected],
            detector.get_tensor(categories)[0, :detected],
            detector.get_tensor(scores)[0, :detected],
        ):
            label = OBJECTS.get(labels[int(category)])
            if not label or score < 0.35:
                continue
            top, left, bottom, right = (float(v) for v in box)
            left = max(0, (left * MODEL_SIZE - PADDING) / PORTRAIT_WIDTH)
            right = min(1, (right * MODEL_SIZE - PADDING) / PORTRAIT_WIDTH)
            width, height = right - left, min(1, bottom) - max(0, top)
            area = width * height
            if width > 0 and height > 0 and area >= 0.017:
                x, y = (left + right) / 2, (top + bottom) / 2
                if not any(
                    item.label == label
                    and abs(item.x - x) < 0.10
                    and abs(item.y - y) < 0.09
                    for item in detections
                ):
                    detections.append(Detection(label, float(score), x, y, area))
        observations.append(detections)
    return observations


def affirmed(pattern: str | re.Pattern[str], transcript: str) -> bool:
    for match in re.finditer(pattern, transcript):
        prefix = re.split(
            r"[.!?;]", transcript[max(0, match.start() - 36) : match.start()]
        )[-1]
        if not re.search(r"\b(?:if|when|hope|unless|wonder|never|might)\b", prefix):
            return True
    return False


def choose_hook(frames: list[list[Detection]], dialogue: list[str]) -> HookSuggestion:
    hits: dict[str, list[Detection]] = defaultdict(list)
    appearances: Counter[str] = Counter()
    for frame in frames:
        appearances.update({item.label for item in frame})
        for item in frame:
            hits[item.label].append(item)
    reliable = [
        key
        for key, items in hits.items()
        if appearances[key] >= 2 or max(item.score for item in items) >= 0.60
    ]
    # A recurring, prominent object is a better hook than a tiny HUD detection.
    reliable.sort(
        key=lambda name: sum(
            item.score * (0.14 + min(item.area, 0.35))
            for item in sorted(
                hits[name], key=lambda hit: hit.score * hit.area, reverse=True
            )[:5]
        ),
        reverse=True,
    )
    subject = reliable[0] if reliable else ""
    words = [" ".join(cue.split()).replace("’", "'") for cue in dialogue]
    transcript = " ".join(words).lower()
    for phrase, text in SPOKEN_EVENTS:
        if affirmed(phrase, transcript):
            return HookSuggestion(text, "dialogue or written narration")
    if subject in VEHICLES:
        if affirmed(CRASH, transcript):
            return HookSuggestion(
                f"WAIT. DID THEY JUST CRASH THAT {subject.upper()}?",
                "frames and dialogue",
            )
        if affirmed(CHASE, transcript):
            return HookSuggestion(
                "LISTEN. THEY'RE BEING FOLLOWED", "frames and dialogue"
            )
    for line in words:
        match = REACTION.fullmatch(line)
        if match and not SWEARING.search(line) and len(match[1]) <= 57:
            return HookSuggestion(match[1], "dialogue or written narration")
    if subject:
        if subject in VEHICLES:
            plural = "buses" if subject == "bus" else subject + "s"
            if (
                sum(sum(d.label == subject for d in frame) >= 2 for frame in frames)
                >= 2
            ):
                return HookSuggestion(
                    f"WATCH THE {plural.upper()} IN THIS SHOT", "video frames"
                )
        items = hits[subject]
        x, y, area = (
            median(getattr(item, field) for item in items)
            for field in ("x", "y", "area")
        )
        name = subject.upper()
        if y > 0.59 and area > 0.14:
            text = (
                "FOLLOW THE BIKE IN THE FOREGROUND"
                if subject == "bike"
                else f"KEEP AN EYE ON THE {name} UP FRONT"
            )
            return HookSuggestion(text, "video frames")
        if x < 0.34 or x > 0.66:
            side = "LEFT" if x < 0.34 else "RIGHT"
            return HookSuggestion(f"WATCH THE {name} ON THE {side}", "video frames")
        return HookSuggestion(f"WATCH WHAT HAPPENS BY THE {name}", "video frames")
    return HookSuggestion()


def suggest_hook(
    source: Path, duration: float, crop_filter: str, dialogue: list[str]
) -> HookSuggestion:
    from_dialogue = choose_hook([], dialogue)
    if from_dialogue.text:
        return from_dialogue
    frames = []
    try:
        frames = detect_objects(
            frame_samples(source, duration, crop_filter), OBJECT_MODEL
        )
    except (
        OSError,
        ValueError,
        RuntimeError,
        BadZipFile,
        KeyError,
        IndexError,
        subprocess.SubprocessError,
    ) as error:
        LOGGER.warning("Hook object check unavailable (%s)", type(error).__name__)
    return choose_hook(frames, dialogue)
