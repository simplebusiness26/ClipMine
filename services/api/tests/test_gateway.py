from fastapi.testclient import TestClient

from clipmine_api.main import app


def test_renderer_gateway_rejects_missing_and_wrong_key(monkeypatch, tmp_path):
    monkeypatch.setenv("CLIPMINE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CLIPMINE_TRANSCRIPTION_PROVIDER", "off")
    monkeypatch.setenv("NICHES_GATEWAY_KEY", "a-dedicated-test-render-key")
    with TestClient(app) as client:
        assert client.get("/api/projects").status_code == 401
        assert client.get("/docs").status_code == 401
        assert (
            client.get("/api/projects", headers={"X-Niches-Gateway-Key": "wrong"}).status_code
            == 401
        )
        response = client.get(
            "/api/projects", headers={"X-Niches-Gateway-Key": "a-dedicated-test-render-key"}
        )
        assert response.status_code == 200
        assert response.json() == []
