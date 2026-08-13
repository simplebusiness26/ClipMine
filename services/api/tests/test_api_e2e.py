from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient


def create_test_video(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=24",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "12",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


def inspect_video(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


async def wait_for_project(
    client: AsyncClient,
    project_id: str,
    predicate: Any,
    wait_seconds: float = 15,
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait_seconds
    latest: dict[str, Any] = {}
    while loop.time() < deadline:
        response = await client.get(f"/api/projects/{project_id}")
        assert response.status_code == 200
        latest = response.json()
        if predicate(latest):
            return latest
        await asyncio.sleep(0.05)
    pytest.fail(f"Timed out waiting for project state: {latest}")


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg is required for the end-to-end media test",
)
@pytest.mark.asyncio
async def test_upload_analyse_edit_render_download_delete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("CLIPMINE_DATABASE_URL", raising=False)
    monkeypatch.setenv("CLIPMINE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("CLIPMINE_STATIC_DIR", str(tmp_path / "missing-static"))
    monkeypatch.setenv("CLIPMINE_TRANSCRIPTION_PROVIDER", "off")
    monkeypatch.setenv("CLIPMINE_RENDER_WIDTH", "180")
    monkeypatch.setenv("CLIPMINE_RENDER_HEIGHT", "320")
    monkeypatch.setenv("CLIPMINE_MAX_UPLOAD_MB", "20")

    from clipmine_api.main import app

    source = tmp_path / "sample.mp4"
    await asyncio.to_thread(create_test_video, source)
    source_bytes = await asyncio.to_thread(source.read_bytes)

    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            health = await client.get("/api/health")
            assert health.status_code == 200
            assert health.json()["persistence"] == "json"
            assert health.json()["ffmpeg"] is True

            rejected = await client.post(
                "/api/projects",
                files={"file": ("sample.mp4", source_bytes, "video/mp4")},
                data={"rights_confirmed": "false"},
            )
            assert rejected.status_code == 400

            created_response = await client.post(
                "/api/projects",
                files={"file": ("sample.mp4", source_bytes, "video/mp4")},
                data={
                    "title": "Synthetic test video",
                    "desired_clips": "2",
                    "min_clip_seconds": "5",
                    "max_clip_seconds": "10",
                    "language": "auto",
                    "rights_confirmed": "true",
                },
            )
            assert created_response.status_code == 202
            project_id = created_response.json()["id"]

            project = await wait_for_project(
                client,
                project_id,
                lambda payload: payload["status"] in {"ready", "failed"},
            )
            assert project["status"] == "ready"
            assert project["analysis_mode"] == "timeline-fallback"
            assert len(project["candidates"]) == 2

            source_response = await client.get(f"/api/projects/{project_id}/source")
            assert source_response.status_code == 200
            assert source_response.headers["content-type"].startswith("video/mp4")

            candidate = project["candidates"][0]
            candidate_id = candidate["id"]
            patch_response = await client.patch(
                f"/api/projects/{project_id}/candidates/{candidate_id}",
                json={
                    "title": "A useful test clip",
                    "start_seconds": 0,
                    "end_seconds": 6,
                    "caption_text": "A complete caption rendered by ClipMine.",
                },
            )
            assert patch_response.status_code == 200

            render_response = await client.post(
                f"/api/projects/{project_id}/candidates/{candidate_id}/render"
            )
            assert render_response.status_code == 202

            rendered = await wait_for_project(
                client,
                project_id,
                lambda payload: payload["candidates"][0]["render_status"]
                in {"ready", "failed"},
                wait_seconds=30,
            )
            rendered_candidate = rendered["candidates"][0]
            assert rendered_candidate["render_status"] == "ready"

            download = await client.get(rendered_candidate["export_url"])
            assert download.status_code == 200
            assert download.headers["content-type"].startswith("video/mp4")
            assert len(download.content) > 1_000

            output_path = tmp_path / "rendered.mp4"
            await asyncio.to_thread(output_path.write_bytes, download.content)
            output = await asyncio.to_thread(inspect_video, output_path)
            video_stream = next(
                stream
                for stream in output["streams"]
                if stream.get("codec_type") == "video"
            )
            assert video_stream["codec_name"] == "h264"
            assert (video_stream["width"], video_stream["height"]) == (180, 320)
            assert 5.8 <= float(output["format"]["duration"]) <= 6.2

            delete_response = await client.delete(f"/api/projects/{project_id}")
            assert delete_response.status_code == 204
            get_deleted = await client.get(f"/api/projects/{project_id}")
            assert get_deleted.status_code == 404
            assert not (tmp_path / "data" / "projects" / project_id).exists()
