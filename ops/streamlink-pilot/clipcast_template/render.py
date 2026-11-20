"""Compose the text-only ClipCast reference layout without changing clip audio."""

import json
import logging
import math
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont

from clipcast_template.hooks import HookSuggestion, suggest_hook

ASSETS = Path(__file__).resolve().parent / "assets"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
WIDTH, HEIGHT, FPS = 720, 1280, 30
CROP = {"left": "0.16", "center": "0.50", "right": "0.84"}
HOOK_LIMIT = 64
NARRATION_LIMIT = 110
CREAM = (255, 240, 216, 255)
PLUM = (39, 11, 41, 255)
PINK = (237, 45, 118, 255)
LOGGER = logging.getLogger(__name__)


def probe_clip(path: Path) -> tuple[float, bool]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,duration:format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    metadata = json.loads(result.stdout)
    video = next((s for s in metadata["streams"] if s["codec_type"] == "video"), {})
    duration = float(video.get("duration", "nan"))
    if not math.isfinite(duration):
        duration = float(metadata["format"]["duration"])
    if not video or not math.isfinite(duration) or not 0 < duration <= 40:
        raise ValueError("Invalid highlight duration")
    return duration, any(s["codec_type"] == "audio" for s in metadata["streams"])


def draw_hook(text: str, output: Path) -> None:
    canvas = Image.new("RGBA", (WIDTH, 70))
    draw = ImageDraw.Draw(canvas)
    text = " ".join(text.upper().split())
    if not text:
        canvas.save(output)
        return
    font_path = FONT_DIR / "DejaVuSans-BoldOblique.ttf"
    size = 33
    font = ImageFont.truetype(str(font_path), size)
    while font.getlength(text) > 595 and size > 8:
        size -= 1
        font = ImageFont.truetype(str(font_path), size)
    width = min(666, math.ceil(font.getlength(text)) + 45)
    draw.polygon(
        [(6, 13), (width, 6), (width - 9, 55), (width - 29, 63), (18, 68)], fill=PINK
    )
    draw.polygon([(5, 11), (width, 2), (width - 10, 53), (1, 61)], fill=PLUM)
    draw.text((14, 14), text, font=font, fill=CREAM, anchor="lt")
    canvas.save(output)


def fit_caption(text: str, font: ImageFont.FreeTypeFont, limit: int) -> list[str]:
    rows = []
    for paragraph in text.splitlines():
        line = ""
        for word in paragraph.split():
            combined = f"{line} {word}".strip()
            if line and font.getlength(combined) > limit:
                rows.append(line)
                line = word
            else:
                line = combined
            while font.getlength(line) > limit:
                boundary = next(
                    i
                    for i in range(len(line) - 1, 0, -1)
                    if font.getlength(line[:i]) <= limit
                )
                rows.append(line[:boundary])
                line = line[boundary:]
        if line:
            rows.append(line)
    return rows


def draw_caption(text: str, output: Path) -> None:
    canvas = Image.new("RGBA", (WIDTH, 144))
    if text:
        draw = ImageDraw.Draw(canvas)
        path = FONT_DIR / "DejaVuSans-Bold.ttf"
        size = 33
        font = ImageFont.truetype(str(path), size)
        rows = fit_caption(text, font, 520)
        if len(text.splitlines()) > 3:
            text = " ".join(text.split())
            rows = fit_caption(text, font, 520)
        while len(rows) > 3 and size > 18:
            size -= 1
            font = ImageFont.truetype(str(path), size)
            rows = fit_caption(text, font, 520)
        for index, row in enumerate(rows[:3]):
            y = index * (size + 8)
            width = math.ceil(font.getlength(row)) + 18
            draw.rounded_rectangle((1, y, width, y + size + 7), radius=5, fill=CREAM)
            draw.text((9, y + 5), row, font=font, fill=(25, 16, 24, 255), anchor="lt")
    canvas.save(output)


def auto_captions(source: Path, scratch: Path) -> list:
    audio = scratch / "speech.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(audio),
        ],
        check=True,
        capture_output=True,
        timeout=22,
    )
    result = subprocess.run(
        [sys.executable, "-m", "clipcast_template.transcript", str(audio)],
        check=True,
        capture_output=True,
        text=True,
        timeout=225,
    )
    return json.loads(result.stdout)


def caption_timeline(path: Path, cues: list, duration: float) -> None:
    blank = path.with_name("blank.png")
    draw_caption("", blank)
    cursor = 0.0
    with path.open("w", encoding="ascii") as playlist:
        playlist.write("ffconcat version 1.0\n")
        for index, (start, end, text) in enumerate(cues):
            start = round(max(cursor, min(float(start), duration)) * 25) / 25
            end = round(min(float(end), duration) * 25) / 25
            text = str(text).strip()
            if end - start < 0.039 or not text:
                continue
            if start - cursor >= 0.039:
                playlist.write(f"file '{blank.name}'\nduration {start - cursor:.5f}\n")
            caption = path.with_name(f"caption-{index}.png")
            draw_caption(text, caption)
            playlist.write(f"file '{caption.name}'\nduration {end - start:.5f}\n")
            cursor = end
        playlist.write(f"file '{blank.name}'\n")


@dataclass(frozen=True)
class TemplateResult:
    caption_status: str
    hook: HookSuggestion


def portrait_crop(crop: str) -> str:
    return (
        "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':"
        f"x='(iw-ow)*{CROP[crop]}':y='(ih-oh)*0.5'"
    )


def transcript_context(
    source: Path, scratch: Path, has_audio: bool
) -> tuple[list, str]:
    if not has_audio:
        return (
            [],
            "No speech track was found. Add written narration if you want text here.",
        )
    try:
        cues = auto_captions(source, scratch)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        LOGGER.warning("Transcript unavailable (%s)", type(error).__name__)
        return [], "Automatic captions were unavailable. You can add written narration."
    return cues, (
        "Automatic English captions included. Check names and dialogue."
        if cues
        else "No clear speech was detected. You can add written narration."
    )


def suggest_template_hook(source: Path, narration: str, crop: str) -> HookSuggestion:
    duration, has_audio = probe_clip(source)
    with TemporaryDirectory(prefix="hook-", dir=source.parent) as temp:
        dialogue = (
            [narration]
            if narration
            else [
                text
                for _, _, text in transcript_context(source, Path(temp), has_audio)[0]
            ]
        )
        return suggest_hook(source, duration, portrait_crop(crop), dialogue)


def render_template(
    source: Path, output: Path, hook: str, narration: str, crop: str
) -> TemplateResult:
    duration, has_audio = probe_clip(source)
    with TemporaryDirectory(prefix="template-", dir=output.parent) as temp:
        scratch = Path(temp)
        if narration:
            cues = [(0.0, duration + 0.04, narration)]
            status = "Written narration included."
        else:
            cues, status = transcript_context(source, scratch, has_audio)
        selected = (
            HookSuggestion(hook)
            if hook
            else suggest_hook(
                source, duration, portrait_crop(crop), [text for _, _, text in cues]
            )
        )
        hook_image = scratch / "hook.png"
        draw_hook(selected.text, hook_image)
        timeline = scratch / "captions.ffconcat"
        caption_timeline(timeline, cues, duration)
        game = (
            f"setpts=PTS-STARTPTS,{portrait_crop(crop)},"
            f"scale={WIDTH}:{HEIGHT}:flags=bicubic,setsar=1,fps={FPS}"
        )
        graph = (
            f"[0:v]{game}[game];"
            "[game][1:v]overlay=x=29:y=76[logo];"
            "[logo][2:v]overlay=x=26:y=166:enable='lt(t,4)'[hook];"
            "[hook][3:v]overlay=x=32:y=884[out]"
        )
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-n",
                "-threads",
                "1",
                "-i",
                str(source),
                "-i",
                str(ASSETS / "brand-badge.png"),
                "-i",
                str(hook_image),
                "-f",
                "concat",
                "-safe",
                "1",
                "-i",
                str(timeline),
                "-filter_complex_threads",
                "1",
                "-filter_complex",
                graph,
                "-map",
                "[out]",
                "-map",
                "0:a:0?",
                "-t",
                f"{duration:.6f}",
                "-c:v",
                "libx264",
                "-threads",
                "2",
                "-preset",
                "ultrafast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "copy",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
            capture_output=True,
            timeout=360,
        )
    if not output.stat().st_size:
        raise ValueError("Template export produced no file")
    return TemplateResult(status, selected)
