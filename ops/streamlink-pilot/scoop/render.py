"""Export a 9:16 highlight using the standing Scoop commentary layout."""

import json
import math
import subprocess
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent / "assets"
WIDTH, HEIGHT, FPS = 720, 1280, 30
CROP = {"left": "0.30", "center": "0.50", "right": "0.70"}
SCRIPT_CHOICES = {
    "audio-laugh": (
        "Caught laughing",
        "Sound up. Hear that laugh? That's where this went sideways.",
        "I'd take a statement, but I can barely stand on one leg.",
    ),
    "chat-laugh": (
        "Chat was laughing",
        "Chat saw something funny. Keep an eye on what happens next.",
        "I asked chat for witnesses. They sent me laughing emojis.",
    ),
    "chat-spike": (
        "Chat lit up",
        "Chat just woke up. Here's the bit that got them typing.",
        "That's going in my case file. Right under 'seemed like a good idea'.",
    ),
}


def choose_script(reasons: tuple[str, ...]) -> str:
    if "Laughter in stream audio" in reasons:
        return "audio-laugh"
    if "Laugh reactions in chat" in reasons:
        return "chat-laugh"
    return "chat-spike"


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
    video = next(
        (stream for stream in metadata["streams"] if stream["codec_type"] == "video"),
        {},
    )
    duration = float(video.get("duration", "nan"))
    if not math.isfinite(duration):
        duration = float(metadata["format"]["duration"])
    if not video or not math.isfinite(duration) or not 0 < duration <= 40:
        raise ValueError("Invalid highlight duration")
    return duration, any(s["codec_type"] == "audio" for s in metadata["streams"])


def draw_hook(text: str, output: Path) -> None:
    canvas = Image.new("RGBA", (WIDTH, 245))
    with Image.open(ASSETS / "brand.png") as brand:
        canvas.alpha_composite(brand.convert("RGBA"))
    draw = ImageDraw.Draw(canvas)
    family = ASSETS / "ClipCast-Hook-2.ttf"
    if not text.isascii():
        family = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
    font = ImageFont.truetype(str(family), 24)
    rows = [""]
    for word in text.upper().split():
        candidate = f"{rows[-1]} {word}".strip()
        if rows[-1] and font.getlength(candidate) > 470:
            rows.append(word)
        else:
            rows[-1] = candidate
    if len(rows) > 3 or max(map(font.getlength, rows)) > 630:
        raise ValueError("Use a shorter hook with normal word breaks.")
    width = math.ceil(max(map(font.getlength, rows))) + 33
    draw.rounded_rectangle(
        (38, 145, 38 + width, 152 + 27 * len(rows)),
        radius=9,
        fill=(22, 10, 32, 229),
        outline=(255, 117, 155, 217),
        width=2,
    )
    draw.rectangle((44, 151, 47, 145 + 26 * len(rows)), fill=(255, 117, 155, 255))
    for index, row in enumerate(rows):
        draw.text(
            (56, 151 + index * 27), row, font=font, fill=(255, 242, 233), anchor="lt"
        )
    canvas.save(output)


def voice_poses(path: Path) -> tuple[float, list[str]]:
    with wave.open(str(path), "rb") as opened:
        rate = opened.getframerate()
        duration = opened.getnframes() / rate
        poses = []
        for _ in range(math.ceil(duration * 25)):
            samples = opened.readframes(rate // 25)
            if not samples:
                break
            audio = memoryview(samples).cast("h")
            rms = (sum(sample * sample for sample in audio) / len(audio)) ** 0.5
            poses.append("D" if rms >= 1900 else "B" if rms >= 550 else "X")
    return len(poses) / 25, poses


def mascot_timeline(
    path: Path, opening: list[str], duration: float, ending: list[str]
) -> None:
    spans: list[tuple[str, float]] = []
    for key, seconds in [
        *((pose, 0.04) for pose in opening),
        ("X", duration),
        *((pose, 0.04) for pose in ending),
        ("X", 0.08),
    ]:
        if spans and spans[-1][0] == key:
            spans[-1] = (key, spans[-1][1] + seconds)
        else:
            spans.append((key, seconds))
    with path.open("w", encoding="ascii") as file:
        file.write("ffconcat version 1.0\n")
        for key, seconds in spans:
            file.write(
                f"file '{ASSETS / ('pose-' + key + '.png')}'\nduration {seconds:.6f}\n"
            )
        file.write(f"file '{ASSETS / 'pose-X.png'}'\n")


def render_scoop(source: Path, output: Path, script: str, crop: str) -> None:
    duration, has_audio = probe_clip(source)
    with TemporaryDirectory(prefix="scoop-", dir=output.parent) as scratch:
        work = Path(scratch)
        artwork = work / "brand.png"
        _, hook, _ = SCRIPT_CHOICES[script]
        draw_hook(hook, artwork)
        first, last = work / "line-1.wav", work / "line-2.wav"
        for index, target in enumerate((first, last), 1):
            subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    str(ASSETS / f"{script}-{index}.ogg"),
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "-c:a",
                    "pcm_s16le",
                    str(target),
                ],
                check=True,
                stderr=subprocess.DEVNULL,
                timeout=12,
            )
        opening, intro_poses = voice_poses(first)
        closing, end_poses = voice_poses(last)
        timeline = work / "mascot.ffconcat"
        mascot_timeline(timeline, intro_poses, duration, end_poses)
        video_graph = (
            "setpts=PTS-STARTPTS,"
            "crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':"
            f"x='(iw-ow)*{CROP[crop]}':y='(ih-oh)*0.5',"
            f"scale={WIDTH}:{HEIGHT}:flags=bicubic,setsar=1,fps={FPS},"
            f"tpad=start_mode=clone:start_duration={opening}:"
            f"stop_mode=clone:stop_duration={closing}"
        )
        audio_graph = (
            "[3:a]aformat=channel_layouts=stereo,"
            f"apad=whole_dur={opening},atrim=duration={opening}[intro];"
            "[4:a]aformat=channel_layouts=stereo,"
            f"apad=whole_dur={closing},atrim=duration={closing}[outro];"
        )
        if has_audio:
            audio_graph += (
                "[0:a]aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,"
                f"apad,atrim=duration={duration:.6f},volume=0.88[scene];"
            )
        else:
            audio_graph += (
                f"anullsrc=r=48000:cl=stereo,atrim=duration={duration:.6f}[scene];"
            )
        graph = (
            f"[0:v]{video_graph}[game];"
            "[2:v]format=rgba[mascot];"
            "[game][mascot]overlay=x=W-w-63:y=H-h-6[cast];"
            "[cast][1:v]overlay=x=0:y=0:enable='between(t,0,4)'[hook];"
            f"[hook][5:v]overlay=x=0:y=0:enable='gt(t,4)'[picture];"
            f"{audio_graph}[intro][scene][outro]concat=n=3:v=0:a=1[mix]"
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
                str(artwork),
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(timeline),
                "-i",
                str(first),
                "-i",
                str(last),
                "-i",
                str(ASSETS / "brand.png"),
                "-filter_complex_threads",
                "1",
                "-filter_complex",
                graph,
                "-map",
                "[picture]",
                "-map",
                "[mix]",
                "-t",
                f"{opening + duration + closing:.6f}",
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
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
            stderr=subprocess.DEVNULL,
            timeout=390,
        )
    if not output.stat().st_size:
        raise ValueError("Scoop export produced no file")
