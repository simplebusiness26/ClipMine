"""Private, phone-friendly pages for recording progress and clip review."""

import html
import json
from pathlib import Path

from fastapi.responses import HTMLResponse

from clipcast_template.render import REEL_TEMPLATES

SCRIPT = Path(__file__).with_name("saved_clips.js")
TEMPLATE_OPTIONS = html.escape(
    json.dumps(list(REEL_TEMPLATES.items()), ensure_ascii=False), quote=True
)
STYLE = """
:root{color-scheme:dark;--ink:#fff2e9;--muted:#cbb8cc;--panel:#251a2e;--border:#543b55;--pink:#ff9dc4}
*{box-sizing:border-box}body{margin:0;background:#18101d;color:var(--ink);font:1rem/1.55 system-ui,sans-serif}
main{max-width:42rem;margin:auto;padding:1.1rem}h1,h2,h3{line-height:1.18;margin:.65em 0 .45em}
p{margin:.45em 0 .75em}section,article{margin:1rem 0;padding:1rem;background:var(--panel);border:1px solid var(--border);border-radius:.85rem}
article article{padding:0;border:0}nav{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem}
a,button{font:inherit;font-weight:650;cursor:pointer;color:#2b1425;background:#ffc6d7;min-height:44px;
display:inline-flex;align-items:center;text-decoration:none;border:0;border-radius:.55rem;padding:.55rem .8rem;margin:.2rem .2rem .2rem 0}
.secondary{background:#49324d;color:var(--ink)}button:disabled{opacity:.6;cursor:wait}
small,.muted{color:var(--muted)}label{display:block;margin-top:.65rem}summary{cursor:pointer;color:#ffd2e5}
input,textarea,select{display:block;width:100%;border:1px solid #947991;border-radius:.45rem;padding:.5rem;
background:#1b1320;color:var(--ink);font:inherit;margin:.25rem 0 .6rem}
video{display:block;width:100%;max-height:45vh;aspect-ratio:16/9;background:#0c090f;object-fit:contain;border-radius:.55rem;margin:.5rem 0}
video.reel{width:auto;max-width:100%;max-height:65vh;aspect-ratio:9/16}
progress{width:100%;height:.65rem;accent-color:var(--pink)}[hidden]{display:none!important}.error{color:#ffc5ad}
"""


def saved_page(view: str, token: str, batch: str = "") -> HTMLResponse:
    title = {
        "capture": "Recording run",
        "index": "Saved clips",
        "review": "Review run",
    }[view]
    message = (
        "You can close this page. To check back, choose Open recording run on the recorder."
        if view == "capture"
        else "Runs saved in this browser appear here."
        if view == "index"
        else ""
    )
    return HTMLResponse(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{title} · ClipCast</title><style>{STYLE}</style>"
        '<script src="/saved-clips.js?v=4" defer></script></head>'
        f'<body><main data-view="{view}" data-run="{html.escape(batch, quote=True)}" '
        f'data-token="{html.escape(token, quote=True)}" '
        f'data-templates="{TEMPLATE_OPTIONS}">'
        '<nav><a href="/" class="secondary">New recording</a>'
        '<a href="/saved" class="secondary">Saved clips</a></nav>'
        f"<h1>{title}</h1>{f'<p>{message}</p>' if message else ''}"
        '<p id="status" role="status" aria-live="polite"></p>'
        '<div id="content"></div></main></body></html>',
        headers={"Cache-Control": "private, no-store", "X-Frame-Options": "DENY"},
    )
