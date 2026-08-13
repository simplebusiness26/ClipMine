from pathlib import Path

import pytest

from clipmine_api.config import Settings
from clipmine_api.models import Project
from clipmine_api.store import JsonProjectStore, PostgresProjectStore, create_store


def sample_project(project_id: str = "24f140c5-2452-437e-b625-b9f9e2fcff82") -> Project:
    return Project(
        id=project_id,
        title="Example",
        source_filename="source.mp4",
        source_url=f"/api/projects/{project_id}/source",
        status="uploaded",
        min_clip_seconds=5,
        max_clip_seconds=10,
        rights_confirmed=True,
    )


@pytest.mark.asyncio
async def test_json_store_round_trip_and_delete(tmp_path: Path) -> None:
    store = JsonProjectStore(tmp_path)
    await store.initialise()
    project = sample_project()

    await store.save(project)

    restored = await store.get(project.id)
    assert restored is not None
    assert restored.title == "Example"
    assert [item.id for item in await store.list()] == [project.id]

    await store.delete(project.id)
    assert await store.get(project.id) is None


def test_database_url_selects_postgres_adapter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://clipmine:secret@db.example/clipmine")
    monkeypatch.setenv("CLIPMINE_DATA_DIR", str(tmp_path))

    store = create_store(Settings.from_env())

    assert isinstance(store, PostgresProjectStore)


def test_postgres_adapter_decodes_asyncpg_json_text() -> None:
    project = sample_project()

    restored = PostgresProjectStore.decode_project(project.model_dump_json())

    assert restored.id == project.id
    assert restored.title == project.title
