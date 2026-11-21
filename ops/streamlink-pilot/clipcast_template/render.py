"""Compose ClipCast Reel layouts with the source audio."""

import json
import logging
import math
import subprocess
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont

from clipcast_template.facecam import CAM_HEIGHT, facecam_crop
from clipcast_template.hooks import HookSuggestion, suggest_hook

ASSETS = Path(__file__).resolve().parent / "assets"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
WIDTH, HEIGHT, FPS = 720, 1280, 30
CROP = {"left": "0.16", "center": "0.50", "right": "0.84"}
HOOK_LIMIT = 64
NARRATION_LIMIT = 110
DEFAULT_TEMPLATE = "gameplay-first"
CUSTOM_CHANNEL_VI_TEMPLATE = "channel-vi-custom"
CUSTOM_GTA_CLIPCAST_TEMPLATE = "gta-clipcast-custom"
LOGO_FREE_TEMPLATE = "logo-free"
CHANNEL_VI_TEMPLATES = {
    "it-was-going-well": "It Was Going Well",
    "roll-that-back": "Roll That Back",
    "scoop-was-there": "Scoop Was There",
}
REEL_TEMPLATES = {
    DEFAULT_TEMPLATE: "Gameplay First",
    CUSTOM_CHANNEL_VI_TEMPLATE: "Channel VI · Custom headline",
    CUSTOM_GTA_CLIPCAST_TEMPLATE: "GTA ClipCast · Custom headline",
    **{key: f"Channel VI · {label}" for key, label in CHANNEL_VI_TEMPLATES.items()},
}
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
    if not video or not math.isfinite(duration) or not 0 < duration <= 120:
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


def channel_vi_frame(text: str, output: Path) -> None:
    with Image.open(ASSETS / "channel-vi-reel-frame.png") as asset:
        frame = asset.convert("RGBA").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    headline = " ".join(text.upper().split())
    if headline:
        font_path = Path("/usr/share/fonts/truetype/open-sans/OpenSans-CondBold.ttf")
        if not font_path.is_file():
            font_path = FONT_DIR / "DejaVuSansCondensed-Bold.ttf"
        font = ImageFont.truetype(str(font_path), 31)
        lines = fit_caption(headline, font, 610)
        panel = Image.new("RGBA", frame.size)
        draw = ImageDraw.Draw(panel)
        x, y = 49, 840
        width = math.ceil(max(font.getlength(line) for line in lines)) + 30
        height = 14 + 32 * len(lines)
        draw.rounded_rectangle(
            (x, y, x + width, y + height), radius=11,
            fill=(36, 20, 51, 246), outline=(226, 178, 246, 165),
        )
        draw.rounded_rectangle((x + 3, y + 11, x + 7, y + height - 11), radius=2, fill="#fd94aa")
        for index, line in enumerate(lines):
            draw.text((x + 17, y + 8 + 32 * index), line, font=font, fill="#fffafa", anchor="lt")
        frame.alpha_composite(panel)
    frame.save(output)


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


def draw_caption(text: str, output: Path, max_text_width: int = 520) -> None:
    canvas = Image.new("RGBA", (WIDTH, 144))
    if text:
        draw = ImageDraw.Draw(canvas)
        path = FONT_DIR / "DejaVuSans-Bold.ttf"
        size = 33
        font = ImageFont.truetype(str(path), size)
        rows = fit_caption(text, font, max_text_width)
        if len(text.splitlines()) > 3:
            text = " ".join(text.split())
            rows = fit_caption(text, font, max_text_width)
        while len(rows) > 3 and size > 18:
            size -= 1
            font = ImageFont.truetype(str(path), size)
            rows = fit_caption(text, font, max_text_width)
        for index, row in enumerate(rows[:3]):
            y = index * (size + 8)
            width = math.ceil(font.getlength(row)) + 18
            draw.rounded_rectangle((1, y, width, y + size + 7), radius=5, fill=CREAM)
            draw.text((9, y + 5), row, font=font, fill=(25, 16, 24, 255), anchor="lt")
    canvas.save(output)


def auto_captions(source: Path, scratch: Path, *, long_source: bool = False) -> list:
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
        timeout=24 if long_source else 40,
    )
    command = [sys.executable, "-m", "clipcast_template.transcript", str(audio)]
    if not long_source:
        result = subprocess.run(
            command, check=True, capture_output=True, text=True, timeout=300
        )
        return json.loads(result.stdout)
    command.append("--scan-recording")
    try:
        raw = subprocess.run(
            command, check=True, capture_output=True, timeout=62
        ).stdout
    except subprocess.TimeoutExpired as error:
        raw = error.stdout or b""
        LOGGER.info("Speech scan reached its budget. Keeping completed windows.")
    cues = []
    for entry in raw.splitlines(keepends=True):
        if entry.endswith(b"\n"):
            cues.extend(json.loads(entry))
    return sorted(cues)


def caption_timeline(
    path: Path, cues: list, duration: float, max_text_width: int = 520
) -> None:
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
            draw_caption(text, caption, max_text_width)
            playlist.write(f"file '{caption.name}'\nduration {end - start:.5f}\n")
            cursor = end
        playlist.write(f"file '{blank.name}'\n")


@dataclass(frozen=True)
class TemplateResult:
    caption_status: str
    hook: HookSuggestion


def portrait_crop(crop: str, height: int = HEIGHT) -> str:
    return (
        f"crop=w='min(iw,ih*{WIDTH}/{height})':h='min(ih,iw*{height}/{WIDTH})':"
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


def suggest_template_hook(
    source: Path, narration: str, crop: str, *, cached_cues: list | None = None
) -> HookSuggestion:
    duration, has_audio = probe_clip(source)
    if cached_cues is not None and not narration:
        return suggest_hook(source, duration, portrait_crop(crop), [text for _, _, text in cached_cues])
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


def draw_scoop_wink(output: Path) -> None:
    with Image.open(ASSETS / "scoop-stand.png") as asset:
        original = asset.convert("RGBA")
    expression = original.copy()
    eye = ImageDraw.Draw(expression)
    eye.polygon(
        [
            (94, 73),
            (106, 73),
            (122, 74),
            (146, 75),
            (143, 84),
            (138, 89),
            (131, 94),
            (121, 97),
            (113, 96),
            (105, 92),
            (99, 85),
        ],
        fill=(243, 74, 107, 255),
    )
    eye.arc((97, 68, 148, 90), 14, 170, fill=(75, 22, 48, 255), width=4)
    turned = expression.rotate(5, resample=Image.Resampling.BICUBIC, center=(160, 181))
    # Blend the tilt into the neck so the feet and standing pose stay fixed.
    mask = Image.new("L", (1, original.height))
    mask.putdata(
        [round(255 * max(0, min(1, (213 - y) / 43))) for y in range(original.height)]
    )
    Image.composite(turned, original, mask.resize(original.size)).save(output)


def render_template(
    source: Path,
    output: Path,
    hook: str,
    narration: str,
    crop: str,
    cam: str = "auto",
    template: str = DEFAULT_TEMPLATE,
    *,
    cached_cues: list | None = None,
    preserve_source_frame: bool = False,
    campaign_overlay: bytes | None = None,
) -> TemplateResult:
    if template not in REEL_TEMPLATES and template != LOGO_FREE_TEMPLATE:
        raise ValueError("Unknown Reel template")
    custom_headline = template in {CUSTOM_CHANNEL_VI_TEMPLATE, CUSTOM_GTA_CLIPCAST_TEMPLATE}
    headline = CHANNEL_VI_TEMPLATES.get("roll-that-back" if custom_headline else template)
    duration, has_audio = probe_clip(source)
    with TemporaryDirectory(prefix="template-", dir=output.parent) as temp:
        scratch = Path(temp)
        if narration:
            cues = [(0.0, duration + 0.04, narration)]
            status = "Written narration included."
        elif cached_cues is not None:
            cues = cached_cues
            status = "Automatic English captions included." if cues else "No clear speech was detected."
        else:
            cues, status = transcript_context(source, scratch, has_audio)
        if headline and not (custom_headline and hook):
            selected = HookSuggestion(headline.upper())
        elif hook or template == LOGO_FREE_TEMPLATE:
            selected = HookSuggestion(hook)
        else:
            selected = suggest_hook(
                source, duration, portrait_crop(crop), [text for _, _, text in cues]
            )
        timeline = scratch / "captions.ffconcat"
        caption_timeline(timeline, cues, duration, 350 if headline else 520)
        captions_input = ["-f", "concat", "-safe", "1", "-i", str(timeline)]
        if template == LOGO_FREE_TEMPLATE:
            hook_image = scratch / "headline.png"
            draw_caption(selected.text, hook_image, 620)
            layers = ["-i", str(hook_image), *captions_input]
            graph = (
                "[0:v]setpts=PTS-STARTPTS,fps=30,"
                f"scale={WIDTH}:574:force_original_aspect_ratio=decrease:force_divisible_by=2,"
                f"setsar=1,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2[base];"
                "[base][1:v]overlay=x=36:y=174:enable='lt(t,3)'[hook];"
                "[hook][2:v]overlay=x=36:y=938[out]"
            )
        elif template == CUSTOM_CHANNEL_VI_TEMPLATE or template in CHANNEL_VI_TEMPLATES:
            art = scratch / "channel-vi.png"
            channel_vi_frame(selected.text, art)
            layers = ["-i", str(art), *captions_input]
            frame = (
                "scale=608:426:force_original_aspect_ratio=decrease:force_divisible_by=2,"
                "pad=640:460:(ow-iw)/2:(oh-ih)/2"
                if preserve_source_frame
                else (
                    "scale=640:460:force_original_aspect_ratio=increase:flags=bicubic,"
                    f"crop=640:460:x=(iw-ow)*{CROP[crop]}"
                )
            )
            graph = (
                f"[0:v]setpts=PTS-STARTPTS,fps=30,{frame},"
                f"setsar=1,pad={WIDTH}:{HEIGHT}:40:328[base];"
                "[base][1:v]overlay[branded];[branded][2:v]overlay=x=49:y=958[out]"
            )
        elif template == CUSTOM_GTA_CLIPCAST_TEMPLATE:
            layout, _ = gameplay_layout(source, duration, crop, cam, preserve_source_frame)
            art = ASSETS / "gta-clipcast-roll-that-back.png"
            if hook:
                hook_image = scratch / "hook.png"
                draw_hook(selected.text, hook_image)
                with Image.open(art) as image, Image.open(hook_image) as title:
                    # Replace the stock headline in the GTA ClipCast artwork.
                    image.paste((0, 0, 0, 0), (0, 245, image.width, 360))
                    branded = image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
                    branded.alpha_composite(title, (26, 165))
                    art = scratch / "brand.png"
                    branded.save(art)
            layers = ["-i", str(art), *captions_input]
            graph = (
                f"{layout}[1:v]scale={WIDTH}:{HEIGHT}:flags=lanczos[art];"
                "[base][art]overlay[branded];[branded][2:v]overlay=x=32:y=884[out]"
            )
        else:
            layout, top = gameplay_layout(source, duration, crop, cam, preserve_source_frame)
            hook_image = scratch / "hook.png"
            draw_hook(selected.text, hook_image)
            wink = scratch / "scoop-wink.png"
            draw_scoop_wink(wink)
            wink_start = min(3.1, duration * 0.48)
            wink_window = f"between(t,{wink_start:.2f},{wink_start + 0.45:.2f})"
            layers = [
                "-i",
                str(ASSETS / "brand-badge.png"),
                "-i",
                str(hook_image),
                *captions_input,
                "-i",
                str(ASSETS / "scoop-stand.png"),
                "-i",
                str(wink),
            ]
            graph = (
                f"{layout}[base][1:v]overlay=x=29:y={top + 55}[logo];"
                f"[logo][2:v]overlay=x=26:y={top + 132}:enable='lt(t,4)'[hook];"
                "[hook][3:v]overlay=x=32:y=884[text];"
                "[4:v]scale=-1:235:flags=lanczos[scoop];[5:v]scale=-1:235:flags=lanczos[wink];"
                f"[text][scoop]overlay=x=W-w-59:y=H-h-87:enable='not({wink_window})'[stood];"
                f"[stood][wink]overlay=x=W-w-59:y=H-h-87:enable='{wink_window}'[out]"
            )
        if campaign_overlay:
            overlay = scratch / "campaign-overlay.png"
            with Image.open(BytesIO(campaign_overlay)) as asset:
                asset = asset.convert("RGBA")
                asset.thumbnail((400, 138), Image.Resampling.LANCZOS)
                asset.save(overlay)
            overlay_index = layers.count("-i") + 1
            overlay_y = 220 if template == CUSTOM_CHANNEL_VI_TEMPLATE or template in CHANNEL_VI_TEMPLATES else 270
            graph = (
                graph.removesuffix("[out]") + "[composed];"
                f"[composed][{overlay_index}:v]overlay=x=(W-w)/2:y={overlay_y}[out]"
            )
            layers.extend(("-i", str(overlay)))
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
                *layers,
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
            timeout=560,
        )
    if not output.stat().st_size:
        raise ValueError("Template export produced no file")
    return TemplateResult(status, selected)


def gameplay_layout(
    source: Path, duration: float, crop: str, cam: str, preserve_source_frame: bool = False
) -> tuple[str, int]:
    if preserve_source_frame:
        return (
            "[0:v]setpts=PTS-STARTPTS,fps=30,"
            f"scale={WIDTH}:480:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"setsar=1,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2[base];"
        ), 0
    camera = facecam_crop(source, duration, cam)
    top = CAM_HEIGHT if camera else 0
    game = (
        f"{portrait_crop(crop, HEIGHT - top)},"
        f"scale={WIDTH}:{HEIGHT - top}:flags=bicubic,setsar=1"
    )
    if camera:
        return (
            "[0:v]setpts=PTS-STARTPTS,fps=30,split=2[rawgame][rawcam];"
            f"[rawgame]{game}[game];[rawcam]{camera},setsar=1[cam];"
            "[cam][game]vstack=inputs=2[base];"
        ), top
    return f"[0:v]setpts=PTS-STARTPTS,fps=30,{game}[base];", top
