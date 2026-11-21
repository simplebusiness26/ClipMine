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
from datetime import UTC, datetime
from pathlib import Path
from shutil import copyfileobj, disk_usage, rmtree
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from time import monotonic
from typing import Annotated, BinaryIO
from urllib.parse import unquote
from zipfile import BadZipFile

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect
from streamlink import Streamlink
from streamlink.exceptions import StreamlinkError
from streamlink.options import Options

from clipcast_template.facecam import FACECAM_OPTIONS
from clipcast_template.render import (
    CROP,
    HOOK_LIMIT,
    NARRATION_LIMIT,
    auto_captions,
    probe_clip,
    render_template,
    suggest_template_hook,
)
from highlights import (
    MAX_CLIPS,
    ChatMonitor,
    Clip,
    cut_clip,
    detect_motion,
    detect_sound,
    select_clips,
)
from saved_views import SCRIPT, saved_page

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
    ffmpeg = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
        "-threads",
        "1",
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
    with subprocess.Popen(
        ffmpeg,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as encoder:
        assert encoder.stdin is not None and encoder.stdout is not None
        feeder = Thread(
            target=feed_stream, args=(url, quality, seconds, encoder.stdin), daemon=True
        )
        progress = Thread(
            target=report_progress,
            args=(encoder.stdout, on_progress),
            daemon=True,
        )
        feeder.start()
        progress.start()
        try:
            code = encoder.wait(timeout=seconds + 65)
        except subprocess.TimeoutExpired:
            encoder.kill()
            encoder.wait()
            raise
        finally:
            feeder.join(timeout=25)
            progress.join()
        if code:
            raise subprocess.CalledProcessError(code, "ffmpeg")

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


def feed_stream(url: str, quality: str, seconds: int, sink: BinaryIO) -> None:
    # Share the Streamlink library across recording jobs. Each channel still gets
    # its own HTTP session, Twitch selection and bounded HLS ring buffer.
    try:
        with sink:
            session = Streamlink(
                {
                    "http-timeout": 15.0,
                    "stream-timeout": 20.0,
                    "stream-segmented-duration": float(seconds),
                    "ringbuffer-size": 4 * MIB,
                    "stream-segment-threads": 1,
                }
            )
            with session.http:
                streams = session.streams(
                    url,
                    options=Options({"supported-codecs": ["h264"]}),
                    stream_types=["hls"],
                )
                available = next(
                    (streams[name] for name in quality.split(",") if name in streams),
                    None,
                )
                if available is None:
                    raise ValueError("No requested HLS video quality is available")
                with available.open() as stream:
                    copyfileobj(stream, sink, length=65536)
    except BrokenPipeError:
        return  # FFmpeg completed the duration or size limit.
    except (OSError, ValueError, StreamlinkError) as error:
        LOGGER.info("Stream ended (%s)", type(error).__name__)


def report_progress(
    lines: Iterator[bytes], callback: Callable[[float], None] | None
) -> None:
    for line in lines:
        key, _, value = line.decode("ascii", "replace").strip().partition("=")
        if callback and key == "out_time_us" and value.lstrip("-").isdigit():
            callback(int(value) / 1_000_000)


def download_chunks(file: BinaryIO) -> Iterator[bytes]:
    with file:
        while chunk := file.read(256 * 1024):
            yield chunk


MAX_ACTIVE = 5
MAX_RUNS = 6
CAPTURE_HEADROOM = 192 * MIB
HANDLE = re.compile(r"[a-z0-9_]{3,25}", re.ASCII)
BUSY = {"capturing", "queued", "analysing", "ranked", "cutting"}
ARCHIVE_EDIT_MAX_BYTES = 192 * MIB
ARCHIVE_EDIT_MAX_JOBS = 3
TEMPLATE_BUSY = {"queued", "rendering", "hook_queued", "suggesting"}


@dataclass
class Highlight:
    clip: Clip
    path: Path
    phase: str = ""
    hook: str = ""
    hook_status: str = ""
    narration: str = ""
    crop: str = "center"
    caption_status: str = ""
    cam: str = "auto"


@dataclass
class Recording:
    key: str
    channel: str
    path: Path
    byte_cap: int
    phase: str = "capturing"
    capture: Capture | None = None
    highlights: list[Highlight] = field(default_factory=list)
    candidates: list[Clip] = field(default_factory=list)
    signals: str = ""
    run: str = ""
    detail: str = ""


@dataclass
class Run:
    key: str
    created_at: str
    jobs: list[str] = field(default_factory=list)
    finalizing: bool = False


@dataclass
class ArchiveEdit:
    highlight: Highlight
    started_at: float
    kind: str


class EditOptions(BaseModel):
    kind: str
    hook: str = Field(default="", max_length=HOOK_LIMIT)
    narration: str = Field(default="", max_length=NARRATION_LIMIT)
    crop: str = "center"
    cam: str = "auto"


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
        raise ValueError("TWITCH_CHANNEL can prefill up to five usernames")
    if len(password) < 20 or not password.isascii():
        raise ValueError("RECORDER_PASSWORD must be at least 20 ASCII characters")

    csrf = secrets.token_urlsafe(32)
    state = Lock()
    processor = Lock()
    work = TemporaryDirectory(prefix="clipcast-capture-")
    jobs: dict[str, Recording] = {}
    runs: dict[str, Run] = {}
    edits: dict[str, ArchiveEdit] = {}
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
            prepare_run(job.run)
            return
        finally:
            chat.close()

        with state:
            job.capture = recorded
            job.phase = "queued"

        # Serialize audio analysis and branded encodes on Render's small free instance.
        audio_status = "Audio checked for laughter and action."
        with processor:
            with state:
                job.phase = "analysing"
                job.detail = "Checking laughter and action"
            try:
                sounds = detect_sound(job.path, model)
                audio, actions = sounds.laughter, sounds.action
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
                audio, actions = {}, {}
                audio_status = "Audio analysis was unavailable."

            speech = []
            with state:
                job.detail = "Checking dialogue for story beats"
            try:
                with TemporaryDirectory(prefix="scan-", dir=job.path.parent) as scan:
                    speech = auto_captions(job.path, Path(scan), long_source=True)
            except (
                OSError,
                ValueError,
                RuntimeError,
                subprocess.SubprocessError,
            ) as error:
                LOGGER.info(
                    "Recording transcript unavailable (%s)", type(error).__name__
                )
            with state:
                job.detail = "Checking gameplay movement"
            try:
                motion = detect_motion(job.path)
            except (
                OSError,
                ValueError,
                RuntimeError,
                subprocess.SubprocessError,
            ) as error:
                LOGGER.info(
                    "Recording motion check unavailable (%s)", type(error).__name__
                )
                motion = {}

            chat_status = "Twitch chat checked."
            if not chat.connected:
                chat_status = "Twitch chat was unavailable during this capture."
            elif not chat.counts:
                chat_status = (
                    "No Twitch chat messages were received during this capture."
                )

            candidates = select_clips(
                recorded.duration,
                chat.counts,
                chat.laughter,
                audio,
                speech=speech,
                action=actions,
                motion=motion,
            )
            with state:
                job.detail = "Cutting the first highlights"
                # Early slots are split across channels. Remaining slots are
                # filled from the best candidates once every channel is checked.
                share = MAX_CLIPS // len(runs[job.run].jobs)
            remaining = []
            for clip in candidates:
                if len(job.highlights) >= share:
                    remaining.append(clip)
                else:
                    append_highlight(job, clip)
            with state:
                job.candidates = remaining
                job.signals = f"{chat_status} {audio_status}"
                job.phase = "ranked"
                job.detail = ""
        prepare_run(job.run)

    def append_highlight(job: Recording, clip: Clip) -> bool:
        output = job.path.with_name(f"highlight-{len(job.highlights) + 1}.mp4")
        try:
            cut_clip(job.path, output, clip)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            output.unlink(missing_ok=True)
            LOGGER.warning("Highlight cut failed (%s)", type(error).__name__)
            return False
        with state:
            job.highlights.append(Highlight(clip, output))
        return True

    def prepare_run(run_key: str) -> None:
        with state:
            run = runs[run_key]
            batch = [jobs[key] for key in run.jobs]
            if run.finalizing or any(
                job.phase in {"capturing", "queued", "analysing"} for job in batch
            ):
                return
            run.finalizing = True
            for job in batch:
                if job.phase == "ranked":
                    job.phase = "cutting"
        Thread(target=cut_run, args=(batch,), daemon=True).start()

    def cut_run(batch: list[Recording]) -> None:
        candidates = sorted(
            ((job, clip) for job in batch for clip in job.candidates),
            key=lambda entry: (-entry[1].score, entry[1].start),
        )
        count = sum(len(job.highlights) for job in batch)
        with processor:
            for job, clip in candidates:
                if count == MAX_CLIPS:
                    break
                count += append_highlight(job, clip)
        with state:
            for job in batch:
                if job.phase == "cutting":
                    job.phase = "ready"
                job.candidates.clear()

    def run_template(highlight: Highlight, output: Path) -> None:
        phase = "ready"
        candidate = output.with_suffix(".pending.mp4")
        try:
            with processor:
                with state:
                    highlight.phase = "rendering"
                result = render_template(
                    highlight.path,
                    candidate,
                    highlight.hook,
                    highlight.narration,
                    highlight.crop,
                    highlight.cam,
                )
                candidate.replace(output)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            candidate.unlink(missing_ok=True)
            LOGGER.warning("Template export failed (%s)", type(error).__name__)
            phase = "failed"
        with state:
            if phase == "ready":
                highlight.caption_status = result.caption_status
                if not highlight.hook:
                    highlight.hook = result.hook.text
                    highlight.hook_status = (
                        f"Hook suggested from {result.hook.source}."
                        if result.hook.text
                        else "No clear hook found. You can add one."
                    )
            highlight.phase = phase

    def run_hook(highlight: Highlight) -> None:
        try:
            with processor:
                with state:
                    highlight.phase = "suggesting"
                suggestion = suggest_template_hook(
                    highlight.path, highlight.narration, highlight.crop
                )
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            LOGGER.warning("Hook suggestion failed (%s)", type(error).__name__)
            with state:
                highlight.hook_status = (
                    "Hook analysis was unavailable. You can add your own."
                )
        else:
            with state:
                highlight.hook = suggestion.text
                highlight.hook_status = (
                    f"Hook suggested from {suggestion.source}."
                    if suggestion.text
                    else "No clear hook found. You can add one."
                )
        finally:
            with state:
                highlight.phase = ""

    def storage_reserved(job: Recording) -> int:
        try:
            size = job.path.stat().st_size
        except FileNotFoundError:
            size = 0
        return max(0, job.byte_cap - size) + CAPTURE_HEADROOM

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

    def template_path(highlight: Highlight) -> Path:
        return highlight.path.with_name(f"clipcast-{highlight.path.name}")

    @app.get("/healthz")
    def health() -> dict[str, str | int]:
        return {
            "status": "ok",
            "mode": "highlights",
            "quality_options": "hd",
            "capture_slots": MAX_ACTIVE,
            "template": "gameplay-first",
            "saved_runs": "browser",
            "clip_cap_per_run": MAX_CLIPS,
            "batch_progress": "progressive",
            "reel_upload": "direct",
            "hooks": "clip-aware",
            "previews": "inline",
        }

    hidden = f'<input type="hidden" name="token" value="{csrf}">'

    def show_home(error: str = "", status: int = 200) -> HTMLResponse:
        # This handler is also used with a fixed message for invalid form submissions.
        with state:
            active = sum(job.phase in BUSY for job in jobs.values())
            cards = "".join(
                f'<p><a class="secondary" href="/runs/{run.key}">Open recording run</a> '
                f"{html.escape(', '.join(jobs[key].channel for key in run.jobs if key in jobs))}</p>"
                for run in reversed(list(runs.values()))
            )
            form_channels = html.escape(", ".join(selected_channels), quote=True)
            quality = selected_quality
        notice = f'<p role="alert">{html.escape(error)}</p>' if error else ""
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
            "input[type=text],textarea,select{font:inherit;padding:.48rem;margin:.15rem 0 .6rem;"
            "border:1px solid #896c89;border-radius:.35rem;max-width:100%;box-sizing:border-box}"
            "input[type=text],textarea{display:block;width:100%}input[type=checkbox],input[type=radio]{"
            "accent-color:#ffc5a6}ol{list-style:none;padding:0;margin:0}li{padding:.7rem 0;"
            "border-top:1px solid #513951}details{margin:.6rem 0}details label{margin:.3rem 0}"
            "details small{padding-left:1.5rem}summary{cursor:pointer;color:#ffd2bf}"
            "video{display:block;width:100%;aspect-ratio:16/9;max-height:45vh;"
            "background:#0e0912;border-radius:.6rem;object-fit:contain;margin:.5rem 0 .9rem}"
            "[role=alert]{color:#ffbaa5}</style></head><body><main>"
            "<h1>ClipCast recorder</h1>"
            '<a class="secondary" href="/saved">Saved clips</a>'
            f"<p>{active} of {MAX_ACTIVE} recording slots in use</p>{notice}"
            f'<form method="post" action="/record">{hidden}'
            '<label for="channels">Twitch channels</label>'
            f'<input id="channels" name="channels" type="text" value="{form_channels}" '
            'placeholder="clix, secondchannel" maxlength="160" autocomplete="off" '
            'autocapitalize="none" spellcheck="false" required>'
            "<small>Enter up to five live usernames, separated by a comma.</small>"
            f'<label for="quality">Recording quality</label><select id="quality" '
            f'name="quality">{options}</select>'
            '<label><input type="checkbox" name="confirm" value="yes" required> '
            "I have permission to capture these streams.</label>"
            f'<button type="submit"{" disabled" if active >= MAX_ACTIVE else ""}>'
            "Record and find clips</button></form>"
            f'<div id="recordings">{cards}</div></main></body></html>',
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
        channels: str = Form("", max_length=160),
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
        _, byte_cap = QUALITY_OPTIONS[quality]
        with state:
            remaining = sum(
                storage_reserved(job)
                for job in jobs.values()
                if job.phase == "capturing"
            )
            needed = remaining + len(requested) * (byte_cap + CAPTURE_HEADROOM)
            in_progress = {job.channel for job in jobs.values() if job.phase in BUSY}
            if in_progress.intersection(requested):
                error_message = (
                    "One of those channels already has a recording in progress."
                )
            elif len(requested) + len(in_progress) > MAX_ACTIVE:
                error_message = (
                    "Five recordings can run at a time. Try again when a slot is free."
                )
            elif len(requested) + len(jobs) > MAX_RUNS:
                error_message = "Download and clear a finished recording to make room."
            elif disk_usage(work.name).free < needed:
                error_message = "There is not enough temporary storage. Save and clear an older recording."
            else:
                selected_channels, selected_quality = requested, quality
                run_key = secrets.token_hex(8)
                run = Run(run_key, datetime.now(UTC).isoformat())
                runs[run_key] = run
                for name in requested:
                    key = secrets.token_hex(8)
                    folder = Path(work.name) / key
                    folder.mkdir()
                    job = Recording(
                        key, name, folder / "capture.mp4", byte_cap, run=run_key
                    )
                    jobs[key] = job
                    run.jobs.append(key)
                    Thread(target=run_capture, args=(job, quality), daemon=True).start()
        if error_message:
            return show_home(error_message, 409)
        return RedirectResponse(f"/runs/{run_key}", status_code=303)

    @app.post("/jobs/{key}/clips/{rank}/hook", dependencies=[Depends(authenticate)])
    def preview_hook(
        key: str,
        rank: int,
        token: str = Form(),
        narration: str = Form("", max_length=NARRATION_LIMIT),
        crop: str = Form("center"),
    ):
        authorize_form(token)
        if crop not in CROP:
            return show_home("Choose left, centre or right framing.", 400)
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            if item.phase not in TEMPLATE_BUSY:
                item.narration = "\n".join(
                    " ".join(line.split()) for line in narration.splitlines()
                ).strip()
                item.crop = crop
                item.phase = "hook_queued"
                Thread(target=run_hook, args=(item,), daemon=True).start()
        return RedirectResponse(f"/runs/{job.run}", status_code=303)

    @app.post("/jobs/{key}/clips/{rank}/template", dependencies=[Depends(authenticate)])
    def make_template(
        key: str,
        rank: int,
        token: str = Form(),
        hook: str = Form("", max_length=HOOK_LIMIT),
        narration: str = Form("", max_length=NARRATION_LIMIT),
        crop: str = Form("center"),
    ):
        authorize_form(token)
        if crop not in CROP:
            return show_home("Choose left, centre or right framing.", 400)
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            if item.phase not in TEMPLATE_BUSY:
                cleaned_hook = " ".join(hook.split())
                if cleaned_hook != item.hook:
                    item.hook_status = ""
                item.hook = cleaned_hook
                item.narration = "\n".join(
                    " ".join(line.split()) for line in narration.splitlines()
                ).strip()
                item.crop = crop
                item.phase = "queued"
                Thread(
                    target=run_template, args=(item, template_path(item)), daemon=True
                ).start()
        return RedirectResponse(f"/runs/{job.run}", status_code=303)

    def get_run(key: str) -> Run:
        run = runs.get(key)
        if run is None:
            raise HTTPException(
                404,
                "This recording run is no longer on the recorder. Check Saved clips on this device.",
            )
        return run

    @app.get("/saved-clips.js", dependencies=[Depends(authenticate)])
    def archive_script() -> FileResponse:
        return FileResponse(
            SCRIPT,
            media_type="text/javascript",
            headers={"Cache-Control": "private, no-cache"},
        )

    @app.get("/saved", dependencies=[Depends(authenticate)])
    def archive_index() -> HTMLResponse:
        return saved_page("index", csrf)

    @app.get("/saved/{key}", dependencies=[Depends(authenticate)])
    def archive_review(key: str) -> HTMLResponse:
        if not re.fullmatch(r"[a-f0-9]{16}", key):
            raise HTTPException(404, "This saved run is unavailable.")
        return saved_page("review", csrf, key)

    @app.get("/runs/{key}", dependencies=[Depends(authenticate)])
    def capture_progress(key: str) -> HTMLResponse:
        if not re.fullmatch(r"[a-f0-9]{16}", key):
            raise HTTPException(404, "This recording run is unavailable.")
        return saved_page("capture", csrf, key)

    @app.get("/runs/{key}/manifest", dependencies=[Depends(authenticate)])
    def capture_manifest(key: str) -> dict:
        with state:
            run = get_run(key)
            batch = [jobs[job] for job in run.jobs if job in jobs]
            complete = all(job.phase not in BUSY for job in batch)
            ranked = sorted(
                (
                    (job, rank, item)
                    for job in batch
                    for rank, item in enumerate(job.highlights, 1)
                ),
                key=lambda entry: (-entry[2].clip.score, entry[2].clip.start),
            )[:MAX_CLIPS]
            clips = [
                {
                    "id": f"{job.key}-{rank}",
                    "channel": job.channel,
                    "seconds": round(item.clip.end - item.clip.start, 1),
                    "reasons": item.clip.reasons,
                    "bytes": item.path.stat().st_size,
                    "url": f"/jobs/{job.key}/clips/{rank}/preview",
                }
                for job, rank, item in ranked
            ]
            statuses = {
                "capturing": "Recording",
                "queued": "Recorded. Waiting for its turn",
                "analysing": "Checking footage for highlights",
                "ranked": "Checked. Waiting for the rest of the batch",
                "cutting": "Preparing your best clips",
                "failed": "No playable recording",
                "ready": "Processed",
            }
            return {
                "id": key,
                "created_at": run.created_at,
                "complete": complete,
                "clips": clips,
                "channels": [
                    {"name": job.channel, "status": job.detail or statuses[job.phase]}
                    for job in batch
                ],
            }

    @app.post("/runs/{key}/saved", dependencies=[Depends(authenticate)])
    def acknowledge_saved(key: str, token: str = Form()) -> Response:
        authorize_form(token)
        with state:
            run = get_run(key)
            batch = [jobs[job] for job in run.jobs if job in jobs]
            if any(
                job.phase in BUSY
                or any(clip.phase in TEMPLATE_BUSY for clip in job.highlights)
                for job in batch
            ):
                raise HTTPException(409, "This run is still processing.")
            for job in batch:
                rmtree(job.path.parent)
                del jobs[job.key]
            del runs[run.key]
        return Response(status_code=204)

    def reserve_edit(options: EditOptions, size: int) -> tuple[str, Highlight]:
        if (
            options.kind not in {"hook", "reel"}
            or options.crop not in CROP
            or options.cam not in FACECAM_OPTIONS
        ):
            raise HTTPException(400, "Check your clip options.")
        if not 0 < size <= ARCHIVE_EDIT_MAX_BYTES:
            raise HTTPException(413, "This clip is outside the recorder's size limit.")
        key = secrets.token_hex(8)
        with state:
            expired = [
                name
                for name, edit in edits.items()
                if edit.highlight.phase not in TEMPLATE_BUSY
                and monotonic() - edit.started_at > 1800
            ]
            for name in expired:
                rmtree(edits[name].highlight.path.parent, ignore_errors=True)
                del edits[name]
            if (
                sum(edit.highlight.phase in TEMPLATE_BUSY for edit in edits.values())
                >= ARCHIVE_EDIT_MAX_JOBS
            ):
                raise HTTPException(
                    409, "ClipCast is busy with other edits. Try again in a moment."
                )
            if disk_usage(work.name).free < size + ARCHIVE_EDIT_MAX_BYTES:
                raise HTTPException(
                    409,
                    "The recorder is low on working space. Try again after the current run saves.",
                )
            folder = Path(work.name) / key
            folder.mkdir()
            item = Highlight(
                Clip(0, 0),
                folder / "highlight.mp4",
                phase="hook_queued" if options.kind == "hook" else "queued",
                hook=" ".join(options.hook.split()),
                narration="\n".join(
                    " ".join(line.split()) for line in options.narration.splitlines()
                ).strip(),
                crop=options.crop,
                cam=options.cam,
            )
            edits[key] = ArchiveEdit(item, monotonic(), options.kind)
        return key, item

    def discard_edit(key: str, item: Highlight) -> None:
        with state:
            edits.pop(key, None)
        rmtree(item.path.parent, ignore_errors=True)

    def start_edit(kind: str, item: Highlight) -> None:
        try:
            probe_clip(item.path)
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            raise HTTPException(
                400, "This file is not a playable highlight."
            ) from error
        target = run_hook if kind == "hook" else run_template
        args = (item,) if kind == "hook" else (item, template_path(item))
        Thread(target=target, args=args, daemon=True).start()

    @app.get("/saved-edits/session", dependencies=[Depends(authenticate)])
    def saved_edit_session(response: Response) -> dict[str, str]:
        response.headers["Cache-Control"] = "private, no-store"
        return {"token": csrf}

    @app.post(
        "/saved-edits/video", dependencies=[Depends(authenticate)], status_code=202
    )
    async def upload_saved_edit(
        request: Request,
        x_clipcast_token: Annotated[str, Header()],
        x_clipcast_options: Annotated[str, Header(max_length=8192)],
        x_clipcast_size: Annotated[int, Header()],
    ) -> dict:
        authorize_form(x_clipcast_token)
        try:
            options = EditOptions.model_validate_json(unquote(x_clipcast_options))
        except ValidationError as error:
            raise HTTPException(400, "Check your clip options.") from error
        key, item = reserve_edit(options, x_clipcast_size)
        started = False
        try:
            received = 0
            with item.path.open("wb") as output:
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > x_clipcast_size:
                        raise HTTPException(400, "The clip upload size did not match.")
                    output.write(chunk)
            if received != x_clipcast_size:
                raise HTTPException(
                    400, "The clip upload came through incomplete. Try again."
                )
            await run_in_threadpool(start_edit, options.kind, item)
            started = True
        except ClientDisconnect as error:
            raise HTTPException(
                400, "The clip upload was interrupted. Try again."
            ) from error
        finally:
            if not started:
                discard_edit(key, item)
        return {"id": key}

    @app.post("/saved-edits", dependencies=[Depends(authenticate)], status_code=202)
    def make_saved_edit(
        video: Annotated[UploadFile, File()],
        token: str = Form(),
        kind: str = Form(),
        hook: str = Form("", max_length=HOOK_LIMIT),
        narration: str = Form("", max_length=NARRATION_LIMIT),
        crop: str = Form("center"),
        cam: str = Form("auto"),
    ) -> dict:
        authorize_form(token)
        options = EditOptions(
            kind=kind, hook=hook, narration=narration, crop=crop, cam=cam
        )
        key, item = reserve_edit(options, video.size or 0)
        try:
            with item.path.open("wb") as output:
                copyfileobj(video.file, output, length=256 * 1024)
            start_edit(kind, item)
        except (HTTPException, OSError):
            discard_edit(key, item)
            raise
        return {"id": key}

    def get_saved_edit(key: str) -> ArchiveEdit:
        edit = edits.get(key)
        if edit is None:
            raise HTTPException(
                404, "This edit expired. Your original is still in Saved clips."
            )
        return edit

    @app.get("/saved-edits/{key}", dependencies=[Depends(authenticate)])
    def saved_edit_status(key: str) -> dict:
        with state:
            edit = get_saved_edit(key)
            item = edit.highlight
            return {
                "done": item.phase not in TEMPLATE_BUSY,
                "error": "The Reel could not be made. Try again."
                if item.phase == "failed"
                else "",
                "hook": item.hook,
                "message": item.hook_status,
            }

    @app.get("/saved-edits/{key}/video", dependencies=[Depends(authenticate)])
    def saved_edit_video(key: str) -> StreamingResponse:
        with state:
            item = get_saved_edit(key).highlight
            path = template_path(item)
            if item.phase != "ready" or not path.is_file():
                raise HTTPException(404, "This Reel is not ready.")
            return media_response(path, "clipcast-reel.mp4")

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

    @app.api_route(
        "/jobs/{key}/clips/{rank}/preview",
        methods=["GET", "HEAD"],
        dependencies=[Depends(authenticate)],
    )
    def preview_clip(key: str, rank: int) -> FileResponse:
        with state:
            item = get_highlight(get_job(key), rank)
            try:
                file_status = item.path.stat()
            except FileNotFoundError as error:
                raise HTTPException(
                    status_code=404, detail="This clip is unavailable."
                ) from error
            return FileResponse(
                item.path,
                media_type="video/mp4",
                stat_result=file_status,
                headers={
                    "Content-Disposition": "inline",
                    "Cache-Control": "private, no-store",
                },
            )

    @app.get("/jobs/{key}/clips/{rank}/template", dependencies=[Depends(authenticate)])
    def download_template(key: str, rank: int) -> StreamingResponse:
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            path = template_path(item)
            if not path.is_file():
                raise HTTPException(
                    status_code=404, detail="The ClipCast version is not ready."
                )
            return media_response(path, f"{job.channel}-{job.key}-clipcast-{rank}.mp4")

    @app.post("/jobs/{key}/clear", dependencies=[Depends(authenticate)])
    def clear(key: str, token: str = Form()) -> RedirectResponse:
        authorize_form(token)
        with state:
            job = get_job(key)
            if job.phase in BUSY or any(
                item.phase in TEMPLATE_BUSY for item in job.highlights
            ):
                raise HTTPException(
                    status_code=409, detail="This recording is still processing."
                )
            rmtree(job.path.parent)
            del jobs[key]
            run = runs.get(job.run)
            if run and not any(item in jobs for item in run.jobs):
                del runs[run.key]
        return RedirectResponse("/", status_code=303)

    return app


def create_render_app() -> FastAPI:
    return create_app(
        os.environ.get("TWITCH_CHANNEL", ""), os.environ.get("RECORDER_PASSWORD", "")
    )
