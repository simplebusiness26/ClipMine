import html
import json
import logging
import math
import os
import re
import secrets
import subprocess
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from typing import Annotated, BinaryIO
from zipfile import BadZipFile

from fastapi import Depends, FastAPI, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from highlights import ChatMonitor, Clip, cut_clip, detect_laughter, select_clips

CAPTURE_SECONDS = 600
MIB = 1024 * 1024
DEFAULT_QUALITY = "720p"
HD_STREAMS = "720p60,720p,720p30,480p60,480p,480p30,360p60,360p,360p30"
QUALITY_OPTIONS = {
    "720p": (HD_STREAMS, 500 * MIB),
    "1080p": (
        "1080p60,1080p,1080p30,936p60,936p,936p30,900p60,900p,900p30," + HD_STREAMS,
        650 * MIB,
    ),
}
LOGGER = logging.getLogger(__name__)
BASIC = HTTPBasic(realm="ClipCast recorder")
MODEL_PATH = Path(__file__).with_name("yamnet.tflite")


@dataclass(frozen=True)
class Capture:
    duration: float
    height: int


def capture_mp4(
    url: str,
    output: Path,
    seconds: int = CAPTURE_SECONDS,
    on_progress: Callable[[float], None] | None = None,
    *,
    quality: str,
    max_bytes: int,
) -> Capture:
    """Capture one HLS window and verify its duration and resolution."""
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
        quality,
    ]
    ffmpeg = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
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
        str(max_bytes - 2 * MIB),
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
            with subprocess.Popen(
                ffmpeg,
                stdin=source.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            ) as encoder:
                source.stdout.close()
                progress = Thread(
                    target=report_progress,
                    args=(encoder.stdout, on_progress),
                    daemon=True,
                )
                progress.start()
                try:
                    code = encoder.wait(timeout=seconds + 65)
                except subprocess.TimeoutExpired:
                    encoder.kill()
                    encoder.wait()
                    raise
                finally:
                    progress.join()
                if code:
                    raise subprocess.CalledProcessError(code, "ffmpeg")
        finally:
            if source.poll() is None:
                source.terminate()
                try:
                    source.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    source.kill()

    if output.stat().st_size > max_bytes:
        raise ValueError("Capture exceeds its storage limit")
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=duration:stream=height",
            "-of",
            "json",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    metadata = json.loads(probe.stdout)
    duration = float(metadata.get("format", {}).get("duration", "nan"))
    streams = metadata.get("streams", [])
    height = int(streams[0].get("height", 0)) if streams else 0
    if not math.isfinite(duration) or not 0 < duration <= seconds + 1 or height <= 0:
        raise ValueError("Invalid recording duration or resolution")
    return Capture(duration, height)


def report_progress(
    lines: Iterator[str], callback: Callable[[float], None] | None
) -> None:
    for line in lines:
        key, _, value = line.strip().partition("=")
        if callback and key == "out_time_us" and value.lstrip("-").isdigit():
            callback(int(value) / 1_000_000)


def download_chunks(file: BinaryIO) -> Iterator[bytes]:
    with file:
        while chunk := file.read(256 * 1024):
            yield chunk


def create_app(
    channel: str,
    password: str,
    model: Path = MODEL_PATH,
) -> FastAPI:
    if re.fullmatch(r"[a-zA-Z0-9_]{3,25}", channel) is None:
        raise ValueError("TWITCH_CHANNEL must be one Twitch username")
    if len(password) < 20 or not password.isascii():
        raise ValueError("RECORDER_PASSWORD must be at least 20 ASCII characters")

    csrf = secrets.token_urlsafe(32)
    lock = Lock()
    phase = "idle"
    capture: Capture | None = None
    clips: list[tuple[Clip, Path]] = []
    signal_status = ""
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

    def run_capture(quality: str) -> None:
        nonlocal capture, phase, clips, signal_status
        stream_options, max_bytes = QUALITY_OPTIONS[quality]
        chat = ChatMonitor(channel)
        chat.start()
        try:
            recorded = capture_mp4(
                f"https://www.twitch.tv/{channel}",
                recording,
                on_progress=chat.progress,
                quality=stream_options,
                max_bytes=max_bytes,
            )
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            recording.unlink(missing_ok=True)
            LOGGER.warning("Capture failed (%s)", type(error).__name__)
            with lock:
                phase = "failed"
            return
        finally:
            chat.close()

        with lock:
            capture = recorded
            phase = "analysing"

        audio_status = "Audio checked for laughter."
        try:
            audio = detect_laughter(recording, model)
        except (
            OSError,
            ValueError,
            RuntimeError,
            KeyError,
            BadZipFile,
            subprocess.SubprocessError,
        ) as error:
            # Model/native audio failures must preserve the recording and chat-based clips.
            LOGGER.warning("Laughter analysis unavailable (%s)", type(error).__name__)
            audio = {}
            audio_status = "Audio laughter check was unavailable."

        chat_status = "Twitch chat checked."
        if not chat.connected:
            chat_status = "Twitch chat was unavailable during this capture."
        elif not chat.counts:
            chat_status = "No Twitch chat messages were received during this capture."

        results = []
        candidates = select_clips(recorded.duration, chat.counts, chat.laughter, audio)
        for rank, clip in enumerate(candidates, 1):
            output = recording.with_name(f"highlight-{rank}.mp4")
            try:
                cut_clip(recording, output, clip)
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                output.unlink(missing_ok=True)
                LOGGER.warning("Highlight cut failed (%s)", type(error).__name__)
                continue
            results.append((clip, output))
        if not results and candidates:
            audio_status += (
                " Clip export failed; the original recording is still available."
            )

        with lock:
            clips = results
            signal_status = f"{chat_status} {audio_status}"
            phase = "ready"

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok", "mode": "highlights", "quality_options": "hd"}

    @app.get("/", response_class=HTMLResponse, dependencies=[Depends(authenticate)])
    def home() -> HTMLResponse:
        with lock:
            state, recorded = phase, capture
            matches, signals = list(clips), signal_status
        hidden = f'<input type="hidden" name="token" value="{csrf}">'
        refresh = ""
        if state in ("capturing", "analysing"):
            refresh = '<meta http-equiv="refresh" content="10">'
            status = (
                "Recording the stream and watching chat."
                if state == "capturing"
                else "Finding and cutting highlights."
            )
            body = f'<p role="status">{status} This page refreshes automatically.</p>'
        elif state == "ready" and recorded:
            length = int(recorded.duration)
            length_text = f"{length // 60}:{length % 60:02d}"
            status = "Capture ready" if length >= 595 else "Short capture ready"
            cards = []
            for rank, (clip, _) in enumerate(matches, 1):
                reasons = " · ".join(clip.reasons)
                stamp = f"{clip.start // 60}:{clip.start % 60:02d}"
                cards.append(
                    f"<li><strong>Clip {rank} · {stamp}</strong><br>{html.escape(reasons)}<br>"
                    f'<a href="/clips/{rank}">Download clip {rank}</a></li>'
                )
            result = (
                f"<h2>Best bits</h2><ul>{''.join(cards)}</ul>"
                if cards
                else "<p>No strong highlight signals found in this capture.</p>"
            )
            body = (
                f'<p role="status">{status} · {length_text} · {recorded.height}p source</p>'
                f"{result}<p>{html.escape(signals)}</p>"
                "<details><summary>Original recording</summary>"
                '<a href="/download">Download full recording</a></details>'
                f'<form method="post" action="/clear">{hidden}'
                '<button type="submit">Clear and record again</button></form>'
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
                '<label for="quality">Recording quality</label>'
                '<select id="quality" name="quality">'
                '<option value="720p" selected>720p HD</option>'
                '<option value="1080p">Up to 1080p Full HD</option></select>'
                "<p>Twitch may supply a lower resolution. The result shows what was saved.</p>"
                '<label><input type="checkbox" name="confirm" value="yes" required> '
                "I have permission to capture this stream.</label>"
                '<button type="submit">Record and find clips</button></form>'
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
            "select{font:inherit;padding:.5rem;margin-top:.25rem}"
            "</style></head><body><main><h1>ClipCast recorder</h1>"
            f"<p>Twitch channel <strong>{html.escape(channel)}</strong></p>"
            f"{body}</main></body></html>",
            headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"},
        )

    @app.post("/record", dependencies=[Depends(authenticate)])
    def record(
        token: str = Form(),
        confirm: str = Form(""),
        quality: str = Form(DEFAULT_QUALITY),
    ) -> RedirectResponse:
        nonlocal phase
        authorize_form(token)
        if confirm != "yes":
            raise HTTPException(
                status_code=400, detail="Confirm permission to record first."
            )
        if quality not in QUALITY_OPTIONS:
            raise HTTPException(status_code=400, detail="Choose a recording quality.")
        with lock:
            if phase in ("capturing", "analysing", "ready"):
                raise HTTPException(status_code=409, detail="A capture already exists.")
            phase = "capturing"
            Thread(target=run_capture, args=(quality,), daemon=True).start()
        return RedirectResponse("/", status_code=303)

    def media_response(path: Path, filename: str) -> StreamingResponse:
        file = path.open("rb")
        length = os.fstat(file.fileno()).st_size
        return StreamingResponse(
            download_chunks(file),
            media_type="video/mp4",
            headers={
                "Content-Length": str(length),
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "private, no-store",
            },
        )

    @app.get("/download", dependencies=[Depends(authenticate)])
    def download() -> StreamingResponse:
        with lock:
            if phase != "ready":
                raise HTTPException(status_code=404, detail="No capture to download.")
            return media_response(recording, f"{channel}-capture.mp4")

    @app.get("/clips/{rank}", dependencies=[Depends(authenticate)])
    def download_clip(rank: int) -> StreamingResponse:
        with lock:
            if phase != "ready" or not 1 <= rank <= len(clips):
                raise HTTPException(status_code=404, detail="This clip is unavailable.")
            _, path = clips[rank - 1]
            return media_response(path, f"{channel}-highlight-{rank}.mp4")

    @app.post("/clear", dependencies=[Depends(authenticate)])
    def clear(token: str = Form()) -> RedirectResponse:
        nonlocal capture, phase
        authorize_form(token)
        with lock:
            if phase in ("capturing", "analysing"):
                raise HTTPException(
                    status_code=409, detail="Capture is still recording."
                )
            recording.unlink(missing_ok=True)
            for _, output in clips:
                output.unlink(missing_ok=True)
            clips.clear()
            capture = None
            phase = "idle"
        return RedirectResponse("/", status_code=303)

    return app


def create_render_app() -> FastAPI:
    return create_app(
        os.environ.get("TWITCH_CHANNEL", ""), os.environ.get("RECORDER_PASSWORD", "")
    )
