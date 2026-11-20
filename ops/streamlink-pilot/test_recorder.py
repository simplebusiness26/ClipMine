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


def test_private_parallel_captures_and_scoop_export(monkeypatch):
    started = {"clix": Event(), "second": Event()}
    release = Event()

    class FakeChat:
        def __init__(self, channel):
            assert channel in started
            self.connected = True
            self.counts = Counter({10: 21})
            self.laughter = Counter({10: 9})

        def start(self):
            pass

        def close(self):
            pass

        def progress(self, seconds):
            pass

    def finish_capture(url, output, on_progress, *, quality, max_bytes):
        channel = url.rsplit("/", 1)[-1]
        assert quality.startswith("1080p60,1080p,")
        assert max_bytes == 650 * app.MIB
        started[channel].set()
        assert release.wait(3)
        output.write_bytes(channel.encode())
        return app.Capture(601, 1080)

    def finish_scoop(source, output, script, crop):
        assert source.read_bytes() == b"clix highlight"
        assert script == "chat-laugh"
        assert crop == "right"
        output.write_bytes(b"branded clip")

    monkeypatch.setattr(app, "capture_mp4", finish_capture)
    monkeypatch.setattr(app, "ChatMonitor", FakeChat)
    monkeypatch.setattr(app, "detect_laughter", lambda *_: {51: 0.88})
    monkeypatch.setattr(
        app,
        "cut_clip",
        lambda source, output, clip: output.write_bytes(
            source.read_bytes() + b" highlight"
        ),
    )
    monkeypatch.setattr(app, "render_scoop", finish_scoop)

    with TestClient(app.create_app("clix", PASSWORD)) as client:
        assert client.get("/healthz").json()["capture_slots"] == 2
        assert client.get("/").status_code == 401
        assert client.get("/", auth=("recorder", "wrong")).status_code == 401

        page = client.get("/", auth=AUTH)
        assert '<option value="720p" selected>' in page.text
        assert 'type="text" value="clix"' in page.text
        token = re.search(r'name="token" value="([^"]+)"', page.text).group(1)
        permitted = {
            "token": token,
            "confirm": "yes",
            "quality": "1080p",
            "channels": "@Clix, second",
        }
        assert client.post("/record", data=permitted).status_code == 401
        for invalid in ("https://example.test", "clix, second, third"):
            assert client.post(
                "/record", data={**permitted, "channels": invalid}, auth=AUTH
            ).status_code in (400, 409)
        assert (
            client.post(
                "/record", data={**permitted, "token": "bad"}, auth=AUTH
            ).status_code
            == 403
        )

        try:
            assert (
                client.post(
                    "/record", data=permitted, auth=AUTH, follow_redirects=False
                ).status_code
                == 303
            )
            assert started["clix"].wait(2)
            assert started["second"].wait(2)
            assert "2 of 2 recording slots in use" in client.get("/", auth=AUTH).text
            assert client.post("/record", data=permitted, auth=AUTH).status_code == 409
        finally:
            release.set()

        deadline = monotonic() + 2
        while monotonic() < deadline:
            result = client.get("/", auth=AUTH).text
            if result.count("Capture ready") == 2:
                break
            sleep(0.02)
        assert result.count("1080p source") == 2
        assert result.count("Make Scoop version") == 2
        links = re.findall(r'href="(/jobs/[^/]+/clips/1)"', result)
        assert len(links) == 2
        clix = next(
            link
            for link in links
            if client.get(link, auth=AUTH).content.startswith(b"clix")
        )
        second = next(link for link in links if link != clix)
        assert client.get(clix).status_code == 401
        assert client.get(f"{clix}/scoop", auth=AUTH).status_code == 404
        assert (
            client.post(
                f"{clix}/scoop",
                data={"token": token, "script": "chat-laugh", "crop": "right"},
                auth=AUTH,
                follow_redirects=False,
            ).status_code
            == 303
        )

        deadline = monotonic() + 2
        while monotonic() < deadline:
            branded = client.get(f"{clix}/scoop", auth=AUTH)
            if branded.status_code == 200:
                break
            sleep(0.02)
        assert branded.content == b"branded clip"
        assert client.get(f"{clix}/scoop").status_code == 401
        assert client.get(clix, auth=AUTH).content == b"clix highlight"
        assert client.get(second, auth=AUTH).content == b"second highlight"
        root = clix.rsplit("/clips", 1)[0]
        assert client.get(f"{root}/original", auth=AUTH).content == b"clix"
        assert (
            client.post(
                f"{root}/clear",
                data={"token": token},
                auth=AUTH,
                follow_redirects=False,
            ).status_code
            == 303
        )
        assert client.get(clix, auth=AUTH).status_code == 404
        assert client.get(second, auth=AUTH).status_code == 200


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
                f"hls://http://{address}:{port}/sample.m3u8",
                result,
                quality="best",
                max_bytes=500 * app.MIB,
            )
        finally:
            server.shutdown()
            thread.join(timeout=2)

    assert result.stat().st_size > 0
    assert abs(actual.duration - 600) <= 1
    assert actual.height == 90
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
