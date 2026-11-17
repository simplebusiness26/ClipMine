from pathlib import Path

import pytest

from clipmine_api.browser_handoff import handoff_html


def test_handoff_targets_only_niches_and_escapes_script_text(tmp_path: Path):
    path = tmp_path / "export.mp4"
    path.write_bytes(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 20)
    html = handoff_html(path, "</script><script>untrusted</script>")
    assert 'origin = "https://niches.ai-seo.workers.dev"' in html
    assert "event.source !== destination" in html
    assert "<script>untrusted" not in html
    assert "postMessage" in html
    assert "/api/auth" not in html and "password" not in html


def test_handoff_rejects_non_mp4_before_showing_transfer(tmp_path: Path):
    path = tmp_path / "fake.mp4"
    path.write_bytes(b"not a playable MP4 file")
    with pytest.raises(ValueError, match="not an MP4"):
        handoff_html(path, "Bad export")
