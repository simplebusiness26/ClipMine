FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home recorder
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
USER recorder

CMD ["sh", "-c", "exec uvicorn app:create_render_app --factory --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
