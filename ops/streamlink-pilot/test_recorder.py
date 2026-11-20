import re
import subprocess
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from time import monotonic, sleep

from fastapi.testclient import TestClient

import app

PASSWORD = "synthetic-test-password-only"
AUTH = ("recorder", PASSWORD)


def test_private_capture_flow(monkeypatch):
    started = Event()
    release = Event()

    def finish_capture(url, output):
        assert url == "https://www.twitch.tv/clipcasttest"
        started.set()
        assert release.wait(3)
        output.write_bytes(b"synthetic file")
        return 601.0

    monkeypatch.setattr(app, "capture_mp4", finish_capture)
    with TestClient(app.create_app("clipcasttest", PASSWORD)) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/").status_code == 401
        assert client.get("/download").status_code == 401
        assert client.get("/", auth=("recorder", "wrong")).status_code == 401

        page = client.get("/", auth=AUTH)
        token = re.search(r'name="token" value="([^"]+)"', page.text).group(1)
        permitted = {"token": token, "confirm": "yes"}
        assert client.post("/record", data=permitted).status_code == 401
        assert (
            client.post("/record", data={"token": token}, auth=AUTH).status_code == 400
        )
        assert (
            client.post(
                "/record",
                data={"token": "bad", "confirm": "yes"},
                auth=AUTH,
            ).status_code
            == 403
        )

        assert (
            client.post(
                "/record",
                data=permitted,
                auth=AUTH,
                follow_redirects=False,
            ).status_code
            == 303
        )
        try:
            assert started.wait(2)
            assert "Recording now" in client.get("/", auth=AUTH).text
            assert client.post("/record", data=permitted, auth=AUTH).status_code == 409
        finally:
            release.set()

        deadline = monotonic() + 2
        while (
            "Capture ready" not in client.get("/", auth=AUTH).text
            and monotonic() < deadline
        ):
            sleep(0.02)
        result = client.get("/download", auth=AUTH)
        assert result.status_code == 200
        assert result.content == b"synthetic file"
        assert result.headers["content-type"] == "video/mp4"
        assert (
            client.post("/clear", data={"token": token}, auth=AUTH).status_code == 200
        )
        assert client.get("/download", auth=AUTH).status_code == 404


def test_streamlink_and_ffmpeg_create_ten_minute_mp4(tmp_path: Path):
    source = tmp_path / "synthetic"
    source.mkdir()
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000",
            "-t",
            "606",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-g",
            "10",
            "-c:a",
            "aac",
            "-f",
            "hls",
            "-hls_time",
            "6",
            "-hls_playlist_type",
            "vod",
            str(source / "sample.m3u8"),
        ],
        check=True,
        timeout=40,
    )

    handler = partial(SimpleHTTPRequestHandler, directory=source)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        address, port = server.server_address
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = tmp_path / "result.mp4"
            actual = app.capture_mp4(
                f"hls://http://{address}:{port}/sample.m3u8", result
            )
        finally:
            server.shutdown()
            thread.join(timeout=2)

    assert result.stat().st_size > 0
    assert abs(actual - 600) <= 1
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "csv=p=0",
            str(result),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert set(probe.stdout.splitlines()) == {"h264", "aac"}
