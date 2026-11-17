"""Quality controls shared by the existing Colab phone studio.

Targets are approximate durations in Best bits mode. Numbered parts remain exact
and are explicitly marked for boundary review. This module never publishes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .models import TranscriptSegment
from .scoring import _score_window, _title_from_text

PROFILE_VERSION = "phone-quality-2"
TRAILING_CONNECTORS = {"if", "and", "but", "because", "so", "the", "a", "to", "of", "or"}


def complete_ending(text: str) -> bool:
    words = re.findall(r"[\w']+", text.lower())
    return bool(
        words and words[-1] not in TRAILING_CONNECTORS
        and text.rstrip().endswith((".", "!", "?", '."', '!"', '?"'))
    )


@dataclass(frozen=True)
class Clip:
    start: float
    end: float
    length: int
    title: str
    transcript: str
    score: float = 0
    reasons: tuple[str, ...] = ()
    segments: tuple[TranscriptSegment, ...] = ()
    review_issues: tuple[str, ...] = ()


def overlap(a: Clip, b: Clip) -> float:
    seconds = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    return seconds / max(0.01, min(a.end - a.start, b.end - b.start))


def select_clips(duration, segments, counts, mode, start):
    if not 0 <= start < duration:
        raise ValueError("Start time must be inside the video.")
    ordered = sorted(segments, key=lambda segment: segment.start_seconds)
    if not ordered:
        raise ValueError("A transcript is required for reviewed speech clips.")
    options = []
    if mode == "Numbered parts":
        for length, count in counts.items():
            for _ in range(count):
                end = min(duration, start + length)
                if end <= start:
                    return options
                spoken = [s for s in ordered if s.start_seconds >= start and s.end_seconds <= end]
                text = " ".join(s.text for s in spoken)
                options.append(Clip(
                    start, end, length, f"Part {len(options) + 1}", text,
                    segments=tuple(spoken),
                    review_issues=("Exact numbered cut: review speech boundaries and captions.",),
                ))
                start = end
        return options

    for length, count in counts.items():
        if not count:
            continue
        minimum, maximum = max(10, length * 0.65), length * 1.20
        for index, first in enumerate(ordered):
            if first.start_seconds < start:
                continue
            window = []
            for segment in ordered[index:]:
                span = segment.end_seconds - first.start_seconds
                if span > maximum or segment.end_seconds > duration + 0.05:
                    break
                if window and segment.start_seconds - window[-1].end_seconds > 2.5:
                    break
                window.append(segment)
                if span < minimum or not complete_ending(segment.text):
                    continue
                text = " ".join(s.text.strip() for s in window)
                score, reasons = _score_window(window)
                score -= abs(span - length) / length * 8
                options.append(Clip(
                    round(first.start_seconds, 3), round(segment.end_seconds, 3), length,
                    _title_from_text(text, 1), text, round(score, 1),
                    tuple(reasons), tuple(window),
                ))

    options.sort(key=lambda clip: clip.score, reverse=True)
    results = []
    remaining = counts.copy()
    for candidate in options:
        if remaining[candidate.length] <= 0:
            continue
        if all(overlap(candidate, saved) < 0.30 for saved in results):
            results.append(candidate)
            remaining[candidate.length] -= 1
    return results
