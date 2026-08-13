from __future__ import annotations

import argparse
import json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Isolated ClipMine transcription worker")
    parser.add_argument("--source", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--compute-type", required=True)
    parser.add_argument("--language", default="auto")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    raw_segments, _info = model.transcribe(
        args.source,
        language=None if args.language == "auto" else args.language,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=True,
    )
    segments = []
    for item in raw_segments:
        text = item.text.strip() if item.text else ""
        if not text:
            continue
        start = max(0, float(item.start))
        segments.append(
            {
                "start_seconds": start,
                "end_seconds": max(float(item.end), start + 0.05),
                "text": text,
            }
        )

    print(
        json.dumps(
            {
                "analysis_mode": f"faster-whisper:{args.model}",
                "segments": segments,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
