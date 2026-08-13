from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


ProjectStatus = Literal[
    "uploading",
    "uploaded",
    "processing",
    "ready",
    "failed",
    "deleting",
]
RenderStatus = Literal["idle", "queued", "rendering", "ready", "failed"]
Confidence = Literal["high", "medium", "experimental"]


class TranscriptSegment(BaseModel):
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    text: str = ""
    confidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def validate_range(self) -> TranscriptSegment:
        if self.end_seconds <= self.start_seconds:
            raise ValueError("segment end must be after start")
        return self


class ClipCandidate(BaseModel):
    id: str
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    title: str
    score: float = Field(ge=0, le=100)
    confidence: Confidence
    reasons: list[str] = Field(default_factory=list)
    caption_text: str = ""
    render_status: RenderStatus = "idle"
    export_url: str | None = None
    render_error: str | None = None

    @model_validator(mode="after")
    def validate_range(self) -> ClipCandidate:
        if self.end_seconds <= self.start_seconds:
            raise ValueError("candidate end must be after start")
        return self

    @property
    def duration_seconds(self) -> float:
        return round(self.end_seconds - self.start_seconds, 2)


class Project(BaseModel):
    id: str
    title: str
    source_filename: str
    source_url: str
    status: ProjectStatus = "uploading"
    stage: str = "Preparing upload"
    progress: int = Field(default=0, ge=0, le=100)
    desired_clips: int = Field(default=5, ge=1, le=12)
    min_clip_seconds: int = Field(default=20, ge=5, le=180)
    max_clip_seconds: int = Field(default=60, ge=10, le=240)
    language: str = "auto"
    rights_confirmed: bool = False
    duration_seconds: float | None = Field(default=None, ge=0)
    width: int | None = None
    height: int | None = None
    analysis_mode: str | None = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    candidates: list[ClipCandidate] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def validate_clip_range(self) -> Project:
        if self.max_clip_seconds <= self.min_clip_seconds:
            raise ValueError("maximum clip length must be greater than minimum")
        return self


class CandidatePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    start_seconds: float | None = Field(default=None, ge=0)
    end_seconds: float | None = Field(default=None, gt=0)
    caption_text: str | None = Field(default=None, max_length=12_000)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    persistence: Literal["json", "postgres"]
    ffmpeg: bool
    transcription_provider: str
