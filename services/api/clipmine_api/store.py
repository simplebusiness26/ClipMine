from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from .config import Settings
from .models import Project, utc_now


class ProjectStore(ABC):
    kind: str

    @abstractmethod
    async def initialise(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    async def list(self) -> list[Project]: ...

    @abstractmethod
    async def get(self, project_id: str) -> Project | None: ...

    @abstractmethod
    async def save(self, project: Project) -> Project: ...

    @abstractmethod
    async def delete(self, project_id: str) -> None: ...


class JsonProjectStore(ProjectStore):
    kind = "json"

    def __init__(self, data_dir: Path) -> None:
        self._state_dir = data_dir / "state"
        self._path = self._state_dir / "projects.json"
        self._lock = asyncio.Lock()

    async def initialise(self) -> None:
        self._state_dir.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            await asyncio.to_thread(self._atomic_write, {})

    async def close(self) -> None:
        return None

    def _read(self) -> dict[str, Any]:
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _atomic_write(self, payload: dict[str, Any]) -> None:
        temporary = self._path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temporary.replace(self._path)

    async def list(self) -> list[Project]:
        async with self._lock:
            raw = await asyncio.to_thread(self._read)
        projects = [Project.model_validate(item) for item in raw.values()]
        return sorted(projects, key=lambda item: item.created_at, reverse=True)

    async def get(self, project_id: str) -> Project | None:
        async with self._lock:
            raw = await asyncio.to_thread(self._read)
        item = raw.get(project_id)
        return Project.model_validate(item) if item else None

    async def save(self, project: Project) -> Project:
        project.updated_at = utc_now()
        async with self._lock:
            raw = await asyncio.to_thread(self._read)
            raw[project.id] = project.model_dump(mode="json")
            await asyncio.to_thread(self._atomic_write, raw)
        return project

    async def delete(self, project_id: str) -> None:
        async with self._lock:
            raw = await asyncio.to_thread(self._read)
            raw.pop(project_id, None)
            await asyncio.to_thread(self._atomic_write, raw)


class PostgresProjectStore(ProjectStore):
    kind = "postgres"

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._pool: Any = None

    async def initialise(self) -> None:
        import asyncpg

        self._pool = await asyncpg.create_pool(
            self._database_url,
            min_size=1,
            max_size=5,
            statement_cache_size=0,
        )
        async with self._pool.acquire() as connection:
            await connection.execute(
                """
                create schema if not exists clipmine;
                revoke all on schema clipmine from public;
                create table if not exists clipmine.projects (
                  id uuid primary key,
                  payload jsonb not null,
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now()
                );
                create index if not exists projects_updated_at_idx
                  on clipmine.projects (updated_at desc);
                """
            )

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    @staticmethod
    def decode_project(payload: Any) -> Project:
        if isinstance(payload, str):
            payload = json.loads(payload)
        return Project.model_validate(payload)

    async def list(self) -> list[Project]:
        rows = await self._pool.fetch(
            "select payload from clipmine.projects order by created_at desc"
        )
        return [self.decode_project(row["payload"]) for row in rows]

    async def get(self, project_id: str) -> Project | None:
        row = await self._pool.fetchrow(
            "select payload from clipmine.projects where id = $1::uuid", project_id
        )
        return self.decode_project(row["payload"]) if row else None

    async def save(self, project: Project) -> Project:
        project.updated_at = utc_now()
        payload = json.dumps(project.model_dump(mode="json"))
        await self._pool.execute(
            """
            insert into clipmine.projects (id, payload, created_at, updated_at)
            values ($1::uuid, $2::jsonb, $3, $4)
            on conflict (id) do update
              set payload = excluded.payload, updated_at = excluded.updated_at
            """,
            project.id,
            payload,
            project.created_at,
            project.updated_at,
        )
        return project

    async def delete(self, project_id: str) -> None:
        await self._pool.execute(
            "delete from clipmine.projects where id = $1::uuid", project_id
        )


def create_store(settings: Settings) -> ProjectStore:
    if settings.database_url:
        return PostgresProjectStore(settings.database_url)
    return JsonProjectStore(settings.data_dir)
