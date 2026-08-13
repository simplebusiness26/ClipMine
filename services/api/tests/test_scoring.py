from clipmine_api.models import TranscriptSegment
from clipmine_api.scoring import generate_candidates, generate_timeline_candidates


def test_transcript_candidates_have_valid_ranges_and_explanations() -> None:
    segments = [
        TranscriptSegment(
            start_seconds=0,
            end_seconds=8,
            text="How do you turn a long recording into something people will watch?",
        ),
        TranscriptSegment(
            start_seconds=8,
            end_seconds=17,
            text="The problem is that the strongest idea is buried in the middle.",
        ),
        TranscriptSegment(
            start_seconds=17,
            end_seconds=26,
            text="You find a complete hook, useful explanation, and a clear ending.",
        ),
        TranscriptSegment(
            start_seconds=26,
            end_seconds=35,
            text="That is why the final clip can stand on its own.",
        ),
    ]

    candidates = generate_candidates(
        segments,
        desired_count=2,
        min_seconds=20,
        max_seconds=35,
    )

    assert candidates
    assert all(candidate.end_seconds > candidate.start_seconds for candidate in candidates)
    assert all(candidate.reasons for candidate in candidates)
    assert candidates[0].caption_text


def test_timeline_fallback_spreads_candidates_across_source() -> None:
    candidates = generate_timeline_candidates(
        duration_seconds=130,
        desired_count=3,
        min_seconds=20,
        max_seconds=60,
    )

    assert len(candidates) == 3
    assert candidates[0].start_seconds == 0
    assert candidates[-1].end_seconds == 130
    assert all(candidate.confidence == "experimental" for candidate in candidates)
