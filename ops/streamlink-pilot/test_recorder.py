import re
import subprocess
from collections import Counter
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

    class FakeChat:
        def __init__(self, channel):
            assert channel == "clipcasttest"
            self.connected = True
            self.counts = Counter({10: 21})
            self.laughter = Counter({10: 9})

        def start(self):
            pass

        def close(self):
            pass

        def progress(self, seconds):
            pass

    def finish_capture(url, output, on_progress):
        assert url == "https://www.twitch.tv/clipcasttest"
        started.set()
        assert release.wait(3)
        output.write_bytes(b"synthetic file")
        return 601.0

    monkeypatch.setattr(app, "capture_mp4", finish_capture)
    monkeypatch.setattr(app, "ChatMonitor", FakeChat)
    monkeypatch.setattr(app, "detect_laughter", lambda *_: {51: 0.88})
    monkeypatch.setattr(
        app, "cut_clip", lambda _, output, clip: output.write_bytes(b"clip")
    )

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
            assert (
                "Recording the stream and watching chat"
                in client.get("/", auth=AUTH).text
            )
            assert client.post("/record", data=permitted, auth=AUTH).status_code == 409
        finally:
            release.set()

        deadline = monotonic() + 2
        while (
            "Capture ready" not in client.get("/", auth=AUTH).text
            and monotonic() < deadline
        ):
            sleep(0.02)
        final = client.get("/", auth=AUTH)
        assert "Best bits" in final.text
        assert "Chat spike" in final.text
        assert "Laughter in stream audio" in final.text
        assert client.get("/clips/1").status_code == 401
        assert client.get("/clips/1", auth=AUTH).content == b"clip"
        assert client.get("/clips/2", auth=AUTH).status_code == 404
        result = client.get("/download", auth=AUTH)
        assert result.status_code == 200
        assert result.content == b"synthetic file"
        assert result.headers["content-type"] == "video/mp4"
        assert (
            client.post("/clear", data={"token": token}, auth=AUTH).status_code == 200
        )
        assert client.get("/download", auth=AUTH).status_code == 404
        assert client.get("/clips/1", auth=AUTH).status_code == 404


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


def test_chat_messages_map_to_capture_and_count_laughter():
    from highlights import ChatMonitor

    chat = ChatMonitor("CLIX")
    chat.progress(31)
    now = monotonic()
    chat.consume("@a=1 :person!p@tmi.twitch.tv PRIVMSG #clix :LMAO 😂", now)
    chat.consume(":person!p@tmi.twitch.tv PRIVMSG #clix :normal", now)
    chat.consume(":person!p@tmi.twitch.tv PRIVMSG #other :LMAO", now)
    assert chat.counts == {5: 2}
    assert chat.laughter == {5: 1}


def test_ranked_clips_merge_similar_windows_and_skip_quiet_content():
    from highlights import select_clips

    assert not select_clips(600, Counter(), Counter(), {})
    clips = select_clips(
        600,
        Counter({4: 12, 5: 14, 19: 35}),
        Counter({19: 11}),
        {22: 0.8, 94: 0.98},
    )
    assert len(clips) == 2
    assert clips[0].start <= 94 < clips[0].end
    assert clips[1].start <= 22 < clips[1].end
    assert "Laughter in stream audio" in clips[0].reasons
    assert "Laugh reactions in chat" in clips[0].reasons
