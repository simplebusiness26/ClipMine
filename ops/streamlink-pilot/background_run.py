"""Run a ClipCast recording and collect server-rendered Reels without a browser."""
import base64
import json
import os
from pathlib import Path
import re
import time
from urllib import parse, request

base = "http://127.0.0.1:10000"
password = os.environ["RECORDER_PASSWORD"]
channel = os.environ["TWITCH_CHANNEL"].strip().lstrip("@")
auth = "Basic " + base64.b64encode(("recorder:" + password).encode()).decode()
def fetch(path, data=None):
    req = request.Request(base + path, data=data, headers={"Authorization": auth})
    with request.urlopen(req, timeout=90) as res:
        return res.read(), res.geturl()
for _ in range(60):
    try:
        fetch("/healthz")
        break
    except Exception:
        time.sleep(5)
else:
    raise RuntimeError("Recorder did not start")
html = fetch("/")[0].decode()
token = re.search(r'name="token" value="([^"]+)"', html)
if not token:
    raise RuntimeError("Recorder form token not found")
data = parse.urlencode({"token": token.group(1), "confirm": "yes", "channels": channel, "quality": "720p", "reel_template": "roll-that-back"}).encode()
_, url = fetch("/record", data)
run_path = parse.urlsplit(url).path
print("Started recording run:", run_path, flush=True)
out = Path("clipcast-results")
out.mkdir(exist_ok=True)
deadline = time.monotonic() + 105 * 60
while time.monotonic() < deadline:
    manifest = json.loads(fetch(run_path + "/manifest")[0])
    print("Status:", manifest["channels"], "reels:", len(manifest["clips"]), flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    if manifest["complete"]:
        break
    time.sleep(30)
else:
    raise TimeoutError("Run did not finish within the allowed processing window")
saved = 0
for index, clip in enumerate(manifest["clips"], 1):
    edit = clip.get("edit") or {}
    if edit.get("phase") != "ready" or not edit.get("url"):
        continue
    video = fetch(edit["url"])[0]
    (out / f"channel-vi-reel-{index:02d}.mp4").write_bytes(video)
    saved += 1
print(f"Saved {saved} completed Reels", flush=True)
if not saved:
    raise RuntimeError("No finished Reels produced; inspect manifest and job logs")
