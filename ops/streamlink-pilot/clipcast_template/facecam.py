"""Locate a stationary face near the corners of a composite stream."""

import logging
import os
import subprocess
from pathlib import Path
from statistics import median

import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL = Path(os.environ.get("CLIPCAST_FACE_MODEL", "/app/facecam.tflite"))
LOGGER = logging.getLogger(__name__)
CORNERS = {
    "top-left": (0.0, 0.0),
    "top-right": (0.63, 0.0),
    "bottom-left": (0.0, 0.57),
    "bottom-right": (0.63, 0.57),
}
FACECAM_OPTIONS = {"auto", "off", *CORNERS}
REGION_WIDTH, REGION_HEIGHT = 0.37, 0.43
FRAME_WIDTH, FRAME_HEIGHT = 352, 198
CAM_HEIGHT = 244
ANCHORS = np.asarray(
    [
        ((x + 0.5) / grid, (y + 0.5) / grid)
        for grid, repeat in ((16, 2), (8, 6))
        for y in range(grid)
        for x in range(grid)
        for _ in range(repeat)
    ],
    dtype=np.float32,
)


def facecam_crop(source: Path, duration: float, mode: str) -> str | None:
    if mode == "off":
        return None
    if mode in CORNERS:
        x, y = CORNERS[mode]
        return crop_region(x, y, REGION_WIDTH, REGION_HEIGHT)
    try:
        centre = analyse_faces(source, duration)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        LOGGER.info("Facecam detection unavailable (%s)", type(error).__name__)
        return None
    if centre is None:
        return None
    x, y, face_height = centre
    width = max(0.21, min(0.31, face_height * 1.6))
    height = max(0.15, min(0.28, face_height * 1.65))
    return crop_region(
        max(0, min(1 - width, x - width / 2)),
        max(0, min(1 - height, y - height / 2)),
        width,
        height,
    )


def crop_region(x: float, y: float, width: float, height: float) -> str:
    return (
        f"crop=w=iw*{width:.5f}:h=ih*{height:.5f}:x=iw*{x:.5f}:y=ih*{y:.5f},"
        f"scale=w=720:h={CAM_HEIGHT}:force_original_aspect_ratio=increase:flags=bicubic,"
        f"crop=720:{CAM_HEIGHT}"
    )


def analyse_faces(source: Path, duration: float) -> tuple[float, float, float] | None:
    # Probe a few low-resolution keyframes independently from hook detection.
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "1",
            "-skip_frame",
            "nokey",
            "-i",
            str(source),
            "-an",
            "-filter_threads",
            "1",
            "-vf",
            f"fps={5 / duration:.8f}:round=up,scale={FRAME_WIDTH}:{FRAME_HEIGHT}:flags=area",
            "-frames:v",
            "5",
            "-c:v",
            "rawvideo",
            "-threads",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=65,
    )
    frames = np.frombuffer(result.stdout, dtype=np.uint8).reshape(
        -1, FRAME_HEIGHT, FRAME_WIDTH, 3
    )
    if len(frames) < 3:
        return None
    detector = Interpreter(model_path=str(MODEL), num_threads=1)
    detector.allocate_tensors()
    (input_info,) = detector.get_input_details()
    coords_id, score_id = (output["index"] for output in detector.get_output_details())
    from PIL import Image, ImageOps

    possible = []
    for left, top in CORNERS.values():
        observations = []
        for frame in frames:
            area = Image.fromarray(frame).crop(
                (
                    round(left * FRAME_WIDTH),
                    round(top * FRAME_HEIGHT),
                    round((left + REGION_WIDTH) * FRAME_WIDTH),
                    round((top + REGION_HEIGHT) * FRAME_HEIGHT),
                )
            )
            ratio = min(128 / area.width, 128 / area.height)
            fitted_width = area.width * ratio / 128
            fitted_height = area.height * ratio / 128
            rgb = np.asarray(ImageOps.pad(area, (128, 128)), dtype=np.float32)
            detector.set_tensor(input_info["index"], rgb[None] / 127.5 - 1.0)
            detector.invoke()
            scores = detector.get_tensor(score_id)[0, :, 0]
            best = int(np.argmax(scores))
            if scores[best] < 0.62:
                continue
            coords = detector.get_tensor(coords_id)[0, best]
            x, y = ANCHORS[best] + coords[:2] / 128
            x = (x - (1 - fitted_width) / 2) / fitted_width
            y = (y - (1 - fitted_height) / 2) / fitted_height
            size = float(coords[3] / 128 / fitted_height) * REGION_HEIGHT
            if 0.045 <= size <= 0.265 and 0.09 <= x <= 0.91 and 0.12 <= y <= 0.88:
                observations.append(
                    (
                        float(left + x * REGION_WIDTH),
                        float(top + y * REGION_HEIGHT),
                        size,
                    )
                )
        if len(observations) < max(3, len(frames) - 1):
            continue
        centre = tuple(median(items) for items in zip(*observations))
        if (
            max(abs(x - centre[0]) + abs(y - centre[1]) for x, y, _ in observations)
            <= 0.095
        ):
            possible.append(centre)
    return possible[0] if len(possible) == 1 else None
