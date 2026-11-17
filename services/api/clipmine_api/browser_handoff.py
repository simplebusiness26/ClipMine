"""Transfer a reviewed ClipMine MP4 to the Niches browser, without credentials.

No network request or publishing action occurs in Python. A click opens Niches;
the browser transfers only this export after the receiving page signals ready.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

NICHES_ORIGIN = "https://niches.ai-seo.workers.dev"
MAX_BYTES = 25 * 1024 * 1024


def handoff_html(path: Path, title: str) -> str:
    if path.suffix.lower() != ".mp4" or not 12 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("Choose a ClipMine MP4 export up to 25 MiB.")
    media = path.read_bytes()
    if media[4:8] != b"ftyp":
        raise ValueError("The export is not an MP4 file.")
    payload = json.dumps({
        "name": path.name, "title": title[:120],
        "base64": base64.b64encode(media).decode("ascii"),
    }).replace("<", "\\u003c").replace(">", "\\u003e")
    origin = json.dumps(NICHES_ORIGIN)
    return """<button id="clipmine-send">Review export in Niches</button>
<p id="clipmine-transfer-status">Your sign-in stays in Niches. Choose the destination there.</p>
<script>
(() => {
  const payload = PAYLOAD, origin = ORIGIN;
  const button = document.getElementById('clipmine-send');
  const status = document.getElementById('clipmine-transfer-status');
  let destination = null, sent = false, timer;
  const listener = (event) => {
    if (event.origin !== origin || event.source !== destination) return;
    if (event.data?.type === 'niches-clipmine-ready-v1' && !sent) {
      const raw = atob(payload.base64), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      destination.postMessage({ type: 'clipmine-export-v1', name: payload.name,
        title: payload.title, bytes: bytes.buffer }, origin, [bytes.buffer]);
      sent = true;
    }
    if (event.data?.type === 'niches-clipmine-received-v1') {
      clearTimeout(timer); window.removeEventListener('message', listener);
      status.textContent = 'Export received. Review it and choose the Instagram handle in Niches.';
      button.disabled = true;
    }
  };
  button.onclick = () => {
    if (destination && !destination.closed) { destination.focus(); return; }
    sent = false;
    window.addEventListener('message', listener);
    destination = window.open(origin + '/?clipmine-import=1', '_blank');
    if (!destination) {
      status.textContent = 'Allow this button to open the Niches review tab.'; return;
    }
    status.textContent = 'Opening Niches. Keep this tab open; sign in on Niches if asked.';
    timer = setTimeout(() => {
      status.textContent = 'Transfer not confirmed. Keep both tabs open and check the Niches page.';
    }, 60000);
  };
})();
</script>""".replace("PAYLOAD", payload).replace("ORIGIN", origin)


def show_browser_handoff(path: Path, title: str) -> None:
    from IPython.display import HTML, display
    display(HTML(handoff_html(path, title)))
