# Database Connection Checklist

ClipMine runs without a database, but tomorrow's persistence handoff is one environment variable. The API supports PostgreSQL directly, including Supabase Postgres.

## What the database stores

PostgreSQL stores project metadata, transcript segments, candidate edits, progress and export references as a versioned JSON document in `clipmine.projects`.

The database does **not** store video bytes. Source videos and exports remain on the private `CLIPMINE_DATA_DIR` volume.

## 1. Get a PostgreSQL URL

Use a database and role allowed to create the private `clipmine` schema on the first start. A standard project-owner connection is sufficient for the initial private MVP.

For Supabase, open the project dashboard and choose **Connect**:

- Use the direct connection for a persistent host with IPv6 support.
- Use the shared pooler's session mode on port 5432 for a persistent Docker host that is IPv4-only.
- Transaction mode on port 6543 is intended for temporary/serverless clients. ClipMine disables Asyncpg's statement cache for compatibility, but session/direct mode remains the clearer fit for this long-running API.

Official reference: [Supabase — Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres).

Use SSL. Preserve the connection string supplied by the provider; if it does not already specify SSL, require it according to the provider's instructions. For stronger certificate and hostname verification, follow [Supabase Postgres SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

## 2. Put the URL in `.env`

```bash
cp .env.example .env
```

Edit only the value locally:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

Do not paste the real URL into an issue, screenshot, log or commit. `.env` is excluded from Git.

If the password contains reserved URL characters such as `@`, `:`, `/`, `?` or `#`, use the provider-generated URL or percent-encode the password.

## 3. Restart ClipMine

Docker:

```bash
docker compose up --build --detach
docker compose logs --follow clipmine
```

Native development:

```bash
.venv/bin/uvicorn clipmine_api.main:app \
  --app-dir services/api \
  --host 0.0.0.0 \
  --port 8000 \
  --env-file .env
```

At startup, ClipMine runs the idempotent statements in `db/schema.sql`: create the private schema, revoke public schema access, create the table and create the updated-time index.

The `clipmine` schema is intentionally not a browser-facing Supabase Data API. The FastAPI server uses a secret direct PostgreSQL connection. Do not expose this database URL in React or any public client.

## 4. Verify the application connection

```bash
curl --fail http://localhost:8000/api/health
curl --fail http://localhost:8000/api/config
```

Expected fields:

```json
{
  "status": "ok",
  "persistence": "postgres",
  "ffmpeg": true,
  "transcription_provider": "faster-whisper"
}
```

The config response should include:

```json
{
  "persistence": "postgres",
  "database_connected": true
}
```

If startup fails, ClipMine does not silently fall back to JSON. Fix the connection and restart so there is no ambiguity about where data is being written.

## 5. Verify in PostgreSQL

Run these read-only checks through the provider's SQL editor or `psql`:

```sql
select schema_name
from information_schema.schemata
where schema_name = 'clipmine';

select table_schema, table_name
from information_schema.tables
where table_schema = 'clipmine'
order by table_name;

select count(*) as project_count
from clipmine.projects;
```

Upload a small authorised test video, wait for suggestions, refresh the page, and run the count again. The project should survive an application restart.

## Existing JSON projects

Setting `DATABASE_URL` starts with the database's current contents. ClipMine does not automatically import `data/state/projects.json`. Keep the existing data volume until any wanted projects have been recreated or a migration utility is added.

Clearing `DATABASE_URL` switches back to the JSON store; it does not delete PostgreSQL data.

## Troubleshooting

### Network or hostname failure

Supabase direct connections are IPv6 by default unless an IPv4 option is enabled. On an IPv4-only host, choose the shared pooler session URL from the Connect panel.

### Password authentication failed

Copy a fresh connection string, confirm the database password and check percent-encoding. Do not log the full URL while troubleshooting.

### Permission denied creating schema

Run `db/schema.sql` once with a migration/owner role, then use a runtime role that has `USAGE` on schema `clipmine` and `SELECT`, `INSERT`, `UPDATE`, `DELETE` on `clipmine.projects`. The private MVP initially assumes one owner-style connection to keep tomorrow's setup small.

### Too many connections

Each ClipMine API process opens a pool of one to five connections. Use the provider's session pooler, reduce replica count, or tune the pool in code before scaling horizontally.

### Supabase Data API cannot see the table

That is expected. ClipMine deliberately keeps this MVP table in a private schema and accesses it only from FastAPI. Do not grant `anon` or `authenticated` browser roles access merely to make it appear in the Data API.
