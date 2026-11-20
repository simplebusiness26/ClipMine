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
from dataclasses import dataclass, field
from pathlib import Path
from shutil import rmtree
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from typing import Annotated, BinaryIO
from zipfile import BadZipFile

from fastapi import Depends, FastAPI, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from highlights import ChatMonitor, Clip, cut_clip, detect_laughter, select_clips
from scoop.render import CROP, SCRIPT_CHOICES, choose_script, render_scoop

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


MAX_ACTIVE = 2
MAX_RUNS = 3
HANDLE = re.compile(r"[a-z0-9_]{3,25}", re.ASCII)
BUSY = {"capturing", "analysing"}


@dataclass
class Highlight:
    clip: Clip
    path: Path
    phase: str = ""
    script: str = ""
    crop: str = "center"


@dataclass
class Recording:
    key: str
    channel: str
    path: Path
    phase: str = "capturing"
    capture: Capture | None = None
    highlights: list[Highlight] = field(default_factory=list)
    signals: str = ""


def channels_from_input(names: str) -> list[str]:
    handles = [
        part.removeprefix("@").lower()
        for part in re.split(r"[,\s]+", names.strip())
        if part
    ]
    if not handles or not all(HANDLE.fullmatch(name) for name in handles):
        raise ValueError(
            "Enter Twitch usernames such as clix, using commas between names."
        )
    return list(dict.fromkeys(handles))


def create_app(
    channel: str,
    password: str,
    model: Path = MODEL_PATH,
) -> FastAPI:
    default_channels = channels_from_input(channel)
    if len(default_channels) > MAX_ACTIVE:
        raise ValueError("TWITCH_CHANNEL can prefill up to two usernames")
    if len(password) < 20 or not password.isascii():
        raise ValueError("RECORDER_PASSWORD must be at least 20 ASCII characters")

    csrf = secrets.token_urlsafe(32)
    state = Lock()
    processor = Lock()
    work = TemporaryDirectory(prefix="clipcast-capture-")
    jobs: dict[str, Recording] = {}
    selected_channels = default_channels
    selected_quality = DEFAULT_QUALITY

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            work.cleanup()

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

    def run_capture(job: Recording, quality: str) -> None:
        stream_options, max_bytes = QUALITY_OPTIONS[quality]
        chat = ChatMonitor(job.channel)
        chat.start()
        try:
            recorded = capture_mp4(
                f"https://www.twitch.tv/{job.channel}",
                job.path,
                on_progress=chat.progress,
                quality=stream_options,
                max_bytes=max_bytes,
            )
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            job.path.unlink(missing_ok=True)
            LOGGER.warning("Capture failed (%s)", type(error).__name__)
            with state:
                job.phase = "failed"
            return
        finally:
            chat.close()

        with state:
            job.capture = recorded
            job.phase = "analysing"

        # Serialize audio analysis and branded encodes on Render's small free instance.
        audio_status = "Audio checked for laughter."
        with processor:
            try:
                audio = detect_laughter(job.path, model)
            except (
                OSError,
                ValueError,
                RuntimeError,
                KeyError,
                BadZipFile,
                subprocess.SubprocessError,
            ) as error:
                LOGGER.warning(
                    "Laughter analysis unavailable (%s)", type(error).__name__
                )
                audio = {}
                audio_status = "Audio laughter check was unavailable."

            chat_status = "Twitch chat checked."
            if not chat.connected:
                chat_status = "Twitch chat was unavailable during this capture."
            elif not chat.counts:
                chat_status = (
                    "No Twitch chat messages were received during this capture."
                )

            results = []
            candidates = select_clips(
                recorded.duration, chat.counts, chat.laughter, audio
            )
            for rank, clip in enumerate(candidates, 1):
                output = job.path.with_name(f"highlight-{rank}.mp4")
                try:
                    cut_clip(job.path, output, clip)
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    output.unlink(missing_ok=True)
                    LOGGER.warning("Highlight cut failed (%s)", type(error).__name__)
                    continue
                results.append(
                    Highlight(clip, output, script=choose_script(clip.reasons))
                )
            if not results and candidates:
                audio_status += (
                    " Clip export failed. The original recording is still available."
                )

        with state:
            job.highlights = results
            job.signals = f"{chat_status} {audio_status}"
            job.phase = "ready"

    def run_scoop(highlight: Highlight, output: Path, script: str, crop: str) -> None:
        phase = "ready"
        candidate = output.with_suffix(".pending.mp4")
        try:
            with processor:
                with state:
                    highlight.phase = "rendering"
                render_scoop(highlight.path, candidate, script, crop)
                candidate.replace(output)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            candidate.unlink(missing_ok=True)
            LOGGER.warning("Scoop export failed (%s)", type(error).__name__)
            phase = "failed"
        with state:
            highlight.phase = phase

    def get_job(key: str) -> Recording:
        job = jobs.get(key)
        if job is None:
            raise HTTPException(
                status_code=404, detail="This recording was cleared or expired."
            )
        return job

    def get_highlight(job: Recording, rank: int) -> Highlight:
        if not 1 <= rank <= len(job.highlights):
            raise HTTPException(status_code=404, detail="This clip is unavailable.")
        return job.highlights[rank - 1]

    def scoop_path(highlight: Highlight) -> Path:
        return highlight.path.with_name(f"scoop-{highlight.path.name}")

    @app.get("/healthz")
    def health() -> dict[str, str | int]:
        return {
            "status": "ok",
            "mode": "highlights",
            "quality_options": "hd",
            "capture_slots": MAX_ACTIVE,
            "scoop": "standing",
        }

    hidden = f'<input type="hidden" name="token" value="{csrf}">'

    def job_card(job: Recording) -> str:
        channel_name = html.escape(job.channel)
        actions = f'<form method="post" action="/jobs/{job.key}/clear">{hidden}'
        actions += '<button class="secondary" type="submit">Clear this recording</button></form>'
        if job.phase == "capturing":
            return f"<section><h2>{channel_name}</h2><p>Recording and watching chat…</p></section>"
        if job.phase == "analysing":
            return f"<section><h2>{channel_name}</h2><p>Finding and cutting highlights…</p></section>"
        if job.phase == "failed":
            return (
                f"<section><h2>{channel_name}</h2><p>No playable recording was saved. "
                f"Check that the channel is live and its video is available.</p>{actions}</section>"
            )

        assert job.capture is not None
        length = int(job.capture.duration)
        length_text = f"{length // 60}:{length % 60:02d}"
        cards = []
        for rank, highlight in enumerate(job.highlights, 1):
            clip = highlight.clip
            reasons = " · ".join(clip.reasons)
            stamp = f"{clip.start // 60}:{clip.start % 60:02d}"
            base = f"/jobs/{job.key}/clips/{rank}"
            scoop_status = {
                "queued": '<p role="status">Scoop is waiting to render.</p>',
                "rendering": '<p role="status">Making the Scoop version…</p>',
                "failed": "<p>Scoop export failed. Your original highlight is ready.</p>",
            }.get(highlight.phase, "")
            has_scoop = scoop_path(highlight).is_file()
            if has_scoop:
                scoop_status += f'<a href="{base}/scoop">Download Scoop MP4</a>'
            scoop_form = ""
            if highlight.phase not in ("queued", "rendering"):
                scripts = []
                for key, (name, hook, punchline) in SCRIPT_CHOICES.items():
                    selected = " checked" if key == highlight.script else ""
                    scripts.append(
                        f'<label><input type="radio" name="script" value="{key}"{selected}> '
                        f"<strong>{html.escape(name)}</strong><small>{html.escape(hook)} "
                        f"{html.escape(punchline)}</small></label>"
                    )
                framing = []
                for key, name in (
                    ("center", "Centre"),
                    ("left", "Left"),
                    ("right", "Right"),
                ):
                    selected = " selected" if key == highlight.crop else ""
                    framing.append(f'<option value="{key}"{selected}>{name}</option>')
                action = "Redo Scoop version" if has_scoop else "Make Scoop version"
                scoop_form = (
                    f'<form method="post" action="{base}/scoop">{hidden}'
                    "<details><summary>Scoop lines and framing</summary>"
                    f"{''.join(scripts)}"
                    '<label>Gameplay framing <select name="crop">'
                    f"{''.join(framing)}</select></label></details>"
                    f'<button type="submit">{action}</button></form>'
                )
            cards.append(
                f"<li><strong>Clip {rank} · {stamp}</strong><p>{html.escape(reasons)}</p>"
                f'<a class="secondary" href="{base}">Download highlight</a>'
                f"{scoop_status}{scoop_form}</li>"
            )
        result = (
            f"<h3>Best bits</h3><ol>{''.join(cards)}</ol>"
            if cards
            else "<p>No strong highlight signals found in this capture.</p>"
        )
        if any(item.phase in ("queued", "rendering") for item in job.highlights):
            actions = ""
        return (
            f"<section><h2>{channel_name}</h2><p>Capture ready · {length_text} · "
            f"{job.capture.height}p source</p>{result}<p>{html.escape(job.signals)}</p>"
            "<details><summary>Original recording</summary>"
            f'<a class="secondary" href="/jobs/{job.key}/original">Download full recording</a>'
            f"</details>{actions}</section>"
        )

    def show_home(error: str = "", status: int = 200) -> HTMLResponse:
        # This handler is also used with a fixed message for invalid form submissions.
        with state:
            active = sum(job.phase in BUSY for job in jobs.values())
            refresh = bool(active) or any(
                item.phase in ("queued", "rendering")
                for job in jobs.values()
                for item in job.highlights
            )
            cards = "".join(job_card(job) for job in reversed(list(jobs.values())))
            form_channels = html.escape(", ".join(selected_channels), quote=True)
            quality = selected_quality
        notice = f'<p role="alert">{html.escape(error)}</p>' if error else ""
        script = ""
        if refresh:
            script = (
                "<script>setInterval(() => {"
                'if (!document.activeElement.closest("form")) {'
                'if (location.pathname === "/") location.reload(); else location.replace("/");}'
                "}, 10000);</script>"
            )
        options = "".join(
            f'<option value="{value}"{" selected" if value == quality else ""}>{title}</option>'
            for value, title in (("720p", "720p HD"), ("1080p", "Up to 1080p Full HD"))
        )
        return HTMLResponse(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            "<title>ClipCast recorder</title><style>"
            "html{color-scheme:dark}body{margin:0;background:#19121f;color:#f7effa;"
            "font:1.05rem/1.55 system-ui,sans-serif}main{max-width:34rem;margin:auto;"
            "padding:1.5rem 1.25rem}h1,h2,h3,p{margin:.55rem 0}h1{line-height:1.15}"
            "section{background:#251b2e;border:1px solid #513951;border-radius:.85rem;"
            "padding:1rem;margin:1.25rem 0}button,main a{min-height:44px;padding:.65rem .9rem;"
            "background:#ffc5a6;color:#241423;border:0;border-radius:.65rem;font:inherit;"
            "font-weight:650;display:inline-flex;align-items:center;text-decoration:none;"
            "box-sizing:border-box;margin:.3rem .25rem .3rem 0}button:disabled{opacity:.5}"
            ".secondary{background:#49324d;color:#fff4ed}label,small{display:block}"
            "input[type=text],select{font:inherit;padding:.48rem;margin:.15rem 0 .6rem;"
            "border:1px solid #896c89;border-radius:.35rem;max-width:100%;box-sizing:border-box}"
            "input[type=text]{display:block;width:100%}input[type=checkbox],input[type=radio]{"
            "accent-color:#ffc5a6}ol{list-style:none;padding:0;margin:0}li{padding:.7rem 0;"
            "border-top:1px solid #513951}details{margin:.6rem 0}details label{margin:.3rem 0}"
            "details small{padding-left:1.5rem}summary{cursor:pointer;color:#ffd2bf}"
            "[role=alert]{color:#ffbaa5}</style></head><body><main>"
            "<h1>ClipCast recorder</h1>"
            f"<p>{active} of {MAX_ACTIVE} recording slots in use</p>{notice}"
            f'<form method="post" action="/record">{hidden}'
            '<label for="channels">Twitch channels</label>'
            f'<input id="channels" name="channels" type="text" value="{form_channels}" '
            'placeholder="clix, secondchannel" maxlength="64" autocomplete="off" '
            'autocapitalize="none" spellcheck="false" required>'
            "<small>Enter up to two live usernames, separated by a comma.</small>"
            f'<label for="quality">Recording quality</label><select id="quality" '
            f'name="quality">{options}</select>'
            '<label><input type="checkbox" name="confirm" value="yes" required> '
            "I have permission to capture these streams.</label>"
            f'<button type="submit"{" disabled" if active >= MAX_ACTIVE else ""}>'
            "Record and find clips</button></form>"
            f'<div id="recordings">{cards}</div>{script}</main></body></html>',
            status_code=status,
            headers={"Cache-Control": "private, no-store", "X-Frame-Options": "DENY"},
        )

    @app.get("/", response_class=HTMLResponse, dependencies=[Depends(authenticate)])
    def home() -> HTMLResponse:
        return show_home()

    @app.post("/record", dependencies=[Depends(authenticate)], response_model=None)
    def record(
        token: str = Form(),
        confirm: str = Form(""),
        quality: str = Form(DEFAULT_QUALITY),
        channels: str = Form("", max_length=64),
    ):
        nonlocal selected_channels, selected_quality
        authorize_form(token)
        if confirm != "yes":
            return show_home("Confirm permission to record first.", 400)
        if quality not in QUALITY_OPTIONS:
            return show_home("Choose a recording quality.", 400)
        try:
            requested = channels_from_input(channels) if channels else default_channels
        except ValueError as error:
            return show_home(str(error), 400)

        error_message = ""
        with state:
            in_progress = {job.channel for job in jobs.values() if job.phase in BUSY}
            if in_progress.intersection(requested):
                error_message = (
                    "One of those channels already has a recording in progress."
                )
            elif len(requested) + len(in_progress) > MAX_ACTIVE:
                error_message = (
                    "Two recordings can run at a time. Try again when a slot is free."
                )
            elif len(requested) + len(jobs) > MAX_RUNS:
                error_message = "Download and clear a finished recording to make room."
            else:
                selected_channels, selected_quality = requested, quality
                for name in requested:
                    key = secrets.token_hex(8)
                    folder = Path(work.name) / key
                    folder.mkdir()
                    job = Recording(key, name, folder / "capture.mp4")
                    jobs[key] = job
                    Thread(target=run_capture, args=(job, quality), daemon=True).start()
        if error_message:
            return show_home(error_message, 409)
        return RedirectResponse("/", status_code=303)

    @app.post("/jobs/{key}/clips/{rank}/scoop", dependencies=[Depends(authenticate)])
    def make_scoop(
        key: str,
        rank: int,
        token: str = Form(),
        script: str = Form(""),
        crop: str = Form("center"),
    ):
        authorize_form(token)
        if (script and script not in SCRIPT_CHOICES) or crop not in CROP:
            raise HTTPException(
                status_code=400, detail="Choose a Scoop script and framing."
            )
        with state:
            item = get_highlight(get_job(key), rank)
            if item.phase not in ("queued", "rendering"):
                item.script = script or item.script
                item.crop = crop
                item.phase = "queued"
                Thread(
                    target=run_scoop,
                    args=(item, scoop_path(item), item.script, crop),
                    daemon=True,
                ).start()
        return RedirectResponse("/#recordings", status_code=303)

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

    @app.get("/jobs/{key}/original", dependencies=[Depends(authenticate)])
    def download(key: str) -> StreamingResponse:
        with state:
            job = get_job(key)
            if job.phase != "ready":
                raise HTTPException(status_code=404, detail="No capture to download.")
            return media_response(job.path, f"{job.channel}-{job.key}-capture.mp4")

    @app.get("/jobs/{key}/clips/{rank}", dependencies=[Depends(authenticate)])
    def download_clip(key: str, rank: int) -> StreamingResponse:
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            return media_response(
                item.path, f"{job.channel}-{job.key}-highlight-{rank}.mp4"
            )

    @app.get("/jobs/{key}/clips/{rank}/scoop", dependencies=[Depends(authenticate)])
    def download_scoop(key: str, rank: int) -> StreamingResponse:
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            path = scoop_path(item)
            if not path.is_file():
                raise HTTPException(
                    status_code=404, detail="The Scoop version is not ready."
                )
            return media_response(path, f"{job.channel}-{job.key}-scoop-{rank}.mp4")

    @app.post("/jobs/{key}/clear", dependencies=[Depends(authenticate)])
    def clear(key: str, token: str = Form()) -> RedirectResponse:
        authorize_form(token)
        with state:
            job = get_job(key)
            if job.phase in BUSY or any(
                item.phase in ("queued", "rendering") for item in job.highlights
            ):
                raise HTTPException(
                    status_code=409, detail="This recording is still processing."
                )
            rmtree(job.path.parent)
            del jobs[key]
        return RedirectResponse("/", status_code=303)

    return app


def create_render_app() -> FastAPI:
    return create_app(
        os.environ.get("TWITCH_CHANNEL", ""), os.environ.get("RECORDER_PASSWORD", "")
    )
