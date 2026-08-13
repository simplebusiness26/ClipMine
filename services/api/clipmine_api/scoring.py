from __future__ import annotations

import math
import re
import uuid
from collections.abc import Iterable

from .models import ClipCandidate, TranscriptSegment

HOOK_PATTERNS = (
    "here's why",
    "here is why",
    "the problem",
    "the secret",
    "what if",
    "how do",
    "how to",
    "why do",
    "most people",
    "the biggest",
    "you need to",
    "i realised",
    "i learned",
)
PAYOFF_PATTERNS = (
    "that's why",
    "that is why",
    "the result",
    "so now",
    "which means",
    "the lesson",
    "in the end",
    "therefore",
)
FILLER_WORDS = {"um", "uh", "like", "basically", "literally"}


def _normalise_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def _title_from_text(text: str, index: int) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip(" .,!?:;-")
    if not cleaned:
        return f"Suggested clip {index}"
    first_sentence = re.split(r"(?<=[.!?])\s+", cleaned)[0]
    words = first_sentence.split()
    title = " ".join(words[:8])
    if len(words) > 8:
        title += "…"
    return title[0].upper() + title[1:]


def _score_window(segments: list[TranscriptSegment]) -> tuple[float, list[str]]:
    text = " ".join(item.text.strip() for item in segments if item.text.strip()).strip()
    duration = max(0.1, segments[-1].end_seconds - segments[0].start_seconds)
    words = _normalise_words(text)
    lower = text.lower()

    score = 38.0
    reasons: list[str] = []

    if text and (text.lstrip().startswith(("why", "how", "what")) or "?" in text[:120]):
        score += 12
        reasons.append("Opens with a direct question")
    elif any(pattern in lower[:180] for pattern in HOOK_PATTERNS):
        score += 10
        reasons.append("Opens with a clear hook")
    else:
        score += 4
        reasons.append("Starts on a complete spoken idea")

    if text.endswith((".", "!", "?")):
        score += 13
        reasons.append("Ends at a complete thought")
    if any(pattern in lower for pattern in PAYOFF_PATTERNS):
        score += 10
        reasons.append("Contains a clear takeaway or payoff")

    density = len(words) / duration
    if 1.6 <= density <= 3.5:
        score += 10
        reasons.append("Keeps a useful speaking pace")
    elif density < 0.8:
        score -= 8

    unique_ratio = len(set(words)) / max(1, len(words))
    if unique_ratio >= 0.48:
        score += 6
        reasons.append("Contains concentrated information")

    filler_ratio = sum(word in FILLER_WORDS for word in words) / max(1, len(words))
    score -= min(12, filler_ratio * 100)

    if 25 <= duration <= 60:
        score += 6
    score = round(max(0, min(100, score)), 1)
    return score, reasons[:3]


def _overlap_ratio(a: ClipCandidate, b: ClipCandidate) -> float:
    overlap = max(0.0, min(a.end_seconds, b.end_seconds) - max(a.start_seconds, b.start_seconds))
    shortest = min(a.duration_seconds, b.duration_seconds)
    return overlap / shortest if shortest else 0.0


def _candidate_from_segments(
    segments: list[TranscriptSegment], index: int
) -> ClipCandidate:
    text = " ".join(item.text.strip() for item in segments if item.text.strip()).strip()
    score, reasons = _score_window(segments)
    confidence = "high" if score >= 72 else "medium" if score >= 56 else "experimental"
    return ClipCandidate(
        id=str(uuid.uuid4()),
        start_seconds=round(segments[0].start_seconds, 2),
        end_seconds=round(segments[-1].end_seconds, 2),
        title=_title_from_text(text, index),
        score=score,
        confidence=confidence,
        reasons=reasons,
        caption_text=text,
    )


def generate_candidates(
    segments: Iterable[TranscriptSegment],
    desired_count: int,
    min_seconds: float,
    max_seconds: float,
) -> list[ClipCandidate]:
    ordered = sorted(segments, key=lambda item: item.start_seconds)
    if not ordered:
        return []

    proposals: list[ClipCandidate] = []
    for start_index, first in enumerate(ordered):
        window: list[TranscriptSegment] = []
        for segment in ordered[start_index:]:
            if segment.start_seconds - first.start_seconds > max_seconds:
                break
            window.append(segment)
            duration = segment.end_seconds - first.start_seconds
            if duration >= min_seconds:
                proposals.append(_candidate_from_segments(window, len(proposals) + 1))
                break

    proposals.sort(key=lambda item: item.score, reverse=True)
    selected: list[ClipCandidate] = []
    for proposal in proposals:
        if all(_overlap_ratio(proposal, existing) < 0.58 for existing in selected):
            selected.append(proposal)
        if len(selected) >= desired_count:
            break

    return sorted(selected, key=lambda item: item.start_seconds)


def generate_timeline_candidates(
    duration_seconds: float,
    desired_count: int,
    min_seconds: float,
    max_seconds: float,
) -> list[ClipCandidate]:
    if duration_seconds <= 0:
        return []
    clip_length = min(max_seconds, max(min_seconds, min(45.0, duration_seconds)))
    available = max(0.0, duration_seconds - clip_length)
    count = max(1, min(desired_count, math.ceil(duration_seconds / max(clip_length, 1))))
    step = available / max(1, count - 1) if count > 1 else 0
    candidates: list[ClipCandidate] = []
    for index in range(count):
        start = min(available, index * step)
        end = min(duration_seconds, start + clip_length)
        candidates.append(
            ClipCandidate(
                id=str(uuid.uuid4()),
                start_seconds=round(start, 2),
                end_seconds=round(end, 2),
                title=f"Suggested clip {index + 1}",
                score=45.0,
                confidence="experimental",
                reasons=[
                    "Selected from a continuous section of the recording",
                    "Add or correct the caption before exporting",
                ],
                caption_text="",
            )
        )
    return candidates

