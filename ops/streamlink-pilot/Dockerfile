# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home recorder
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py highlights.py .
ADD --checksum=sha256:10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite /app/yamnet.tflite
RUN chmod 644 /app/yamnet.tflite
USER recorder

CMD ["sh", "-c", "exec uvicorn app:create_render_app --factory --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
