from __future__ import annotations

import json
import logging
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from .config import Settings
from .models import TranscriptSegment

logger = logging.getLogger(__name__)


class MediaError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _run(command: list[str], timeout: int = 900) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise MediaError(
            "MEDIA_TOOL_MISSING", f"Required media tool is missing: {command[0]}"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(
            "MEDIA_TIMEOUT", "Media processing took too long and was stopped."
        ) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip().splitlines()
        safe_detail = detail[-1][:240] if detail else "Unknown FFmpeg error"
        raise MediaError("MEDIA_PROCESSING_FAILED", safe_detail) from exc


def probe_media(path: Path, settings: Settings) -> dict[str, Any]:
    result = _run(
        [
            settings.ffprobe_binary,
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        timeout=60,
    )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise MediaError("MEDIA_CORRUPT", "The video metadata could not be read.") from exc

    video = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"),
        None,
    )
    if not video:
        raise MediaError("MEDIA_UNSUPPORTED", "The uploaded file does not contain a video stream.")

    raw_duration = payload.get("format", {}).get("duration") or video.get("duration")
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError) as exc:
        raise MediaError("MEDIA_CORRUPT", "The video's duration could not be read.") from exc

    if duration <= 0:
        raise MediaError("MEDIA_CORRUPT", "The uploaded video has no playable duration.")
    if duration > settings.max_source_seconds:
        minutes = settings.max_source_seconds // 60
        raise MediaError(
            "MEDIA_TOO_LONG", f"This MVP currently accepts videos up to {minutes} minutes."
        )

    return {
        "duration_seconds": round(duration, 2),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "video_codec": video.get("codec_name"),
        "has_audio": any(
            stream.get("codec_type") == "audio" for stream in payload.get("streams", [])
        ),
    }


def transcribe_media(
    path: Path, settings: Settings, language: str
) -> tuple[list[TranscriptSegment], str]:
    if settings.transcription_provider in {"off", "disabled", "none"}:
        return [], "timeline-fallback"
    if settings.transcription_provider != "faster-whisper":
        raise MediaError(
            "TRANSCRIPTION_PROVIDER_UNKNOWN",
            f"Unsupported transcription provider: {settings.transcription_provider}",
        )

    try:
        worker = Path(__file__).with_name("transcribe_worker.py")
        result = subprocess.run(
            [
                sys.executable,
                str(worker),
                "--source",
                str(path),
                "--model",
                settings.whisper_model,
                "--device",
                settings.whisper_device,
                "--compute-type",
                settings.whisper_compute_type,
                "--language",
                language,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=3600,
        )
        if result.returncode != 0:
            logger.warning("Transcription worker exited with code %s", result.returncode)
            raise MediaError(
                "TRANSCRIPTION_FAILED",
                "Local transcription stopped; timeline suggestions were used instead.",
            )
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        if not lines:
            raise ValueError("transcription worker returned no output")
        payload = json.loads(lines[-1])
        segments = [
            TranscriptSegment.model_validate(item) for item in payload.get("segments", [])
        ]
        return segments, str(
            payload.get("analysis_mode") or f"faster-whisper:{settings.whisper_model}"
        )
    except FileNotFoundError as exc:
        raise MediaError(
            "TRANSCRIPTION_UNAVAILABLE",
            "Local transcription is not installed; timeline suggestions were used instead.",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(
            "TRANSCRIPTION_FAILED",
            "Local transcription timed out; timeline suggestions were used instead.",
        ) from exc
    except MediaError:
        raise
    except Exception as exc:
        raise MediaError(
            "TRANSCRIPTION_FAILED",
            "Local transcription failed; timeline suggestions were used instead.",
        ) from exc


def _srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def _caption_groups(text: str, duration: float) -> list[tuple[float, float, str]]:
    safe_text = re.sub(r"[<>]", "", text).replace("{", "(").replace("}", ")")
    words = safe_text.split()
    if not words:
        return []
    groups = [words[index : index + 7] for index in range(0, len(words), 7)]
    slot = duration / len(groups)
    return [
        (index * slot, min(duration, (index + 1) * slot), " ".join(group))
        for index, group in enumerate(groups)
    ]


def write_srt(path: Path, text: str, duration: float) -> bool:
    groups = _caption_groups(text, duration)
    if not groups:
        return False
    blocks = []
    for index, (start, end, caption) in enumerate(groups, start=1):
        blocks.append(
            f"{index}\n{_srt_timestamp(start)} --> {_srt_timestamp(end)}\n{caption}\n"
        )
    path.write_text("\n".join(blocks), encoding="utf-8")
    return True


def _video_filter(settings: Settings, srt_path: Path | None) -> str:
    width = settings.render_width
    height = settings.render_height
    base = (
        f"[0:v]split=2[background][foreground];"
        f"[background]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},boxblur=20:1[bg];"
        f"[foreground]scale={width}:{height}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p"
    )
    if not srt_path:
        return base + "[v]"
    escaped = str(srt_path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    style = (
        "FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00111111,BorderStyle=1,Outline=3,Shadow=1,"
        "Alignment=2,MarginV=90"
    )
    return base + f",subtitles='{escaped}':force_style='{style}'[v]"


def render_vertical_clip(
    source_path: Path,
    output_path: Path,
    start_seconds: float,
    end_seconds: float,
    caption_text: str,
    settings: Settings,
) -> bool:
    duration = end_seconds - start_seconds
    if duration <= 0:
        raise MediaError("RENDER_RANGE_INVALID", "The clip end must be after its start.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    srt_path = output_path.with_suffix(".srt")
    has_captions = write_srt(srt_path, caption_text, duration)

    command = [
        settings.ffmpeg_binary,
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        str(source_path),
        "-t",
        f"{duration:.3f}",
        "-filter_complex",
        _video_filter(settings, srt_path if has_captions else None),
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-shortest",
        str(output_path),
    ]
    try:
        _run(command, timeout=max(300, int(duration * 15)))
    finally:
        srt_path.unlink(missing_ok=True)
    return has_captions
