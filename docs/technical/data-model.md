# Data Model

## Implemented private-MVP model

The API uses one Pydantic `Project` document as its persistence boundary. JSON and PostgreSQL store the same shape, which lets tomorrow's database connection happen without a code migration.

### Project

| Group | Fields |
|---|---|
| Identity | `id`, `title`, `created_at`, `updated_at` |
| Source | `source_filename`, `source_url`, `duration_seconds`, `width`, `height` |
| Requested settings | `desired_clips`, `min_clip_seconds`, `max_clip_seconds`, `language` |
| Rights | `rights_confirmed` |
| Progress | `status`, `stage`, `progress`, `analysis_mode` |
| Results | `transcript_segments`, `candidates` |
| Failure | `error_code`, `error_message` |

### Transcript segment

| Field | Constraint |
|---|---|
| `start_seconds` | At least zero |
| `end_seconds` | Greater than start |
| `text` | Recognised text |
| `confidence` | Optional zero-to-one value |

### Clip candidate

| Field | Meaning |
|---|---|
| `id` | UUID string |
| `start_seconds`, `end_seconds` | Source-time range |
| `title` | Suggested or user-edited title |
| `score` | Zero-to-100 editorial heuristic |
| `confidence` | High, medium or experimental |
| `reasons` | Grounded selection reasons |
| `caption_text` | Editable burn-in text |
| `render_status` | Idle, queued, rendering, ready or failed |
| `export_url` | Project-bound download route when ready |
| `render_error` | Safe user-facing failure |

## PostgreSQL physical model

```sql
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
```

The table is private to the backend connection. It is not designed for Supabase Data API/client access, so no `anon` or `authenticated` grants are added. The FastAPI server owns validation and access for this single-operator build.

The index matches the implemented newest-first project list. Project payloads are upserted by ID.

## Filesystem model

```text
data/
  state/
    projects.json
  projects/
    <project-id>/
      source/
        source.<safe-extension>
      exports/
        <candidate-id>.mp4
```

Only `projects.json` is used in JSON mode. Project source/export directories are used in both persistence modes.

## Integrity rules

- Project and candidate IDs are generated server-side.
- Candidate time ranges must be positive and remain inside the source duration.
- Requested maximum clip length must exceed minimum length.
- The rights flag must be true before any source is persisted as a project.
- Render paths derive from server-owned IDs, not user filenames.
- Deleting a project removes both the persisted document and project directory.
- Updating candidate edit instructions invalidates its previous render state/reference.

## State transitions

Project happy path:

`uploading → uploaded → processing → ready`

Failure/retry:

`uploaded|processing → failed → uploaded`

Candidate render path:

`idle → queued → rendering → ready`

Render failure returns to `failed`; editing returns it to `idle`.

## Public-beta normalisation path

One JSONB document keeps the private proof simple; it is not the final tenant model. Before concurrent multi-user operation, migrate to separate tenant-scoped tables for users/workspaces, projects, assets, jobs, transcripts/segments, candidates, clip versions, caption cues, usage, audit and deletion requests.

The migration must preserve source-time ranges and user edits, add workspace keys/indexes, and use expand/migrate/contract steps. Existing JSONB payloads are suitable migration input but should not remain the only query boundary once list/filter/concurrent-worker access grows.
