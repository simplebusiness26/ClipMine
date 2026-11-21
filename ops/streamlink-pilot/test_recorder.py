import json
import re
import subprocess
from collections import Counter
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from threading import Event, Thread
from time import monotonic, sleep
from urllib.parse import quote
from zipfile import ZipFile

from fastapi.testclient import TestClient

import app
from clipcast_template.hooks import HookSuggestion
from clipcast_template.render import TemplateResult
from highlights import SoundSignals

PASSWORD = "synthetic-test-password-only"
AUTH = ("recorder", PASSWORD)


def test_continuous_recording_overlaps_analysis_and_hands_off_distinct_highlights(monkeypatch):
    second_started = Event()
    finish_second = Event()
    sources = []
    render_attempts = []

    def capture(url, output, on_progress, *, quality, max_bytes):
        assert url.endswith("/clix")
        sources.append(output)
        if len(sources) > 1:
            second_started.set()
            assert finish_second.wait(8)
        output.write_bytes(b"capture")
        return app.Capture(600, 720)

    def speech(path, scratch, *, long_source=False):
        if long_source:
            if path == sources[0]:
                assert second_started.wait(5)
            return []
        return [[0.6, 2.4, "That was my getaway vehicle."]]

    def render(source, output, hook, narration, crop, cam, template, *, cached_cues):
        assert cached_cues == [[0.6, 2.4, "That was my getaway vehicle."]]
        render_attempts.append(template)
        if template == app.CUSTOM_GTA_CLIPCAST_TEMPLATE and render_attempts.count(template) == 1:
            raise ValueError("Simulated GTA render failure.")
        assert (template, hook) in {
            (app.CUSTOM_CHANNEL_VI_TEMPLATE, "SUSPECT LOSES GETAWAY VEHICLE"),
            (app.CUSTOM_GTA_CLIPCAST_TEMPLATE, "WORST GETAWAY IN LEONIDA"),
        }
        output.write_bytes(template.encode())
        return TemplateResult("Automatic English captions", HookSuggestion(hook))

    monkeypatch.setattr(app, "ChatMonitor", lambda _: type(
        "Chat", (), {
            "counts": Counter(), "laughter": Counter(), "connected": True,
            "start": lambda self: None, "close": lambda self: None,
            "progress": lambda self, seconds: None,
        }
    )())
    monkeypatch.setattr(app, "capture_mp4", capture)
    monkeypatch.setattr(app, "detect_sound", lambda *_: SoundSignals({}, {}))
    monkeypatch.setattr(app, "detect_motion", lambda *_: {})
    monkeypatch.setattr(app, "auto_captions", speech)
    monkeypatch.setattr(app, "render_template", render)
    def cut(source, output, clip):
        output.write_text(str(clip.end - clip.start))

    monkeypatch.setattr(app, "cut_clip", cut)
    monkeypatch.setattr(app, "probe_clip", lambda path: (float(path.read_text()), True))
    monkeypatch.setattr(app, "select_clips", lambda *a, **kw: [
        app.Clip(20, 35, ("Dialogue may continue past the cut",), 12),
        app.Clip(25, 50, ("Story beat",), 10),
        app.Clip(45, 60, ("Gameplay movement",), 9),
        app.Clip(70, 80, ("Action sounds",), 7),
        app.Clip(100, 114, ("Laughter in stream audio",), 6),
        app.Clip(140, 153, ("Chat spike",), 5),
        app.Clip(200, 215, ("Story beat",), 4),
    ])
    monkeypatch.setattr(app, "disk_usage", lambda _: type("Disk", (), {"free": 8 * 1024**3})())

    with TestClient(app.create_app("clix", PASSWORD)) as client:
        assert client.get("/continuous/queue").status_code == 401
        home = client.get("/", auth=AUTH).text
        token = re.search(r'name="token" value="([^"]+)"', home)[1]
        data = {"token": token, "channels": "@clix", "confirm": "yes"}
        brief = {
            "campaign_name": "Synthetic campaign",
            "campaign_brief": "Gameplay only. Use #SyntheticCampaign.",
            "min_seconds": "12",
            "max_seconds": "20",
        }

        def pending():
            return client.get("/continuous/queue", auth=AUTH).json()["highlights"]

        def wait_for(predicate):
            deadline = monotonic() + 6
            while monotonic() < deadline:
                result = predicate()
                if result:
                    return result
                sleep(0.02)
            raise AssertionError("Timed out waiting for background recorder")

        try:
            assert client.post(
                "/continuous/start", data={**data, **brief, "min_seconds": "22"}, auth=AUTH,
            ).status_code == 400
            assert client.post(
                "/continuous/start", data={**data, **brief}, auth=AUTH, follow_redirects=False
            ).status_code == 303
            assert client.post("/continuous/start", data=data, auth=AUTH).status_code == 409
            assert client.post(
                "/record", data={**data, "channels": "second"}, auth=AUTH,
            ).status_code == 409
            clips = wait_for(pending)
            assert [item["clip_seconds"] for item in clips] == [15, 14, 13]
            clip, sibling, other = clips
            assert len({entry["id"] for entry in clips}) == 3
            assert len({entry["bundle_url"] for entry in clips}) == 3
            assert clip["clip_seconds"] == 15
            assert clip["reasons"] == ["Gameplay movement"]
            assert clip["campaign"] == {
                "name": brief["campaign_name"], "brief": brief["campaign_brief"],
                "min_seconds": 12, "max_seconds": 20,
                "required_category": "", "preserve_source_frame": False,
                "require_custom_hook": False,
            }
            assert clip["transcript"] == [[0.6, 2.4, "That was my getaway vehicle."]]
            assert not clip["reels"]["channel-vi"]["download_url"]
            assert client.get(clip["bundle_url"]).status_code == 401
            assert client.get(clip["bundle_url"], auth=AUTH).status_code == 409
            assert client.post(
                clip["delivery_url"], data={"token": token, "revision": clip["revision"]},
                auth=AUTH,
            ).status_code == 409
            assert client.post(
                sibling["skip_url"],
                data={"token": token, "revision": clip["revision"], "reason": "Wrong case"},
                auth=AUTH,
            ).status_code == 409
            assert client.post(
                sibling["skip_url"],
                data={"token": token, "revision": sibling["revision"], "reason": "Lacks gameplay."},
                auth=AUTH,
            ).status_code == 204
            assert [item["id"] for item in pending()] == [clip["id"], other["id"]]
            options = {
                "channel_vi_hook": "SUSPECT LOSES GETAWAY VEHICLE",
                "gta_clipcast_hook": "WORST GETAWAY IN LEONIDA",
                "request_id": "a" * 32,
            }
            def submit_pair():
                return client.post(
                    clip["reels_url"], headers={"X-ClipCast-Token": token},
                    auth=AUTH, json=options,
                )

            assert submit_pair().status_code == 202
            assert submit_pair().status_code == 202
            assert client.post(
                "/continuous/stop", data={"token": token}, auth=AUTH, follow_redirects=False
            ).status_code == 303
            def pair_in_phase(phase):
                item = pending()[0]
                return item if item["reels"]["gta-clipcast"]["phase"] == phase else None

            failed = wait_for(lambda: pair_in_phase("failed"))
            assert client.post(
                failed["delivery_url"],
                data={"token": token, "revision": failed["revision"]}, auth=AUTH,
            ).status_code == 409
            options["request_id"] = "b" * 32
            assert submit_pair().status_code == 202
            edit = wait_for(lambda: pair_in_phase("ready"))
            reels = edit["reels"]
            for brand, template in app.BRAND_REEL_TEMPLATES.items():
                url = reels[brand]["download_url"]
                assert client.get(url).status_code == 401
                download = client.get(url, auth=AUTH)
                assert download.content == template.encode()
                assert f"-{brand}.mp4" in download.headers["content-disposition"]
            assert render_attempts.count(app.CUSTOM_CHANNEL_VI_TEMPLATE) == 1
            assert render_attempts.count(app.CUSTOM_GTA_CLIPCAST_TEMPLATE) == 2
            bundle = client.get(edit["bundle_url"], auth=AUTH)
            assert bundle.headers["content-type"] == "application/zip"
            assert bundle.headers["content-disposition"].endswith('-both-reels.zip"')
            with ZipFile(BytesIO(bundle.content)) as files:
                assert {
                    name.rsplit(edit["id"] + "-", 1)[-1]: files.read(name)
                    for name in files.namelist()
                } == {
                    f"{brand}.mp4": template.encode()
                    for brand, template in app.BRAND_REEL_TEMPLATES.items()
                }
            assert client.post(
                edit["delivery_url"], data={"token": token, "revision": edit["revision"]},
                auth=AUTH,
            ).status_code == 204
            assert [item["id"] for item in pending()] == [other["id"]]
            assert client.post(
                other["skip_url"],
                data={"token": token, "revision": other["revision"], "reason": "Weak hook."},
                auth=AUTH,
            ).status_code == 204
            manifest = client.get(clip["run_url"] + "/manifest", auth=AUTH).json()
            reasons = {item["id"]: item["skip_reason"] for item in manifest["clips"]}
            assert reasons == {clip["id"]: "", sibling["id"]: "Lacks gameplay.", other["id"]: "Weak hook."}
            assert pending() == []
        finally:
            finish_second.set()
        next_clips = wait_for(pending)
        assert len(sources) == 2
        assert len(next_clips) == 3
        assert all(item["campaign"] == clip["campaign"] for item in next_clips)


def test_campaign_configuration_locks_one_worker_to_its_stream_and_brief(monkeypatch):
    monkeypatch.setenv("TWITCH_CHANNEL", "clix")
    monkeypatch.setenv("RECORDER_PASSWORD", PASSWORD)
    profile = {"name": "First Campaign", "brief": "Keep the dialogue.", "min_seconds": 30}
    monkeypatch.setenv("CLIPCAST_CAMPAIGN", json.dumps(profile))
    first = app.create_render_app()
    monkeypatch.setenv("TWITCH_CHANNEL", "second")
    monkeypatch.setenv("CLIPCAST_CAMPAIGN", json.dumps({"name": "Second", "brief": "Show the payoff."}))
    second = app.create_render_app()

    with TestClient(first) as client, TestClient(second) as other:
        health = client.get("/healthz").json()
        assert health["capture_slots"] == 1
        assert health["campaign_lock"] == "enabled"
        home = client.get("/", auth=AUTH).text
        assert "Locked campaign" in home and "Keep the dialogue." in home
        assert "Record and find clips" not in home
        token = re.search(r'name="token" value="([^"]+)"', home)[1]
        data = {"token": token, "confirm": "yes"}
        assert client.post("/record", data=data, auth=AUTH).status_code == 409
        assert client.post(
            "/continuous/start", data={**data, "channels": "second"}, auth=AUTH
        ).status_code == 409
        assert client.post(
            "/continuous/start",
            data={**data, "campaign_name": profile["name"], "campaign_brief": "Changed"},
            auth=AUTH,
        ).status_code == 409
        locked = client.get("/continuous/queue", auth=AUTH).json()["locked_campaign"]
        assert locked == {
            "channel": "clix", "max_seconds": None, "required_category": "",
            "preserve_source_frame": False, "require_custom_hook": False, **profile,
        }
        other_lock = other.get("/continuous/queue", auth=AUTH).json()["locked_campaign"]
        assert (other_lock["channel"], other_lock["name"]) == ("second", "Second")


def test_campaign_rejects_wrong_twitch_category_before_capture(monkeypatch):
    assert_capture_check = Event()

    def check_category(url, required):
        assert url == "https://www.twitch.tv/example"
        assert required == "Grand Theft Auto VI"
        assert_capture_check.set()
        raise app.CampaignCategoryError("Waiting for a verified Grand Theft Auto VI livestream.")

    monkeypatch.setattr(app, "verify_twitch_category", check_category)
    monkeypatch.setattr(app, "disk_usage", lambda _: type("Disk", (), {"free": 8 * 1024**3})())
    campaign = app.CampaignBrief(
        "Campaign", "GTA VI only", None, None, required_category="Grand Theft Auto VI",
    )
    with TestClient(app.create_app("example", PASSWORD, locked_campaign=campaign)) as client:
        home = client.get("/", auth=AUTH).text
        token = re.search(r'name="token" value="([^"]+)"', home)[1]
        assert client.post(
            "/continuous/start", data={"token": token, "confirm": "yes"},
            follow_redirects=False, auth=AUTH,
        ).status_code == 303
        assert assert_capture_check.wait(2)
        deadline = monotonic() + 3
        while monotonic() < deadline:
            queue = client.get("/continuous/queue", auth=AUTH).json()
            if queue["status"].startswith("Waiting for a verified"):
                break
            sleep(0.02)
        assert queue["status"] == "Waiting for a verified Grand Theft Auto VI livestream."
        assert queue["highlights"] == []


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
