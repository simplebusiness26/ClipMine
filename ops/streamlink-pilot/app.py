import html
import logging
import math
import os
import re
import secrets
import subprocess
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from typing import Annotated, BinaryIO

from fastapi import Depends, FastAPI, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

CAPTURE_SECONDS = 600
MAX_BYTES = 220 * 1024 * 1024
LOGGER = logging.getLogger(__name__)
BASIC = HTTPBasic(realm="ClipCast recorder")


def capture_mp4(url: str, output: Path, seconds: int = CAPTURE_SECONDS) -> float:
    """Capture one HLS window and return its verified media duration."""
    streamlink = [
        "streamlink",
        "--stdout",
        "--stream-types",
        "hls",
        "--twitch-supported-codecs",
        "h264",
        "--http-timeout",
        "15",
        "--stream-timeout",
        "20",
        "--stream-segmented-duration",
        str(seconds),
        url,
        "480p,360p,worst",
    ]
    ffmpeg = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-t",
        str(seconds),
        "-fs",
        str(MAX_BYTES),
        "-movflags",
        "+faststart",
        str(output),
    ]
    # The FFmpeg reader can finish first when a duration or size limit is reached.
    with subprocess.Popen(
        streamlink,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as source:
        try:
            subprocess.run(
                ffmpeg,
                stdin=source.stdout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=seconds + 65,
            )
        finally:
            if source.poll() is None:
                source.terminate()
                try:
                    source.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    source.kill()

    if output.stat().st_size > MAX_BYTES:
        raise ValueError("Capture exceeds its storage limit")
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    duration = float(probe.stdout.strip())
    if not math.isfinite(duration) or not 0 < duration <= seconds + 1:
        raise ValueError("Invalid recording duration")
    return duration


def download_chunks(file: BinaryIO) -> Iterator[bytes]:
    with file:
        while chunk := file.read(256 * 1024):
            yield chunk


def create_app(channel: str, password: str) -> FastAPI:
    if re.fullmatch(r"[a-zA-Z0-9_]{3,25}", channel) is None:
        raise ValueError("TWITCH_CHANNEL must be one Twitch username")
    if len(password) < 20 or not password.isascii():
        raise ValueError("RECORDER_PASSWORD must be at least 20 ASCII characters")

    csrf = secrets.token_urlsafe(32)
    lock = Lock()
    phase = "idle"
    duration = 0.0
    directory = TemporaryDirectory(prefix="clipcast-capture-")
    recording = Path(directory.name) / "capture.mp4"

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            directory.cleanup()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    def authenticate(
        credentials: Annotated[HTTPBasicCredentials, Depends(BASIC)],
    ) -> None:
        valid_password = secrets.compare_digest(credentials.password, password)
        if credentials.username != "recorder" or not valid_password:
            raise HTTPException(
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="ClipCast recorder"'},
            )

    def authorize_form(token: str) -> None:
        if not secrets.compare_digest(token.encode("utf-8"), csrf.encode("ascii")):
            raise HTTPException(
                status_code=403, detail="Reload the recorder and try again."
            )

    def run_capture() -> None:
        nonlocal duration, phase
        try:
            length = capture_mp4(f"https://www.twitch.tv/{channel}", recording)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            recording.unlink(missing_ok=True)
            LOGGER.warning("Capture failed (%s)", type(error).__name__)
            with lock:
                phase = "failed"
            return
        with lock:
            duration = length
            phase = "ready"

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse, dependencies=[Depends(authenticate)])
    def home() -> HTMLResponse:
        with lock:
            state, length = phase, duration
        hidden = f'<input type="hidden" name="token" value="{csrf}">'
        refresh = ""
        if state == "capturing":
            refresh = '<meta http-equiv="refresh" content="10">'
            body = (
                '<p role="status">Recording now. This page refreshes while it runs.</p>'
            )
        elif state == "ready":
            length_text = f"{int(length) // 60}:{int(length) % 60:02d}"
            status = "Capture ready" if length >= 595 else "Short capture ready"
            body = (
                f'<p role="status">{status} · {length_text}</p>'
                '<p><a href="/download">Download MP4</a></p>'
                f'<form method="post" action="/clear">{hidden}'
                '<button type="submit">Delete capture</button></form>'
            )
        else:
            notice = (
                '<p role="status">No playable recording was saved. '
                "Check that the channel is live and try again.</p>"
                if state == "failed"
                else ""
            )
            body = (
                f'{notice}<form method="post" action="/record">{hidden}'
                '<label><input type="checkbox" name="confirm" value="yes" required> '
                "I have permission to capture this stream.</label>"
                '<button type="submit">Record up to 10 minutes</button></form>'
            )
        return HTMLResponse(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f"{refresh}<title>ClipCast recorder</title><style>"
            "html{color-scheme:dark}body{margin:0;background:#19121f;color:#f7effa;"
            "font:1.05rem/1.55 system-ui,sans-serif}main{max-width:32rem;margin:auto;"
            "padding:2rem 1.25rem}button,main a{min-height:44px;padding:.65rem 1rem;"
            "background:#ffc5a6;color:#241423;border:0;border-radius:.65rem;"
            "font:inherit;font-weight:650;display:inline-flex;align-items:center;"
            "box-sizing:border-box;margin-top:.75rem}label{display:block}"
            "</style></head><body><main><h1>ClipCast recorder</h1>"
            f"<p>Twitch channel <strong>{html.escape(channel)}</strong></p>"
            f"{body}</main></body></html>",
            headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"},
        )

    @app.post("/record", dependencies=[Depends(authenticate)])
    def record(token: str = Form(), confirm: str = Form("")) -> RedirectResponse:
        nonlocal phase
        authorize_form(token)
        if confirm != "yes":
            raise HTTPException(
                status_code=400, detail="Confirm permission to record first."
            )
        with lock:
            if phase in ("capturing", "ready"):
                raise HTTPException(status_code=409, detail="A capture already exists.")
            phase = "capturing"
            Thread(target=run_capture, daemon=True).start()
        return RedirectResponse("/", status_code=303)

    @app.get("/download", dependencies=[Depends(authenticate)])
    def download() -> StreamingResponse:
        with lock:
            if phase != "ready":
                raise HTTPException(status_code=404, detail="No capture to download.")
            file = recording.open("rb")
            length = os.fstat(file.fileno()).st_size
        return StreamingResponse(
            download_chunks(file),
            media_type="video/mp4",
            headers={
                "Content-Length": str(length),
                "Content-Disposition": f'attachment; filename="{channel}-capture.mp4"',
                "Cache-Control": "private, no-store",
            },
        )

    @app.post("/clear", dependencies=[Depends(authenticate)])
    def clear(token: str = Form()) -> RedirectResponse:
        nonlocal phase
        authorize_form(token)
        with lock:
            if phase == "capturing":
                raise HTTPException(
                    status_code=409, detail="Capture is still recording."
                )
            recording.unlink(missing_ok=True)
            phase = "idle"
        return RedirectResponse("/", status_code=303)

    return app


def create_render_app() -> FastAPI:
    return create_app(
        os.environ.get("TWITCH_CHANNEL", ""), os.environ.get("RECORDER_PASSWORD", "")
    )
