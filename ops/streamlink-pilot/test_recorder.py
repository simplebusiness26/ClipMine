import json
import re
import subprocess
from collections import Counter
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from time import monotonic, sleep
from urllib.parse import quote

from fastapi.testclient import TestClient

import app
from clipcast_template.hooks import HookSuggestion
from clipcast_template.render import TemplateResult
from highlights import SoundSignals

PASSWORD = "synthetic-test-password-only"
AUTH = ("recorder", PASSWORD)


def test_five_stream_batch_caps_results_and_reopens_after_restart(monkeypatch):
    started = {name: Event() for name in ("clix", "second", "third", "fourth", "fifth")}
    release = Event()
    release_first = Event()
    rendering = Event()
    release_render = Event()

    class FakeChat:
        def __init__(self, channel):
            self.connected = True
            self.counts = Counter()
            self.laughter = Counter()

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
        assert (release_first if channel == "clix" else release).wait(8)
        output.write_bytes(channel.encode())
        return app.Capture(600, 1080)

    def candidates(*args, **kwargs):
        return [
            app.Clip(n * 40, n * 40 + 20, ("Action sounds",), 9 - n) for n in range(8)
        ]

    def finish_template(source, output, hook, narration, crop, cam, template):
        assert source.read_bytes().endswith(b" highlight")
        assert (hook, narration, crop, cam) == (
            "ROLL THAT BACK",
            "Four bikes.",
            "right",
            "top-left",
        )
        assert template == "it-was-going-well"
        rendering.set()
        assert release_render.wait(5)
        output.write_bytes(b"branded clip")
        return TemplateResult("Written narration included.", HookSuggestion(hook))

    monkeypatch.setattr(app, "capture_mp4", finish_capture)
    monkeypatch.setattr(app, "ChatMonitor", FakeChat)
    monkeypatch.setattr(app, "detect_sound", lambda *_: SoundSignals({}, {}))
    monkeypatch.setattr(app, "detect_motion", lambda *_: {})
    monkeypatch.setattr(app, "auto_captions", lambda *args, **kwargs: [])
    monkeypatch.setattr(app, "select_clips", candidates)
    cuts = []

    def fake_cut(source, output, clip):
        cuts.append(clip)
        output.write_bytes(source.read_bytes() + b" highlight")

    monkeypatch.setattr(app, "cut_clip", fake_cut)
    monkeypatch.setattr(app, "render_template", finish_template)
    monkeypatch.setattr(app, "probe_clip", lambda _: (20.0, True))
    monkeypatch.setattr(
        app, "disk_usage", lambda _: type("Disk", (), {"free": 8 * 1024**3})()
    )

    with TestClient(app.create_app("clix", PASSWORD)) as client:
        assert client.get("/healthz").json()["capture_slots"] == 5
        assert client.get("/saved").status_code == 401
        assert client.get("/saved-clips.js").status_code == 401
        token = re.search(
            r'name="token" value="([^"]+)"', client.get("/", auth=AUTH).text
        )[1]
        fields = {
            "token": token,
            "confirm": "yes",
            "quality": "1080p",
            "channels": ", ".join(started),
        }
        try:
            reply = client.post(
                "/record", data=fields, auth=AUTH, follow_redirects=False
            )
            assert reply.status_code == 303
            monitor = reply.headers["location"]
            assert monitor.startswith("/runs/")
            assert all(event.wait(2) for event in started.values())
            assert 'data-view="capture"' in client.get(monitor, auth=AUTH).text
            assert client.get(monitor + "/manifest").status_code == 401
            result = client.get(monitor + "/manifest", auth=AUTH).json()
            assert not result["complete"] and len(result["channels"]) == 5
            release_first.set()
            deadline = monotonic() + 3
            while monotonic() < deadline:
                result = client.get(monitor + "/manifest", auth=AUTH).json()
                if len(result["clips"]) == 2:
                    break
                sleep(0.03)
            assert not result["complete"] and len(result["clips"]) == 2
            assert {clip["channel"] for clip in result["clips"]} == {"clix"}
            first_ids = {clip["id"] for clip in result["clips"]}
            assert (
                client.get(result["clips"][0]["url"], auth=AUTH).content
                == b"clix highlight"
            )
            assert (
                client.post(
                    monitor + "/saved", data={"token": token}, auth=AUTH
                ).status_code
                == 409
            )
        finally:
            release.set()

        deadline = monotonic() + 3
        while monotonic() < deadline:
            result = client.get(monitor + "/manifest", auth=AUTH).json()
            if result["complete"]:
                break
            sleep(0.03)
        assert result["complete"]
        assert len(result["clips"]) == 10 and len(cuts) == 10
        assert first_ids <= {clip["id"] for clip in result["clips"]}
        assert len({clip["channel"] for clip in result["clips"]}) == 5
        preview = result["clips"][0]["url"]
        assert client.get(preview).status_code == 401
        byte_range = client.get(preview, auth=AUTH, headers={"Range": "bytes=0-3"})
        assert byte_range.status_code == 206
        assert byte_range.headers["content-disposition"] == "inline"
        original = client.get(preview, auth=AUTH).content
        assert len(original) == result["clips"][0]["bytes"]
        batch = result["id"]
        edit_url = result["clips"][0]["edit_url"]
        options = {
            "kind": "reel",
            "hook": "ROLL THAT BACK",
            "narration": "Four bikes.",
            "crop": "right",
            "cam": "top-left",
            "template": "it-was-going-well",
            "request_id": "a" * 32,
        }
        assert client.get(edit_url).status_code == 401
        assert (
            client.post(
                edit_url,
                json={**options, "template": "../unknown"},
                headers={"X-ClipCast-Token": token},
                auth=AUTH,
            ).status_code
            == 400
        )
        assert (
            client.post(
                edit_url,
                json=options,
                headers={"X-ClipCast-Token": "invalid"},
                auth=AUTH,
            ).status_code
            == 403
        )
        try:
            for _ in range(2):
                queued = client.post(
                    edit_url,
                    json=options,
                    headers={"X-ClipCast-Token": token},
                    auth=AUTH,
                )
                assert queued.status_code == 202
                assert not queued.json()["done"]
            assert rendering.wait(3)
        finally:
            release_render.set()

        deadline = monotonic() + 3
        while monotonic() < deadline:
            reopened = client.get(monitor + "/manifest", auth=AUTH).json()
            edit = reopened["clips"][0]["edit"]
            if edit["done"]:
                break
            sleep(0.03)
        assert edit["phase"] == "ready"
        assert client.get(edit["url"], auth=AUTH).content == b"branded clip"
        assert (
            client.post(
                monitor + "/saved",
                data={"token": token, "revision": result["revision"]},
                auth=AUTH,
            ).status_code
            == 409
        )
        assert (
            client.post(
                monitor + "/saved",
                data={"token": token, "revision": reopened["revision"]},
                auth=AUTH,
            ).status_code
            == 204
        )
        assert client.get(preview, auth=AUTH).content == original
        assert client.get(edit["url"], auth=AUTH).content == b"branded clip"
        assert (
            client.get(monitor + "/manifest", auth=AUTH).json()["saved_revision"]
            == (reopened["revision"])
        )

        assert (
            client.post(
                monitor + "/saved/forget", data={"token": token}, auth=AUTH
            ).status_code
            == 204
        )
        next_fields = {**fields, "channels": "clix, second"}
        assert client.post("/record", data=next_fields, auth=AUTH).status_code == 409
        assert (
            client.post(
                monitor + "/saved",
                data={"token": token, "revision": reopened["revision"]},
                auth=AUTH,
            ).status_code
            == 204
        )
        new_run = client.post(
            "/record", data=next_fields, auth=AUTH, follow_redirects=False
        )
        assert new_run.status_code == 303
        assert client.get(preview, auth=AUTH).status_code == 404
        deadline = monotonic() + 3
        while monotonic() < deadline:
            if client.get(new_run.headers["location"] + "/manifest", auth=AUTH).json()[
                "complete"
            ]:
                break
            sleep(0.03)
        else:
            raise AssertionError("The next run did not finish")

    # The review URL still boots with a new worker; the browser supplies the saved file.
    with TestClient(app.create_app("clix", PASSWORD)) as client:
        review = client.get(f"/saved/{batch}", auth=AUTH)
        assert 'data-view="review"' in review.text and "setInterval" not in review.text
        assert "Channel VI · It Was Going Well" in review.text
        token = re.search(r'data-token="([^"]+)"', review.text)[1]
        form = {
            "token": token,
            "kind": "reel",
            "hook": "ROLL THAT BACK",
            "narration": "Four bikes.",
            "crop": "right",
            "cam": "top-left",
            "template": "it-was-going-well",
        }
        reply = client.post(
            "/saved-edits",
            data=form,
            files={"video": ("highlight.mp4", original)},
            auth=AUTH,
        )
        assert reply.status_code == 202
        edit = "/saved-edits/" + reply.json()["id"]
        deadline = monotonic() + 3
        while monotonic() < deadline:
            if client.get(edit, auth=AUTH).json()["done"]:
                break
            sleep(0.03)
        assert client.get(edit + "/video", auth=AUTH).content == b"branded clip"

        session = client.get("/saved-edits/session", auth=AUTH)
        assert session.headers["Cache-Control"] == "private, no-store"
        assert session.json()["token"] == token
        options = {key: value for key, value in form.items() if key != "token"}
        headers = {
            "Content-Type": "video/mp4",
            "X-ClipCast-Token": token,
            "X-ClipCast-Options": quote(json.dumps(options)),
            "X-ClipCast-Size": str(len(original)),
        }
        for _ in range(3):
            incomplete = client.post(
                "/saved-edits/video", content=original[:-1], headers=headers, auth=AUTH
            )
            assert incomplete.status_code == 400
        reply = client.post(
            "/saved-edits/video", content=original, headers=headers, auth=AUTH
        )
        assert reply.status_code == 202
        edit = "/saved-edits/" + reply.json()["id"]
        deadline = monotonic() + 3
        while monotonic() < deadline:
            if client.get(edit, auth=AUTH).json()["done"]:
                break
            sleep(0.03)
        assert client.get(edit + "/video", auth=AUTH).content == b"branded clip"

        chunk_size = 4
        monkeypatch.setattr(app, "ARCHIVE_CHUNK_BYTES", chunk_size)
        upload = "/saved-edits/uploads/" + "a" * 32
        token_header = {"X-ClipCast-Token": token}
        begin = client.put(
            upload,
            json={**options, "size": len(original)},
            headers=token_header,
            auth=AUTH,
        )
        assert begin.json() == {"chunk_bytes": chunk_size, "received": 0}
        assert (
            client.post(upload + "/finish", headers=token_header, auth=AUTH).status_code
            == 409
        )
        for offset in range(0, len(original), chunk_size):
            part_url = f"{upload}/parts/{offset}"
            data = original[offset : offset + chunk_size]
            for _ in range(2):
                part = client.put(
                    part_url, content=data, headers=token_header, auth=AUTH
                )
                assert part.json() == {"received": offset + len(data)}
            if offset == 0:
                with monkeypatch.context() as paused:
                    paused.setattr(app, "monotonic", lambda: monotonic() + 600)
                    resumed = client.put(
                        upload,
                        json={**options, "size": len(original)},
                        headers=token_header,
                        auth=AUTH,
                    )
                assert resumed.json()["received"] == chunk_size
        resume = client.put(
            upload,
            json={**options, "size": len(original)},
            headers=token_header,
            auth=AUTH,
        )
        assert resume.json()["received"] == len(original)
        for _ in range(2):
            reply = client.post(upload + "/finish", headers=token_header, auth=AUTH)
            assert reply.status_code == 202
        edit = "/saved-edits/" + reply.json()["id"]
        deadline = monotonic() + 3
        while monotonic() < deadline:
            if client.get(edit, auth=AUTH).json()["done"]:
                break
            sleep(0.03)
        assert client.get(edit + "/video", auth=AUTH).content == b"branded clip"
        file_info = client.head(edit + "/video", auth=AUTH)
        assert file_info.headers["content-length"] == "12"
        assert "attachment" in file_info.headers["content-disposition"]
        partial = client.get(edit + "/video", auth=AUTH, headers={"Range": "bytes=0-6"})
        assert partial.status_code == 206
        assert partial.content == b"branded"


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


def test_story_and_action_can_win_without_chat_or_laughter():
    from highlights import select_clips

    speech = [(8.4, 10.5, "I have to tell you what happened.")]
    speech += [
        (11.1 + n * 4.3, 14.9 + n * 4.3, "Then we talked about the clues.")
        for n in range(12)
    ]
    speech.append((62.8, 66.9, "That's what happened."))
    clips = select_clips(
        180, Counter(), Counter(), {}, speech=speech, action={95: 0.82}, motion={96: 39}
    )
    story = next(clip for clip in clips if "Story beat" in clip.reasons)
    assert story.end > 66.9
    assert any("Action sounds" in clip.reasons for clip in clips)
    assert len(clips) == 2
