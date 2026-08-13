from __future__ import annotations

import logging
import shutil
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .models import CandidatePatch, HealthResponse, Project
from .pipeline import PipelineManager
from .store import ProjectStore, create_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
SOURCE_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = create_store(settings)
    await store.initialise()
    pipeline = PipelineManager(settings, store)
    app.state.settings = settings
    app.state.store = store
    app.state.pipeline = pipeline
    await pipeline.resume_pending()
    logger.info("ClipMine started with %s persistence", store.kind)
    try:
        yield
    finally:
        await store.close()


app = FastAPI(
    title="ClipMine API",
    version="0.1.0",
    description="Database-optional MVP API for turning long video into short-form drafts.",
    lifespan=lifespan,
)

startup_settings = Settings.from_env()
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(startup_settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


def _store(request: Request) -> ProjectStore:
    return request.app.state.store


def _pipeline(request: Request) -> PipelineManager:
    return request.app.state.pipeline


async def _project_or_404(request: Request, project_id: str) -> Project:
    project = await _store(request).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/api/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings: Settings = request.app.state.settings
    return HealthResponse(
        persistence=_store(request).kind,  # type: ignore[arg-type]
        ffmpeg=shutil.which(settings.ffmpeg_binary) is not None,
        transcription_provider=settings.transcription_provider,
    )


@app.get("/api/config")
async def public_config(request: Request) -> dict[str, object]:
    settings: Settings = request.app.state.settings
    return {
        "persistence": _store(request).kind,
        "database_connected": _store(request).kind == "postgres",
        "max_upload_mb": settings.max_upload_bytes // 1024 // 1024,
        "max_source_minutes": settings.max_source_seconds // 60,
        "transcription_provider": settings.transcription_provider,
        "render_size": [settings.render_width, settings.render_height],
        "authentication": "private-mvp",
    }


@app.get("/api/projects", response_model=list[Project])
async def list_projects(request: Request) -> list[Project]:
    return await _store(request).list()


@app.post("/api/projects", response_model=Project, status_code=202)
async def create_project(
    request: Request,
    file: Annotated[UploadFile, File()],
    rights_confirmed: Annotated[bool, Form()],
    title: Annotated[str, Form()] = "",
    desired_clips: Annotated[int, Form(ge=1, le=12)] = 5,
    min_clip_seconds: Annotated[int, Form(ge=5, le=180)] = 20,
    max_clip_seconds: Annotated[int, Form(ge=10, le=240)] = 60,
    language: Annotated[str, Form()] = "auto",
) -> Project:
    if not rights_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Confirm that you are authorised to process and republish this video.",
        )
    if max_clip_seconds <= min_clip_seconds:
        raise HTTPException(
            status_code=400, detail="Maximum clip length must be greater than minimum."
        )
    original_name = Path(file.filename or "video.mp4").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="Use an MP4, MOV, M4V or WebM video for this MVP.",
        )

    project_id = str(uuid.uuid4())
    safe_source_name = f"source{extension}"
    project = Project(
        id=project_id,
        title=(title.strip() or Path(original_name).stem)[:120],
        source_filename=safe_source_name,
        source_url=f"/api/projects/{project_id}/source",
        status="uploading",
        stage="Receiving video",
        progress=2,
        desired_clips=desired_clips,
        min_clip_seconds=min_clip_seconds,
        max_clip_seconds=max_clip_seconds,
        language=language.strip() or "auto",
        rights_confirmed=True,
    )

    pipeline = _pipeline(request)
    source_dir = pipeline.project_dir(project_id) / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_path = source_dir / safe_source_name
    settings: Settings = request.app.state.settings
    written = 0
    try:
        async with aiofiles.open(source_path, "wb") as destination:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"This file exceeds the {settings.max_upload_bytes // 1024 // 1024} MB "
                            "MVP upload limit."
                        ),
                    )
                await destination.write(chunk)
        if written == 0:
            raise HTTPException(status_code=400, detail="The uploaded video is empty.")
    except Exception:
        source_path.unlink(missing_ok=True)
        shutil.rmtree(pipeline.project_dir(project_id), ignore_errors=True)
        raise
    finally:
        await file.close()

    project.status = "uploaded"
    project.stage = "Queued for analysis"
    project.progress = 5
    await _store(request).save(project)
    pipeline.enqueue_processing(project_id)
    return project


@app.get("/api/projects/{project_id}", response_model=Project)
async def get_project(request: Request, project_id: str) -> Project:
    return await _project_or_404(request, project_id)


@app.post("/api/projects/{project_id}/retry", response_model=Project, status_code=202)
async def retry_project(request: Request, project_id: str) -> Project:
    project = await _project_or_404(request, project_id)
    if project.status not in {"failed", "ready"}:
        raise HTTPException(status_code=409, detail="This project cannot be retried right now.")
    project.status = "uploaded"
    project.stage = "Queued for analysis"
    project.progress = 5
    project.error_code = None
    project.error_message = None
    await _store(request).save(project)
    _pipeline(request).enqueue_processing(project_id)
    return project


@app.patch(
    "/api/projects/{project_id}/candidates/{candidate_id}", response_model=Project
)
async def update_candidate(
    request: Request, project_id: str, candidate_id: str, patch: CandidatePatch
) -> Project:
    project = await _project_or_404(request, project_id)
    candidate = next((item for item in project.candidates if item.id == candidate_id), None)
    if not candidate:
        raise HTTPException(status_code=404, detail="Clip suggestion not found")

    values = patch.model_dump(exclude_none=True)
    start = float(values.get("start_seconds", candidate.start_seconds))
    end = float(values.get("end_seconds", candidate.end_seconds))
    if end <= start:
        raise HTTPException(status_code=400, detail="Clip end must be after its start.")
    if end - start > 240:
        raise HTTPException(status_code=400, detail="A clip can be at most four minutes.")
    if project.duration_seconds and end > project.duration_seconds + 0.05:
        raise HTTPException(status_code=400, detail="Clip end is outside the source video.")

    for name, value in values.items():
        setattr(candidate, name, value)
    candidate.render_status = "idle"
    candidate.export_url = None
    candidate.render_error = None
    await _store(request).save(project)
    return project


@app.post(
    "/api/projects/{project_id}/candidates/{candidate_id}/render",
    response_model=Project,
    status_code=202,
)
async def render_candidate(request: Request, project_id: str, candidate_id: str) -> Project:
    project = await _project_or_404(request, project_id)
    candidate = next((item for item in project.candidates if item.id == candidate_id), None)
    if not candidate:
        raise HTTPException(status_code=404, detail="Clip suggestion not found")
    if candidate.render_status in {"queued", "rendering"}:
        return project
    candidate.render_status = "queued"
    candidate.render_error = None
    await _store(request).save(project)
    _pipeline(request).enqueue_render(project_id, candidate_id)
    return project


@app.get("/api/projects/{project_id}/source")
async def project_source(request: Request, project_id: str) -> Response:
    project = await _project_or_404(request, project_id)
    path = _pipeline(request).source_path(project)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Source video is unavailable")
    media_type = SOURCE_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-store"})


@app.get("/api/projects/{project_id}/candidates/{candidate_id}/download")
async def download_candidate(request: Request, project_id: str, candidate_id: str) -> Response:
    project = await _project_or_404(request, project_id)
    candidate = next((item for item in project.candidates if item.id == candidate_id), None)
    if not candidate or candidate.render_status != "ready":
        raise HTTPException(status_code=404, detail="Rendered clip is not ready")
    path = _pipeline(request).export_path(project_id, candidate_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Rendered clip file is unavailable")
    safe_title = "".join(
        character
        for character in candidate.title
        if character.isalnum() or character in " -_"
    )
    filename = f"{safe_title.strip() or 'clipmine-clip'}.mp4"
    return FileResponse(path, media_type="video/mp4", filename=filename)


@app.delete("/api/projects/{project_id}", status_code=204)
async def delete_project(request: Request, project_id: str) -> Response:
    await _project_or_404(request, project_id)
    await _pipeline(request).delete_project(project_id)
    return Response(status_code=204)


static_dir = startup_settings.static_dir
if static_dir.exists():
    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> Response:
        requested = (static_dir / full_path).resolve()
        if requested.is_file() and static_dir in requested.parents:
            return FileResponse(requested)
        index = static_dir / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Web application is not built")
