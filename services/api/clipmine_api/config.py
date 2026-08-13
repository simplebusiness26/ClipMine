from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value else default


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    static_dir: Path
    database_url: str | None
    cors_origins: tuple[str, ...]
    max_upload_bytes: int
    max_source_seconds: int
    worker_concurrency: int
    transcription_provider: str
    whisper_model: str
    whisper_device: str
    whisper_compute_type: str
    render_width: int
    render_height: int
    ffmpeg_binary: str
    ffprobe_binary: str

    @classmethod
    def from_env(cls) -> Settings:
        database_url = os.getenv("DATABASE_URL") or os.getenv("CLIPMINE_DATABASE_URL")
        origins = tuple(
            item.strip()
            for item in os.getenv(
                "CLIPMINE_CORS_ORIGINS", "http://localhost:5173,http://localhost:8000"
            ).split(",")
            if item.strip()
        )
        return cls(
            data_dir=Path(os.getenv("CLIPMINE_DATA_DIR", "data")).resolve(),
            static_dir=Path(os.getenv("CLIPMINE_STATIC_DIR", "static")).resolve(),
            database_url=database_url,
            cors_origins=origins,
            max_upload_bytes=_env_int("CLIPMINE_MAX_UPLOAD_MB", 1024) * 1024 * 1024,
            max_source_seconds=_env_int("CLIPMINE_MAX_SOURCE_MINUTES", 180) * 60,
            worker_concurrency=max(1, _env_int("CLIPMINE_WORKER_CONCURRENCY", 1)),
            transcription_provider=os.getenv(
                "CLIPMINE_TRANSCRIPTION_PROVIDER", "faster-whisper"
            ),
            whisper_model=os.getenv("CLIPMINE_WHISPER_MODEL", "tiny"),
            whisper_device=os.getenv("CLIPMINE_WHISPER_DEVICE", "cpu"),
            whisper_compute_type=os.getenv("CLIPMINE_WHISPER_COMPUTE_TYPE", "int8"),
            render_width=_env_int("CLIPMINE_RENDER_WIDTH", 720),
            render_height=_env_int("CLIPMINE_RENDER_HEIGHT", 1280),
            ffmpeg_binary=os.getenv("CLIPMINE_FFMPEG_BINARY", "ffmpeg"),
            ffprobe_binary=os.getenv("CLIPMINE_FFPROBE_BINARY", "ffprobe"),
        )
