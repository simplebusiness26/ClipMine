import html
import json
import logging
import math
import os
import re
import secrets
import subprocess
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import ExitStack, asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from shutil import copyfileobj, disk_usage, rmtree
from tempfile import TemporaryDirectory, TemporaryFile
from threading import Event, Lock, Thread
from time import monotonic
from typing import Annotated, BinaryIO
from urllib.parse import unquote
from zipfile import BadZipFile, ZipFile

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
    CUSTOM_CHANNEL_VI_TEMPLATE,
    CUSTOM_GTA_CLIPCAST_TEMPLATE,
    DEFAULT_TEMPLATE,
    HOOK_LIMIT,
    NARRATION_LIMIT,
    REEL_TEMPLATES,
    auto_captions,
    probe_clip,
    render_template,
    suggest_template_hook,
)
from highlights import (
    MAX_CLIPS,
    MAX_HIGHLIGHT_SECONDS,
    ChatMonitor,
    Clip,
    cut_clip,
    detect_motion,
    detect_sound,
    select_clips,
)
from saved_views import SCRIPT, saved_page

CAPTURE_SECONDS = 600
BRAND_REEL_TEMPLATES = {
    "channel-vi": CUSTOM_CHANNEL_VI_TEMPLATE,
    "gta-clipcast": CUSTOM_GTA_CLIPCAST_TEMPLATE,
}
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


class CampaignCategoryError(ValueError):
    pass


def verify_twitch_category(url: str, required: str) -> str:
    session = Streamlink({"http-timeout": 12.0})
    with session.http:
        try:
            _, plugin, resolved = session.resolve_url_no_redirect(url)
            channel = plugin(session, resolved)
            actual, stream_id = channel.get_category(), channel.get_id()
        except (OSError, StreamlinkError) as error:
            raise CampaignCategoryError(f"Could not verify the live {required} category.") from error
    if not actual or not stream_id or actual.casefold() != required.casefold():
        raise CampaignCategoryError(f"Waiting for a verified {required} livestream.")
    return stream_id


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
DEFAULT_CONTINUOUS_HIGHLIGHTS = 3
MAX_CONTINUOUS_HIGHLIGHTS = 5
CONTINUOUS_RETRY_SECONDS = 60
CAPTURE_HEADROOM = 192 * MIB
HANDLE = re.compile(r"[a-z0-9_]{3,25}", re.ASCII)
BUSY = {"capturing", "queued", "analysing", "ranked", "cutting"}
ARCHIVE_EDIT_MAX_BYTES = 192 * MIB
ARCHIVE_EDIT_MAX_JOBS = 3
ARCHIVE_CHUNK_BYTES = 2 * MIB
TEMPLATE_BUSY = {
    "uploading",
    "verifying",
    "queued",
    "rendering",
    "hook_queued",
    "suggesting",
}


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
    template: str = DEFAULT_TEMPLATE
    edit_request: str = ""
    edit_kind: str = ""
    edit_revision: int = 0
    transcript: list | None = None
    duration: float | None = None
    brand_reels: dict[str, "Highlight"] = field(default_factory=dict)
    brand_request: str = ""
    resolved_revision: int | None = None
    skip_reason: str = ""
    downloaded_revision: int | None = None
    downloaded_brands: set[str] = field(default_factory=set)


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
    capture_finished: Event = field(default_factory=Event)


@dataclass(frozen=True)
class CampaignBrief:
    name: str
    brief: str
    min_seconds: int | None
    max_seconds: int | None
    required_category: str = ""
    preserve_source_frame: bool = False
    require_custom_hook: bool = False


@dataclass
class Run:
    key: str
    created_at: str
    jobs: list[str] = field(default_factory=list)
    finalizing: bool = False
    saved_revision: str | None = None
    continuous: bool = False
    campaign: CampaignBrief | None = None


@dataclass
class ContinuousCapture:
    channel: str
    quality: str
    campaign: CampaignBrief | None = None
    stop: Event = field(default_factory=Event)
    status: str = "Starting"


@dataclass
class ArchiveEdit:
    highlight: Highlight
    updated_at: float
    kind: str
    size: int
    received: int = 0


class EditOptions(BaseModel):
    kind: str
    hook: str = Field(default="", max_length=HOOK_LIMIT)
    narration: str = Field(default="", max_length=NARRATION_LIMIT)
    crop: str = "center"
    cam: str = "auto"
    template: str = DEFAULT_TEMPLATE


class UploadOptions(EditOptions):
    size: int


class RunEditOptions(EditOptions):
    request_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class BrandReelOptions(BaseModel):
    channel_vi_hook: str = Field(default="", max_length=HOOK_LIMIT)
    gta_clipcast_hook: str = Field(default="", max_length=HOOK_LIMIT)
    request_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class CampaignSettings(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    brief: str = Field(min_length=1, max_length=12000)
    min_seconds: int | None = Field(default=None, ge=1, le=MAX_HIGHLIGHT_SECONDS)
    max_seconds: int | None = Field(default=None, ge=1, le=MAX_HIGHLIGHT_SECONDS)
    required_category: str = Field(default="", max_length=120)
    preserve_source_frame: bool = False
    require_custom_hook: bool = False

    def brief_for_run(self) -> CampaignBrief:
        name, brief = self.name.strip(), self.brief.strip()
        if not name or not brief:
            raise ValueError("Add both the campaign name and its brief.")
        if self.min_seconds is not None and self.max_seconds is not None:
            if self.min_seconds > self.max_seconds:
                raise ValueError("The minimum duration must be at most the maximum.")
        return CampaignBrief(
            name, brief, self.min_seconds, self.max_seconds, self.required_category.strip(),
            self.preserve_source_frame, self.require_custom_hook,
        )


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
    *,
    locked_campaign: CampaignBrief | None = None,
    continuous_highlight_limit: int = DEFAULT_CONTINUOUS_HIGHLIGHTS,
) -> FastAPI:
    default_channels = channels_from_input(channel)
    if len(default_channels) > MAX_ACTIVE:
        raise ValueError("TWITCH_CHANNEL can prefill up to five usernames")
    if locked_campaign and len(default_channels) != 1:
        raise ValueError("A locked campaign requires one TWITCH_CHANNEL")
    if len(password) < 20 or not password.isascii():
        raise ValueError("RECORDER_PASSWORD must be at least 20 ASCII characters")
    if not 1 <= continuous_highlight_limit <= MAX_CONTINUOUS_HIGHLIGHTS:
        raise ValueError("CLIPCAST_HIGHLIGHTS_PER_WINDOW must be between 1 and 5")

    csrf = secrets.token_urlsafe(32)
    state = Lock()
    processor = Lock()
    work = TemporaryDirectory(prefix="clipcast-capture-")
    jobs: dict[str, Recording] = {}
    runs: dict[str, Run] = {}
    edits: dict[str, ArchiveEdit] = {}
    selected_channels = default_channels
    selected_quality = DEFAULT_QUALITY
    continuous: ContinuousCapture | None = None
    shutting_down = Event()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            shutting_down.set()
            if continuous:
                continuous.stop.set()
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
        with state:
            campaign = runs[job.run].campaign
        category = campaign.required_category if campaign else ""
        url = f"https://www.twitch.tv/{job.channel}"
        chat = ChatMonitor(job.channel)
        chat_started = False
        try:
            stream_id = verify_twitch_category(url, category) if category else ""
            chat.start()
            chat_started = True
            recorded = capture_mp4(
                url,
                job.path,
                on_progress=chat.progress,
                quality=stream_options,
                max_bytes=max_bytes,
            )
            if category and verify_twitch_category(url, category) != stream_id:
                raise CampaignCategoryError("The livestream changed during capture.")
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            job.path.unlink(missing_ok=True)
            LOGGER.warning("Capture failed (%s)", type(error).__name__)
            with state:
                job.phase = "failed"
                if isinstance(error, CampaignCategoryError):
                    job.detail = str(error)
                job.capture_finished.set()
            prepare_run(job.run)
            return
        finally:
            if chat_started:
                chat.close()

        with state:
            job.capture = recorded
            job.phase = "queued"
            job.capture_finished.set()

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
                run = runs[job.run]
                share = MAX_CLIPS // len(run.jobs)
            remaining = []
            if run.continuous:
                for clip in candidates:
                    if len(job.highlights) >= continuous_highlight_limit:
                        break
                    if "Dialogue may continue past the cut" not in clip.reasons:
                        append_highlight(job, clip, transcribe=True, campaign=run.campaign)
            else:
                for clip in candidates:
                    if len(job.highlights) >= share:
                        remaining.append(clip)
                    else:
                        append_highlight(job, clip)
            with state:
                job.candidates = remaining
                job.signals = f"{chat_status} {audio_status}"
                job.phase = "ranked"
                job.detail = (
                    "No highlight met the campaign duration and ending checks."
                    if run.campaign and not job.highlights
                    else ""
                )
        prepare_run(job.run)

    def append_highlight(
        job: Recording,
        clip: Clip,
        *,
        transcribe: bool = False,
        campaign: CampaignBrief | None = None,
    ) -> bool:
        output = job.path.with_name(f"highlight-{len(job.highlights) + 1}.mp4")
        duration = None
        try:
            cut_clip(job.path, output, clip)
            if campaign and (campaign.min_seconds is not None or campaign.max_seconds is not None):
                duration, _ = probe_clip(output)
                if not (campaign.min_seconds or 0) <= duration <= (
                    campaign.max_seconds or float("inf")
                ):
                    output.unlink(missing_ok=True)
                    return False
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            output.unlink(missing_ok=True)
            LOGGER.warning("Highlight cut failed (%s)", type(error).__name__)
            return False
        transcript = None
        if transcribe:
            try:
                with TemporaryDirectory(prefix="transcript-", dir=output.parent) as scan:
                    transcript = auto_captions(output, Path(scan))
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                LOGGER.info("Highlight transcript unavailable (%s)", type(error).__name__)
        template = CUSTOM_CHANNEL_VI_TEMPLATE if transcribe else DEFAULT_TEMPLATE
        with state:
            job.highlights.append(
                Highlight(clip, output, transcript=transcript, template=template, duration=duration)
            )
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
        automatic = []
        with state:
            for job in batch:
                if job.phase == "cutting":
                    job.phase = "ready"
                    run = runs[job.run]
                    if run.continuous:
                        for item in job.highlights:
                            item.phase = "hook_queued"
                            automatic.append((item, run.campaign))
                job.candidates.clear()
        for item, campaign in automatic:
            render_automatic_pair(item, campaign)

    def render_automatic_pair(item: Highlight, campaign: CampaignBrief | None) -> None:
        hook = ""
        source = ""
        try:
            with processor:
                with state:
                    item.phase = "suggesting"
                suggestion = suggest_template_hook(
                    item.path, "", item.crop, cached_cues=item.transcript or [],
                )
                hook, source = suggestion.text, suggestion.source
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            LOGGER.info("Automatic Reel hook unavailable (%s)", type(error).__name__)
        if not hook:
            if "Laugh reactions in chat" in item.clip.reasons:
                hook = "THIS HAD CHAT LAUGHING"
            elif "Chat spike" in item.clip.reasons:
                hook = "WATCH WHAT GOT CHAT TALKING"
            elif "Laughter in stream audio" in item.clip.reasons:
                hook = "WAIT FOR THE LAUGH"
            source = "highlight signals"
        with state:
            item.phase = ""
            if not hook and campaign and campaign.require_custom_hook:
                item.skip_reason = "ClipCast could not find a specific hook supported by the clip."
                item.resolved_revision = item.edit_revision
                return
            item.hook = hook or "WATCH HOW THIS PLAYS OUT"
            item.hook_status = f"Hook selected from {source}." if hook else "Used a neutral hook."
            renders = prepare_brand_reels(item, dict.fromkeys(BRAND_REEL_TEMPLATES, item.hook))
        render_brand_reels(renders)

    def run_template(highlight: Highlight, output: Path, *, reuse_transcript: bool = False) -> None:
        phase = "ready"
        candidate = output.with_suffix(".pending.mp4")
        try:
            with processor:
                with state:
                    highlight.phase = "rendering"
                caption_options = {"cached_cues": highlight.transcript or []} if reuse_transcript else {}
                if locked_campaign and locked_campaign.preserve_source_frame:
                    caption_options["preserve_source_frame"] = True
                result = render_template(
                    highlight.path,
                    candidate,
                    highlight.hook,
                    highlight.narration,
                    highlight.crop,
                    highlight.cam,
                    highlight.template,
                    **caption_options,
                )
                candidate.replace(output)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            candidate.unlink(missing_ok=True)
            LOGGER.warning("Template export failed (%s)", type(error).__name__)
            phase = "failed"
        with state:
            if phase == "ready":
                highlight.caption_status = result.caption_status
                if not highlight.hook and highlight.template == DEFAULT_TEMPLATE:
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
            "capture_slots": 1 if locked_campaign else MAX_ACTIVE,
            "template": DEFAULT_TEMPLATE,
            "channel_vi_templates": len(REEL_TEMPLATES) - 1,
            "saved_runs": "browser",
            "background_review": "server",
            "clip_cap_per_run": MAX_CLIPS,
            "clip_cap_per_continuous_window": continuous_highlight_limit,
            "batch_progress": "progressive",
            "reel_upload": "chunked",
            "phone_upload_resume": "enabled",
            "saved_copy_retention": "until_space_needed",
            "reel_download": "direct",
            "hooks": "clip-aware",
            "previews": "inline",
            "continuous_capture": "supported",
            "branded_reel_pair": "supported",
            "branded_reel_bundle": "supported",
            "automatic_reels": "supported",
            "campaign_lock": "enabled" if locked_campaign else "optional",
        }

    hidden = f'<input type="hidden" name="token" value="{csrf}">'

    def show_home(error: str = "", status: int = 200) -> HTMLResponse:
        # This handler is also used with a fixed message for invalid form submissions.
        with state:
            active = sum(
                job.phase == "capturing" if locked_campaign else job.phase in BUSY
                for job in jobs.values()
            )
            continuous_status = ""
            if continuous:
                label = "Stopping after this capture" if continuous.stop.is_set() else continuous.status
                campaign_label = (
                    f" · {html.escape(continuous.campaign.name)}" if continuous.campaign else ""
                )
                continuous_status = (
                    f"<p>Continuous recording for @{html.escape(continuous.channel)} · "
                    f"{html.escape(label)}{campaign_label}</p>"
                    f'<form method="post" action="/continuous/stop">{hidden}'
                    '<button class="secondary" type="submit">Stop after this capture</button>'
                    "</form>"
                )
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
        if locked_campaign:
            campaign_fields = (
                f"<p><strong>Locked campaign</strong> · {html.escape(locked_campaign.name)}</p>"
                '<details><summary>View locked brief</summary>'
                f'<p style="white-space:pre-wrap">{html.escape(locked_campaign.brief)}</p></details>'
            )
            recording_button = ""
            slots = 1
        else:
            campaign_fields = (
                "<details><summary>Campaign brief and clip length</summary>"
                '<label for="campaign">Campaign name</label>'
                '<input id="campaign" name="campaign_name" type="text" maxlength="120">'
                '<label for="brief">Campaign brief</label>'
                '<textarea id="brief" name="campaign_brief" rows="5" maxlength="12000"></textarea>'
                '<label for="min-seconds">Minimum clip seconds</label>'
                f'<input id="min-seconds" name="min_seconds" type="number" min="1" max="{MAX_HIGHLIGHT_SECONDS}">'
                '<label for="max-seconds">Maximum clip seconds</label>'
                f'<input id="max-seconds" name="max_seconds" type="number" min="1" max="{MAX_HIGHLIGHT_SECONDS}">'
                "</details>"
            )
            disabled = " disabled" if active >= MAX_ACTIVE else ""
            recording_button = f'<button type="submit"{disabled}>Record and find clips</button>'
            slots = MAX_ACTIVE
        form_action = "/continuous/start" if locked_campaign else "/record"
        readonly = " readonly" if locked_campaign else ""
        channel_hint = (
            "This worker is assigned to one Twitch channel."
            if locked_campaign else "Enter one Twitch username for continuous recording."
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
            f"<p>{active} of {slots} recording slots in use</p>{notice}"
            f'<form method="post" action="{form_action}">{hidden}'
            '<label for="channels">Twitch channels</label>'
            f'<input id="channels" name="channels" type="text" value="{form_channels}" '
            'placeholder="clix, secondchannel" maxlength="160" autocomplete="off" '
            f'autocapitalize="none" spellcheck="false" required{readonly}>'
            f"<small>{channel_hint}</small>"
            f'<label for="quality">Recording quality</label><select id="quality" '
            f'name="quality">{options}</select>'
            '<label><input type="checkbox" name="confirm" value="yes" required> '
            "I have permission to capture these streams.</label>"
            f"{recording_button}{campaign_fields}"
            '<button class="secondary" type="submit" formaction="/continuous/start">'
            "Record consecutive 10-minute windows</button>"
            "<small>Continuous recording takes one username. Windows without a highlight "
            "and windows whose Reel has been delivered can be cleared when space is needed.</small>"
            f"</form>{continuous_status}"
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
        if locked_campaign:
            return show_home("Use continuous recording for this locked campaign.", 409)
        if confirm != "yes":
            return show_home("Confirm permission to record first.", 400)
        if quality not in QUALITY_OPTIONS:
            return show_home("Choose a recording quality.", 400)
        try:
            requested = channels_from_input(channels) if channels else default_channels
        except ValueError as error:
            return show_home(str(error), 400)

        with state:
            in_progress = {job.channel for job in jobs.values() if job.phase in BUSY}
            if continuous:
                error_message = "Stop continuous recording before starting a manual capture."
            elif in_progress.intersection(requested):
                error_message = (
                    "One of those channels already has a recording in progress."
                )
            elif len(requested) + len(in_progress) > MAX_ACTIVE:
                error_message = (
                    "Five recordings can run at a time. Try again when a slot is free."
                )
            else:
                error_message = capture_capacity(len(requested), quality)
            if not error_message:
                selected_channels, selected_quality = requested, quality
                run = start_recording(requested, quality)
        if error_message:
            return show_home(error_message, 409)
        return RedirectResponse(f"/runs/{run.key}", status_code=303)

    def capture_capacity(incoming: int, quality: str) -> str:
        _, byte_cap = QUALITY_OPTIONS[quality]
        remaining = sum(
            storage_reserved(job) for job in jobs.values() if job.phase == "capturing"
        )
        needed = remaining + incoming * (byte_cap + CAPTURE_HEADROOM)
        reclaim_saved_runs(incoming, needed)
        if incoming + len(jobs) > MAX_RUNS:
            return "Waiting for older runs to finish or be saved or delivered."
        if disk_usage(work.name).free < needed:
            return "The recorder is low on space. Save an older finished run to this device."
        return ""

    def start_recording(
        requested: list[str],
        quality: str,
        *,
        repeat: bool = False,
        campaign: CampaignBrief | None = None,
    ) -> Run:
        _, byte_cap = QUALITY_OPTIONS[quality]
        run = Run(
            secrets.token_hex(8), datetime.now(UTC).isoformat(), continuous=repeat,
            campaign=campaign,
        )
        runs[run.key] = run
        for name in requested:
            key = secrets.token_hex(8)
            folder = Path(work.name) / key
            folder.mkdir()
            job = Recording(key, name, folder / "capture.mp4", byte_cap, run=run.key)
            jobs[key] = job
            run.jobs.append(key)
            Thread(target=run_capture, args=(job, quality), daemon=True).start()
        return run

    def run_continuously(session: ContinuousCapture) -> None:
        nonlocal continuous
        try:
            while not session.stop.is_set():
                with state:
                    if session.stop.is_set():
                        return
                    error = capture_capacity(1, session.quality)
                    session.status = error or "Recording a 10-minute window"
                    if not error:
                        run = start_recording(
                            [session.channel], session.quality,
                            repeat=True, campaign=session.campaign,
                        )
                        job = jobs[run.jobs[0]]
                if error:
                    session.stop.wait(CONTINUOUS_RETRY_SECONDS)
                    continue
                while not job.capture_finished.wait(0.5):
                    if shutting_down.is_set():
                        return
                if job.capture is None or job.capture.duration < CAPTURE_SECONDS / 2:
                    with state:
                        session.status = job.detail or "Stream unavailable or interrupted. Retrying shortly."
                    session.stop.wait(CONTINUOUS_RETRY_SECONDS)
        finally:
            with state:
                if continuous is session:
                    continuous = None

    @app.post("/continuous/start", dependencies=[Depends(authenticate)], response_model=None)
    def start_continuous(
        token: str = Form(),
        confirm: str = Form(""),
        quality: str = Form(DEFAULT_QUALITY),
        channels: str = Form("", max_length=160),
        campaign_name: str = Form("", max_length=120),
        campaign_brief: str = Form("", max_length=12000),
        min_seconds: int | None = Form(None, ge=1, le=MAX_HIGHLIGHT_SECONDS),
        max_seconds: int | None = Form(None, ge=1, le=MAX_HIGHLIGHT_SECONDS),
    ):
        nonlocal continuous
        authorize_form(token)
        if confirm != "yes" or quality not in QUALITY_OPTIONS:
            return show_home("Confirm permission and choose a recording quality.", 400)
        try:
            requested = channels_from_input(channels) if channels else default_channels
        except ValueError as error:
            return show_home(str(error), 400)
        if len(requested) != 1:
            return show_home("Enter one Twitch username for continuous recording.", 400)
        if locked_campaign and requested != default_channels:
            return show_home("This worker is locked to a different Twitch username.", 409)
        campaign = locked_campaign
        name, brief = campaign_name.strip(), campaign_brief.strip()
        if name or brief or min_seconds is not None or max_seconds is not None:
            try:
                campaign = CampaignSettings(
                    name=name, brief=brief, min_seconds=min_seconds, max_seconds=max_seconds,
                    **({
                        "required_category": locked_campaign.required_category,
                        "preserve_source_frame": locked_campaign.preserve_source_frame,
                        "require_custom_hook": locked_campaign.require_custom_hook,
                    } if locked_campaign else {}),
                ).brief_for_run()
            except ValidationError:
                return show_home("Add both the campaign name and its brief.", 400)
            except ValueError as error:
                return show_home(str(error), 400)
            if locked_campaign and campaign != locked_campaign:
                return show_home("This worker already has a locked campaign brief.", 409)
        with state:
            available = not continuous and all(job.phase != "capturing" for job in jobs.values())
            if available:
                continuous = ContinuousCapture(requested[0], quality, campaign)
                Thread(target=run_continuously, args=(continuous,), daemon=True).start()
        if not available:
            return show_home("Stop the active session or wait for a recording slot.", 409)
        return RedirectResponse("/", status_code=303)

    @app.post("/continuous/stop", dependencies=[Depends(authenticate)])
    def stop_continuous(token: str = Form()) -> RedirectResponse:
        authorize_form(token)
        with state:
            if continuous:
                continuous.stop.set()
        return RedirectResponse("/", status_code=303)

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
            if not highlight_is_busy(item):
                item.narration = "\n".join(
                    " ".join(line.split()) for line in narration.splitlines()
                ).strip()
                item.crop = crop
                item.edit_kind = "hook"
                item.edit_revision += 1
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
        template: str = Form(DEFAULT_TEMPLATE),
    ):
        authorize_form(token)
        if crop not in CROP:
            return show_home("Choose left, centre or right framing.", 400)
        if template not in REEL_TEMPLATES:
            return show_home("Choose an available Reel template.", 400)
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            if not highlight_is_busy(item):
                cleaned_hook = " ".join(hook.split())
                if cleaned_hook != item.hook:
                    item.hook_status = ""
                item.hook = cleaned_hook
                item.narration = "\n".join(
                    " ".join(line.split()) for line in narration.splitlines()
                ).strip()
                item.crop = crop
                item.template = template
                item.edit_kind = "reel"
                item.edit_revision += 1
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

    def run_revision(batch: list[Recording]) -> str:
        return ",".join(
            f"{job.key}:{item.edit_revision}"
            for job in batch
            for item in job.highlights
        )

    def highlight_revision(key: str, rank: int, item: Highlight) -> str:
        return f"{key}-{rank}:{item.edit_revision}"

    def run_is_busy(batch: list[Recording]) -> bool:
        return any(
            job.phase in BUSY
            or any(highlight_is_busy(clip) for clip in job.highlights)
            for job in batch
        )

    def highlight_is_busy(item: Highlight) -> bool:
        return item.phase in TEMPLATE_BUSY or any(
            reel.phase in TEMPLATE_BUSY for reel in item.brand_reels.values()
        )

    def reclaim_saved_runs(incoming: int, needed: int) -> None:
        for run in list(runs.values()):
            if (
                len(jobs) + incoming <= MAX_RUNS
                and disk_usage(work.name).free >= needed
            ):
                return
            batch = [jobs[key] for key in run.jobs if key in jobs]
            if run_is_busy(batch):
                continue
            if run.continuous:
                if not run.finalizing or any(
                    item.resolved_revision != item.edit_revision
                    for job in batch for item in job.highlights
                ):
                    continue
            elif run.saved_revision != run_revision(batch):
                continue
            for job in batch:
                rmtree(job.path.parent)
                del jobs[job.key]
            del runs[run.key]

    def run_edit_status(item: Highlight, base: str) -> dict:
        return {
            **edit_status(item),
            "kind": item.edit_kind,
            "url": f"{base}/template" if template_path(item).is_file() else "",
        }

    def brand_reel_path(item: Highlight, brand: str) -> Path:
        return item.path.with_name(f"{item.path.stem}-{brand}.mp4")

    def brand_reels_status(item: Highlight, base: str) -> dict:
        result = {}
        skip_reason = item.skip_reason if item.resolved_revision == item.edit_revision else ""
        for brand, template in BRAND_REEL_TEMPLATES.items():
            reel = item.brand_reels.get(brand)
            phase = "skipped" if skip_reason else reel.phase if reel else item.phase or "waiting"
            url = ""
            if phase == "ready" and brand_reel_path(item, brand).is_file():
                url = f"{base}/reels/{brand}"
            result[brand] = {
                "label": REEL_TEMPLATES[template].split(" · ")[0],
                "phase": phase,
                "download_url": url,
                "hook": reel.hook if reel else "",
                "skip_reason": skip_reason,
            }
        return result

    @app.get("/continuous/queue", dependencies=[Depends(authenticate)])
    def continuous_queue(response: Response) -> dict:
        response.headers["Cache-Control"] = "private, no-store"
        with state:
            waiting = []
            for run in runs.values():
                if not run.continuous:
                    continue
                job = jobs[run.jobs[0]]
                if job.phase != "ready" or not job.highlights:
                    continue
                for rank, item in enumerate(job.highlights, 1):
                    if item.resolved_revision != item.edit_revision:
                        waiting.append(queued_highlight(run, job, rank, item))
            return {
                "channel": continuous.channel if continuous else None,
                "status": continuous.status if continuous else "Stopped",
                "locked_campaign": (
                    {"channel": default_channels[0], **asdict(locked_campaign)}
                    if locked_campaign else None
                ),
                "token": csrf,
                "highlights": waiting,
            }

    def queued_highlight(run: Run, job: Recording, rank: int, item: Highlight) -> dict:
        base = f"/jobs/{job.key}/clips/{rank}"
        return {
            "id": f"{job.key}-{rank}",
            "channel": job.channel,
            "created_at": run.created_at,
            "clip_seconds": (
                item.duration if item.duration is not None
                else round(item.clip.end - item.clip.start, 1)
            ),
            "campaign": asdict(run.campaign) if run.campaign else None,
            "reasons": item.clip.reasons,
            "transcript": item.transcript,
            "run_url": f"/runs/{run.key}",
            "preview_url": f"{base}/preview",
            "edit_url": f"{base}/edit",
            "reels_url": f"{base}/reels",
            "bundle_url": f"{base}/reels/download",
            "reels": brand_reels_status(item, base),
            "delivery_url": f"/continuous/{job.key}/delivered?rank={rank}",
            "skip_url": f"/continuous/{job.key}/skipped?rank={rank}",
            "template": CUSTOM_CHANNEL_VI_TEMPLATE,
            "revision": highlight_revision(job.key, rank, item),
            "edit": run_edit_status(item, base),
        }

    @app.post(
        "/continuous/{key}/delivered",
        dependencies=[Depends(authenticate)],
        status_code=204,
    )
    def acknowledge_delivery(
        key: str, revision: str = Form(), token: str = Form(), rank: int = 1,
    ) -> Response:
        authorize_form(token)
        with state:
            job = get_job(key)
            run = get_run(job.run)
            if not run.continuous:
                raise HTTPException(404, "This is not a continuous recording.")
            item = get_highlight(job, rank)
            reels = brand_reels_status(item, "")
            if (
                revision != highlight_revision(key, rank, item)
                or not all(reel["download_url"] for reel in reels.values())
            ):
                raise HTTPException(409, "Download both current finished Reels first.")
            item.resolved_revision = item.edit_revision
            item.skip_reason = ""
        return Response(status_code=204)

    @app.post(
        "/continuous/{key}/skipped",
        dependencies=[Depends(authenticate)],
        status_code=204,
    )
    def skip_campaign_highlight(
        key: str,
        revision: str = Form(),
        token: str = Form(),
        reason: str = Form(min_length=1, max_length=300),
        rank: int = 1,
    ) -> Response:
        authorize_form(token)
        reason = reason.strip()
        if not reason:
            raise HTTPException(400, "Add the campaign requirement this clip missed.")
        with state:
            job = get_job(key)
            run = get_run(job.run)
            if not run.continuous or not run.campaign:
                raise HTTPException(404, "This is not a campaign highlight.")
            item = get_highlight(job, rank)
            if (
                job.phase != "ready" or highlight_is_busy(item)
                or revision != highlight_revision(key, rank, item)
            ):
                raise HTTPException(409, "Refresh to check the current highlight.")
            item.resolved_revision = item.edit_revision
            item.skip_reason = reason
        return Response(status_code=204)

    @app.post(
        "/jobs/{key}/clips/{rank}/edit",
        dependencies=[Depends(authenticate)],
        status_code=202,
    )
    def queue_run_edit(
        key: str,
        rank: int,
        options: RunEditOptions,
        x_clipcast_token: Annotated[str, Header()],
    ) -> dict:
        authorize_form(x_clipcast_token)
        validate_options(options)
        with state:
            item = get_highlight(get_job(key), rank)
            base = f"/jobs/{key}/clips/{rank}"
            if item.edit_request == options.request_id:
                return run_edit_status(item, base)
            if highlight_is_busy(item):
                raise HTTPException(409, "ClipCast is already working on this clip.")
            item.edit_request = options.request_id
            item.edit_kind = options.kind
            item.edit_revision += 1
            item.hook = " ".join(options.hook.split())
            item.hook_status = ""
            item.narration = "\n".join(
                " ".join(line.split()) for line in options.narration.splitlines()
            ).strip()
            item.crop = options.crop
            item.cam = options.cam
            item.template = options.template
            queue_edit(options.kind, item)
            return run_edit_status(item, base)

    @app.get("/jobs/{key}/clips/{rank}/edit", dependencies=[Depends(authenticate)])
    def get_run_edit(key: str, rank: int) -> dict:
        with state:
            item = get_highlight(get_job(key), rank)
            return run_edit_status(item, f"/jobs/{key}/clips/{rank}")

    @app.post(
        "/jobs/{key}/clips/{rank}/reels", dependencies=[Depends(authenticate)], status_code=202
    )
    def queue_brand_reels(
        key: str, rank: int, options: BrandReelOptions,
        x_clipcast_token: Annotated[str, Header()],
    ) -> dict:
        authorize_form(x_clipcast_token)
        hooks = {
            "channel-vi": " ".join(options.channel_vi_hook.split()),
            "gta-clipcast": " ".join(options.gta_clipcast_hook.split()),
        }
        base = f"/jobs/{key}/clips/{rank}"
        with state:
            job = get_job(key)
            run = get_run(job.run)
            if job.phase != "ready" or not run.continuous:
                raise HTTPException(409, "Wait for the continuous recording's highlight to be ready.")
            if run.campaign and run.campaign.require_custom_hook and not all(hooks.values()):
                raise HTTPException(400, "Add a headline to each Reel for this campaign.")
            item = get_highlight(job, rank)
            if item.brand_request == options.request_id:
                return brand_reels_status(item, base)
            if highlight_is_busy(item):
                raise HTTPException(409, "ClipCast is already working on this clip.")
            item.brand_request = options.request_id
            pending = prepare_brand_reels(item, hooks)
            if pending:
                Thread(target=render_brand_reels, args=(pending,), daemon=True).start()
            return brand_reels_status(item, base)

    def prepare_brand_reels(item: Highlight, hooks: dict[str, str]) -> list[tuple[Highlight, Path]]:
        pending = []
        for brand, hook in hooks.items():
            reel = item.brand_reels.get(brand)
            path = brand_reel_path(item, brand)
            if reel and reel.phase == "ready" and reel.hook == hook and path.is_file():
                continue
            reel = Highlight(
                item.clip, item.path, phase="queued", hook=hook, cam=item.cam,
                crop=item.crop, template=BRAND_REEL_TEMPLATES[brand],
                transcript=item.transcript,
            )
            item.brand_reels[brand] = reel
            pending.append((reel, path))
        if pending:
            item.edit_revision += 1
            item.skip_reason = ""
        return pending

    def render_brand_reels(pending: list[tuple[Highlight, Path]]) -> None:
        for reel, path in pending:
            run_template(reel, path, reuse_transcript=True)

    @app.get("/jobs/{key}/clips/{rank}/reels", dependencies=[Depends(authenticate)])
    def get_brand_reels(key: str, rank: int, response: Response) -> dict:
        response.headers["Cache-Control"] = "private, no-store"
        with state:
            item = get_highlight(get_job(key), rank)
            return brand_reels_status(item, f"/jobs/{key}/clips/{rank}")

    def branded_download_chunks(
        file: BinaryIO, item: Highlight, revision: int, brands: tuple[str, ...],
    ) -> Iterator[bytes]:
        yield from download_chunks(file)
        with state:
            if item.edit_revision != revision:
                return
            if item.downloaded_revision != revision:
                item.downloaded_revision = revision
                item.downloaded_brands.clear()
            item.downloaded_brands.update(brands)
            if item.downloaded_brands == BRAND_REEL_TEMPLATES.keys():
                item.resolved_revision = revision
                item.skip_reason = ""

    @app.get("/jobs/{key}/clips/{rank}/reels/download", dependencies=[Depends(authenticate)])
    def download_reel_bundle(key: str, rank: int) -> StreamingResponse:
        with ExitStack() as sources:
            with state:
                job = get_job(key)
                item = get_highlight(job, rank)
                reels = brand_reels_status(item, "")
                if not all(reel["download_url"] for reel in reels.values()):
                    raise HTTPException(409, "Both Reels need to finish before downloading.")
                stem = f"{job.channel}-{job.key}-{rank}"
                revision = item.edit_revision
                files = {
                    f"{stem}-{brand}.mp4": sources.enter_context(
                        brand_reel_path(item, brand).open("rb")
                    )
                    for brand in BRAND_REEL_TEMPLATES
                }
            bundle = TemporaryFile(dir=work.name)
            try:
                with ZipFile(bundle, "w") as archive:
                    for name, source in files.items():
                        with archive.open(name, "w") as entry:
                            copyfileobj(source, entry)
                length = bundle.tell()
                bundle.seek(0)
            except OSError as error:
                bundle.close()
                raise HTTPException(507, "ClipCast could not prepare the ZIP download.") from error
            return StreamingResponse(
                branded_download_chunks(bundle, item, revision, tuple(BRAND_REEL_TEMPLATES)),
                media_type="application/zip",
                headers={
                    "Content-Length": str(length),
                    "Content-Disposition": f'attachment; filename="{stem}-both-reels.zip"',
                    "Cache-Control": "private, no-store",
                },
            )

    @app.get("/jobs/{key}/clips/{rank}/reels/{brand}", dependencies=[Depends(authenticate)])
    def download_brand_reel(key: str, rank: int, brand: str) -> StreamingResponse:
        if brand not in BRAND_REEL_TEMPLATES:
            raise HTTPException(404, "Unknown Reel brand.")
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            reel = item.brand_reels.get(brand)
            path = brand_reel_path(item, brand)
            if not reel or reel.phase != "ready" or not path.is_file():
                raise HTTPException(404, "This branded Reel is not ready.")
            return media_response(
                path, f"{job.channel}-{job.key}-{rank}-{brand}.mp4",
                delivery=(item, item.edit_revision, brand),
            )

    @app.get("/saved-clips.js", dependencies=[Depends(authenticate)])
    def archive_script() -> FileResponse:
        return FileResponse(
            SCRIPT,
            media_type="text/javascript",
            headers={"Cache-Control": "private, no-store"},
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
                    "edit_url": f"/jobs/{job.key}/clips/{rank}/edit",
                    "edit": run_edit_status(item, f"/jobs/{job.key}/clips/{rank}"),
                    "reels": brand_reels_status(item, f"/jobs/{job.key}/clips/{rank}")
                    if run.continuous else {},
                    **({
                        "automatic_reels": True,
                        "transcript": item.transcript,
                        "skip_reason": (
                            item.skip_reason
                            if item.resolved_revision == item.edit_revision else ""
                        ),
                        "reels_url": f"/jobs/{job.key}/clips/{rank}/reels",
                        "bundle_url": f"/jobs/{job.key}/clips/{rank}/reels/download",
                    } if run.continuous and job.phase == "ready" else {}),
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
                "revision": run_revision(batch),
                "saved_revision": run.saved_revision,
                "clips": clips,
                "channels": [
                    {"name": job.channel, "status": job.detail or statuses[job.phase]}
                    for job in batch
                ],
            }

    @app.post("/runs/{key}/saved", dependencies=[Depends(authenticate)])
    def acknowledge_saved(
        key: str, token: str = Form(), revision: str | None = Form(None)
    ) -> Response:
        authorize_form(token)
        with state:
            run = get_run(key)
            batch = [jobs[job] for job in run.jobs if job in jobs]
            if run_is_busy(batch):
                raise HTTPException(409, "This run is still processing.")
            current_revision = run_revision(batch)
            if revision is not None and revision != current_revision:
                raise HTTPException(409, "This run has a newer edit. Save it again.")
            run.saved_revision = current_revision
        return Response(status_code=204)

    @app.post("/runs/{key}/saved/forget", dependencies=[Depends(authenticate)])
    def forget_saved(key: str, token: str = Form()) -> Response:
        authorize_form(token)
        with state:
            if key in runs:
                runs[key].saved_revision = None
        return Response(status_code=204)

    def validate_options(options: EditOptions) -> None:
        if (
            options.kind not in {"hook", "reel"}
            or options.crop not in CROP
            or options.cam not in FACECAM_OPTIONS
            or options.template not in REEL_TEMPLATES
        ):
            raise HTTPException(400, "Check your clip options.")

    def reserve_edit(
        options: EditOptions, size: int, upload_id: str | None = None
    ) -> tuple[str, Highlight]:
        validate_options(options)
        if not 0 < size <= ARCHIVE_EDIT_MAX_BYTES:
            raise HTTPException(413, "This clip is outside the recorder's size limit.")
        key = upload_id or secrets.token_hex(8)
        with state:
            now = monotonic()
            expired = [
                name
                for name, edit in edits.items()
                if name != key
                and (
                    (
                        edit.highlight.phase == "uploading"
                        and now - edit.updated_at > 180
                    )
                    or (
                        edit.highlight.phase not in TEMPLATE_BUSY
                        and now - edit.updated_at > 1800
                    )
                )
            ]
            for name in expired:
                rmtree(edits[name].highlight.path.parent, ignore_errors=True)
                del edits[name]
            if upload_id and key in edits:
                existing = edits[key]
                if existing.size != size or existing.kind != options.kind:
                    raise HTTPException(409, "Start a new upload for this clip.")
                if existing.highlight.phase == "uploading":
                    existing.updated_at = now
                return key, existing.highlight
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
                template=options.template,
            )
            if upload_id:
                item.phase = "uploading"
            edits[key] = ArchiveEdit(item, now, options.kind, size)
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
        with state:
            queue_edit(kind, item)

    def queue_edit(kind: str, item: Highlight) -> None:
        target = run_hook if kind == "hook" else run_template
        args = (item,) if kind == "hook" else (item, template_path(item))
        item.phase = "hook_queued" if kind == "hook" else "queued"
        Thread(target=target, args=args, daemon=True).start()

    @app.get("/saved-edits/session", dependencies=[Depends(authenticate)])
    def saved_edit_session(response: Response) -> dict[str, str]:
        response.headers["Cache-Control"] = "private, no-store"
        return {"token": csrf}

    @app.put("/saved-edits/uploads/{key}", dependencies=[Depends(authenticate)])
    def begin_upload(
        key: str, options: UploadOptions, x_clipcast_token: Annotated[str, Header()]
    ) -> dict[str, int]:
        authorize_form(x_clipcast_token)
        if not re.fullmatch(r"[a-f0-9]{32}", key):
            raise HTTPException(400, "Invalid upload reference.")
        reserve_edit(options, options.size, upload_id=key)
        with state:
            edit = get_saved_edit(key)
            return {"chunk_bytes": ARCHIVE_CHUNK_BYTES, "received": edit.received}

    @app.put(
        "/saved-edits/uploads/{key}/parts/{offset}",
        dependencies=[Depends(authenticate)],
    )
    async def put_upload_part(
        key: str,
        offset: int,
        request: Request,
        x_clipcast_token: Annotated[str, Header()],
    ) -> dict[str, int]:
        authorize_form(x_clipcast_token)
        with state:
            edit = get_saved_edit(key)
            if (
                edit.highlight.phase != "uploading"
                or not 0 <= offset < edit.size
                or offset % ARCHIVE_CHUNK_BYTES
            ):
                raise HTTPException(409, "This upload part is out of order.")
            length = min(ARCHIVE_CHUNK_BYTES, edit.size - offset)
        part = bytearray()
        try:
            async for chunk in request.stream():
                if len(part) + len(chunk) > length:
                    raise HTTPException(400, "The upload part was too large.")
                part.extend(chunk)
        except ClientDisconnect as error:
            raise HTTPException(408, "The upload part was interrupted.") from error
        if len(part) != length:
            raise HTTPException(408, "The upload part was incomplete.")
        with state:
            edit = get_saved_edit(key)
            if edit.highlight.phase != "uploading" or offset > edit.received:
                raise HTTPException(409, "This upload part is out of order.")
            if edit.received == offset:
                path = edit.highlight.path
                with path.open("r+b" if path.exists() else "wb") as output:
                    output.seek(offset)
                    output.write(part)
                edit.received += length
            edit.updated_at = monotonic()
            return {"received": edit.received}

    @app.post(
        "/saved-edits/uploads/{key}/finish",
        dependencies=[Depends(authenticate)],
        status_code=202,
    )
    def finish_upload(
        key: str, x_clipcast_token: Annotated[str, Header()]
    ) -> dict[str, str]:
        authorize_form(x_clipcast_token)
        with state:
            edit = get_saved_edit(key)
            if edit.received != edit.size:
                raise HTTPException(409, "The clip upload is still incomplete.")
            if edit.highlight.phase != "uploading":
                return {"id": key}
            edit.highlight.phase = "verifying"
        try:
            start_edit(edit.kind, edit.highlight)
        except (HTTPException, OSError):
            discard_edit(key, edit.highlight)
            raise
        return {"id": key}

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
        template: str = Form(DEFAULT_TEMPLATE),
    ) -> dict:
        authorize_form(token)
        options = EditOptions(
            kind=kind,
            hook=hook,
            narration=narration,
            crop=crop,
            cam=cam,
            template=template,
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
            return edit_status(get_saved_edit(key).highlight)

    def edit_status(item: Highlight) -> dict:
        return {
            "done": item.phase not in TEMPLATE_BUSY,
            "phase": item.phase,
            "error": "The Reel could not be made. Try again."
            if item.phase == "failed"
            else "",
            "hook": item.hook,
            "message": item.hook_status,
        }

    @app.api_route(
        "/saved-edits/{key}/video",
        methods=["GET", "HEAD"],
        dependencies=[Depends(authenticate)],
    )
    def saved_edit_video(key: str) -> FileResponse:
        with state:
            item = get_saved_edit(key).highlight
            path = template_path(item)
            if item.phase != "ready" or not path.is_file():
                raise HTTPException(404, "This Reel is not ready.")
            return FileResponse(
                path,
                media_type="video/mp4",
                filename="clipcast-reel.mp4",
                headers={"Cache-Control": "private, no-store"},
            )

    def media_response(
        path: Path, filename: str, *, delivery: tuple[Highlight, int, str] | None = None
    ) -> StreamingResponse:
        file = path.open("rb")
        length = os.fstat(file.fileno()).st_size
        if delivery:
            highlight, revision, brand = delivery
            chunks = branded_download_chunks(file, highlight, revision, (brand,))
        else:
            chunks = download_chunks(file)
        return StreamingResponse(
            chunks,
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

    @app.api_route(
        "/jobs/{key}/clips/{rank}/template",
        methods=["GET", "HEAD"],
        dependencies=[Depends(authenticate)],
    )
    def download_template(key: str, rank: int) -> FileResponse:
        with state:
            job = get_job(key)
            item = get_highlight(job, rank)
            path = template_path(item)
            if not path.is_file():
                raise HTTPException(
                    status_code=404, detail="The ClipCast version is not ready."
                )
            return FileResponse(
                path,
                media_type="video/mp4",
                filename=f"{job.channel}-{job.key}-clipcast-{rank}.mp4",
                headers={"Cache-Control": "private, no-store"},
            )

    @app.post("/jobs/{key}/clear", dependencies=[Depends(authenticate)])
    def clear(key: str, token: str = Form()) -> RedirectResponse:
        authorize_form(token)
        with state:
            job = get_job(key)
            if run_is_busy([job]):
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
    configured_campaign = os.environ.get("CLIPCAST_CAMPAIGN", "")
    return create_app(
        os.environ.get("TWITCH_CHANNEL", ""),
        os.environ.get("RECORDER_PASSWORD", ""),
        locked_campaign=(
            CampaignSettings.model_validate_json(configured_campaign).brief_for_run()
            if configured_campaign else None
        ),
        continuous_highlight_limit=int(
            os.environ.get("CLIPCAST_HIGHLIGHTS_PER_WINDOW", DEFAULT_CONTINUOUS_HIGHLIGHTS)
        ),
    )
