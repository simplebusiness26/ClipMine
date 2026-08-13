from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

from .config import Settings
from .media import MediaError, probe_media, render_vertical_clip, transcribe_media
from .models import Project
from .scoring import generate_candidates, generate_timeline_candidates
from .store import ProjectStore

logger = logging.getLogger(__name__)


class PipelineManager:
    def __init__(self, settings: Settings, store: ProjectStore) -> None:
        self.settings = settings
        self.store = store
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._semaphore = asyncio.Semaphore(settings.worker_concurrency)

    def project_dir(self, project_id: str) -> Path:
        return self.settings.data_dir / "projects" / project_id

    def source_path(self, project: Project) -> Path:
        return self.project_dir(project.id) / "source" / project.source_filename

    def export_path(self, project_id: str, candidate_id: str) -> Path:
        return self.project_dir(project_id) / "exports" / f"{candidate_id}.mp4"

    async def resume_pending(self) -> None:
        for project in await self.store.list():
            if project.status in {"uploaded", "processing"}:
                self.enqueue_processing(project.id)
            for candidate in project.candidates:
                if candidate.render_status in {"queued", "rendering"}:
                    candidate.render_status = "idle"
            await self.store.save(project)

    def enqueue_processing(self, project_id: str) -> None:
        key = f"process:{project_id}"
        if key not in self._tasks or self._tasks[key].done():
            self._tasks[key] = asyncio.create_task(self._process(key, project_id))

    def enqueue_render(self, project_id: str, candidate_id: str) -> None:
        key = f"render:{project_id}:{candidate_id}"
        if key not in self._tasks or self._tasks[key].done():
            self._tasks[key] = asyncio.create_task(
                self._render(key, project_id, candidate_id)
            )

    async def _save_stage(
        self, project: Project, stage: str, progress: int, status: str = "processing"
    ) -> None:
        project.stage = stage
        project.progress = progress
        project.status = status  # type: ignore[assignment]
        project.error_code = None
        project.error_message = None
        await self.store.save(project)

    async def _process(self, key: str, project_id: str) -> None:
        async with self._semaphore:
            project = await self.store.get(project_id)
            if not project:
                return
            try:
                source = self.source_path(project)
                await self._save_stage(project, "Inspecting video", 10)
                metadata = await asyncio.to_thread(probe_media, source, self.settings)
                project.duration_seconds = metadata["duration_seconds"]
                project.width = metadata["width"]
                project.height = metadata["height"]
                await self.store.save(project)

                await self._save_stage(project, "Transcribing speech", 35)
                try:
                    segments, analysis_mode = await asyncio.to_thread(
                        transcribe_media, source, self.settings, project.language
                    )
                except MediaError as transcription_error:
                    logger.warning(
                        "Transcription fallback for project %s: %s",
                        project_id,
                        transcription_error.code,
                    )
                    segments, analysis_mode = [], "timeline-fallback"

                project.transcript_segments = segments
                project.analysis_mode = analysis_mode
                await self._save_stage(project, "Finding the strongest moments", 72)

                candidates = generate_candidates(
                    segments,
                    project.desired_clips,
                    project.min_clip_seconds,
                    project.max_clip_seconds,
                )
                if not candidates:
                    candidates = generate_timeline_candidates(
                        project.duration_seconds,
                        project.desired_clips,
                        project.min_clip_seconds,
                        project.max_clip_seconds,
                    )
                    project.analysis_mode = "timeline-fallback"

                project.candidates = candidates
                project.status = "ready"
                project.stage = "Ready to review"
                project.progress = 100
                await self.store.save(project)
            except MediaError as exc:
                project.status = "failed"
                project.stage = "Needs attention"
                project.error_code = exc.code
                project.error_message = exc.message
                await self.store.save(project)
            except Exception:
                logger.exception("Unexpected processing error for project %s", project_id)
                project.status = "failed"
                project.stage = "Needs attention"
                project.error_code = "INTERNAL_ERROR"
                project.error_message = "ClipMine could not finish this video. Please retry."
                await self.store.save(project)
            finally:
                self._tasks.pop(key, None)

    async def _render(self, key: str, project_id: str, candidate_id: str) -> None:
        async with self._semaphore:
            project = await self.store.get(project_id)
            if not project:
                return
            candidate = next(
                (item for item in project.candidates if item.id == candidate_id), None
            )
            if not candidate:
                return
            try:
                candidate.render_status = "rendering"
                candidate.render_error = None
                await self.store.save(project)
                await asyncio.to_thread(
                    render_vertical_clip,
                    self.source_path(project),
                    self.export_path(project_id, candidate_id),
                    candidate.start_seconds,
                    candidate.end_seconds,
                    candidate.caption_text,
                    self.settings,
                )
                candidate.render_status = "ready"
                candidate.export_url = (
                    f"/api/projects/{project_id}/candidates/{candidate_id}/download"
                )
                await self.store.save(project)
            except MediaError as exc:
                candidate.render_status = "failed"
                candidate.render_error = exc.message
                await self.store.save(project)
            except Exception:
                logger.exception("Unexpected render error for %s", candidate_id)
                candidate.render_status = "failed"
                candidate.render_error = "ClipMine could not render this clip. Please retry."
                await self.store.save(project)
            finally:
                self._tasks.pop(key, None)

    async def delete_project(self, project_id: str) -> None:
        for key, task in list(self._tasks.items()):
            if project_id in key:
                task.cancel()
                self._tasks.pop(key, None)
        await self.store.delete(project_id)
        directory = self.project_dir(project_id)
        if directory.exists():
            await asyncio.to_thread(shutil.rmtree, directory, True)

