# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home recorder
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py highlights.py .
COPY scoop ./scoop
ADD --checksum=sha256:10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite /app/yamnet.tflite
RUN chmod 644 /app/yamnet.tflite
# Verify the image's FFmpeg can build and decode a branded export from scratch.
RUN set -eu; work="$(mktemp -d)"; \
    ffmpeg -nostdin -v error -f lavfi -i color=c=blue:s=320x180:r=30 -t 1 \
        -c:v libx264 -threads 1 "$work/input.mp4"; \
    python -c 'from pathlib import Path; import sys; from scoop.render import render_scoop; p=Path(sys.argv[1]); render_scoop(p/"input.mp4",p/"output.mp4","chat-spike","center")' "$work"; \
    ffmpeg -nostdin -v error -xerror -i "$work/output.mp4" -f null -; \
    rm -rf "$work"
USER recorder

CMD ["sh", "-c", "exec uvicorn app:create_render_app --factory --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
