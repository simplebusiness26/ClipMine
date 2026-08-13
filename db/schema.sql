-- ClipMine MVP PostgreSQL persistence.
-- The API creates this private schema and table automatically when
-- DATABASE_URL is configured. This file is provided for inspection.

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
