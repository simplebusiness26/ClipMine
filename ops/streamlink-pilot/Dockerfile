# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-dejavu-extra \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home recorder
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py highlights.py .
COPY clipcast_template ./clipcast_template
ADD --checksum=sha256:10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite /app/yamnet.tflite
ADD --checksum=sha256:c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin /app/ggml-tiny.en-q5_1.bin
ADD --checksum=sha256:2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/object_detection/android/lite-model_efficientdet_lite0_detection_metadata_1.tflite /app/efficientdet-lite0.tflite
RUN chmod 644 /app/yamnet.tflite /app/ggml-tiny.en-q5_1.bin /app/efficientdet-lite0.tflite
# Verify the bundled model and the image's ability to encode a branded clip.
RUN set -eu; work="$(mktemp -d)"; \
    ffmpeg -nostdin -v error -f lavfi -i color=c=blue:s=320x180:r=30 \
        -f lavfi -i sine=f=440:r=16000 -t 1 -c:v libx264 -threads 1 -c:a aac "$work/input.mp4"; \
    ffmpeg -nostdin -v error -i "$work/input.mp4" -vn "$work/test.wav"; \
    python -m clipcast_template.transcript "$work/test.wav" > /dev/null; \
    python -c 'import numpy as np; from clipcast_template.hooks import OBJECT_MODEL, detect_objects; assert len(detect_objects(np.zeros((1,320,320,3),dtype=np.uint8),OBJECT_MODEL))==1'; \
    python -c 'from pathlib import Path; import sys; from clipcast_template.render import render_template; p=Path(sys.argv[1]); render_template(p/"input.mp4",p/"output.mp4","ROLL THAT BACK","Four bikes. One late arrival.","center")' "$work"; \
    ffmpeg -nostdin -v error -xerror -i "$work/output.mp4" -f null -; \
    rm -rf "$work"
USER recorder

CMD ["sh", "-c", "exec uvicorn app:create_render_app --factory --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
