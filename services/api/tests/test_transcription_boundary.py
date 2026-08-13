from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from clipmine_api.config import Settings
from clipmine_api.media import MediaError, transcribe_media


def transcription_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Settings:
    monkeypatch.setenv("CLIPMINE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CLIPMINE_TRANSCRIPTION_PROVIDER", "faster-whisper")
    return Settings.from_env()


def test_native_worker_failure_is_contained(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = transcription_settings(tmp_path, monkeypatch)

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=args[0], returncode=-7, stdout="", stderr=""
        ),
    )

    with pytest.raises(MediaError) as caught:
        transcribe_media(tmp_path / "source.mp4", settings, "auto")

    assert caught.value.code == "TRANSCRIPTION_FAILED"


def test_worker_json_becomes_validated_segments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = transcription_settings(tmp_path, monkeypatch)
    payload = (
        '{"analysis_mode":"faster-whisper:tiny","segments":'
        '[{"start_seconds":0,"end_seconds":2.5,"text":"A complete thought."}]}'
    )

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=args[0], returncode=0, stdout=payload, stderr=""
        ),
    )

    segments, mode = transcribe_media(tmp_path / "source.mp4", settings, "auto")

    assert mode == "faster-whisper:tiny"
    assert len(segments) == 1
    assert segments[0].text == "A complete thought."
