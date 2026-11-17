from pathlib import Path

import pytest

from clipmine_api.config import Settings
from clipmine_api.media import MediaError, _video_filter, write_ass
from clipmine_api.models import TranscriptSegment
from clipmine_api.phone_studio import complete_ending, select_clips


def segment(start, end, text):
    return TranscriptSegment(start_seconds=start, end_seconds=end, text=text)


def test_best_bits_ends_before_dangling_continuation_instead_of_exact_30_seconds():
    speech = [
        segment(0, 5, "Where did your name come from?"),
        segment(5, 14, "My family told me a story about my first words."),
        segment(14, 26.5, "That is how I got the name I use today."),
        segment(26.5, 35, "So, if"),
    ]
    clips = select_clips(35, speech, {30: 5, 60: 0, 90: 0}, "Best bits", 0)
    assert len(clips) == 1  # A short source cannot supply five distinct stories.
    assert clips[0].end == 26.5
    assert clips[0].transcript.endswith("today.")
    assert not complete_ending("So, if.")


def test_best_bits_rejects_unfinished_or_out_of_range_speech():
    assert select_clips(31, [segment(0, 31, "So, if")], {30: 1}, "Best bits", 0) == []
    assert select_clips(30, [segment(0, 40, "A finished sentence.")],
                        {30: 1}, "Best bits", 0) == []


def test_caption_canvas_safe_area_and_real_segment_pauses(tmp_path: Path):
    path = tmp_path / "captions.ass"
    settings = Settings.from_env()
    assert write_ass(path, "", 30, settings, [
        segment(10, 12, "An opening line."), segment(20, 22, "A later line."),
    ], 10)
    contents = path.read_text()
    assert "PlayResX: 720" in contents and "PlayResY: 1280" in contents
    assert "Style: Default,Arial,36," in contents
    assert "0:00:00.00,0:00:02.00" in contents
    assert "0:00:10.00,0:00:12.00" in contents  # Silence is not filled with captions.
    assert "force_original_aspect_ratio=decrease" in _video_filter(settings, path)


def test_timed_captions_cannot_claim_words_outside_clip(tmp_path: Path):
    with pytest.raises(MediaError, match="cross the selected clip boundary"):
        write_ass(tmp_path / "x.ass", "", 10, Settings.from_env(),
                  [segment(5, 15, "Words outside the clip.")], 0)


def test_caption_text_cannot_inject_ass_style_overrides(tmp_path: Path):
    path = tmp_path / "safe.ass"
    write_ass(path, r"{\pos(0,0)} A literal caption.", 3, Settings.from_env())
    assert r"{\pos" not in path.read_text()
