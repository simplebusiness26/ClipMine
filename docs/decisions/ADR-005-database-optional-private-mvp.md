# ADR-005: Database-Optional Private MVP

- Status: Accepted
- Date: 2026-08-13

## Context

The first useful proof must run before external infrastructure is connected, while the handoff must allow PostgreSQL to be added without rewriting API/business logic. Video bytes do not belong in a relational database.

## Decision

Define a `ProjectStore` interface with atomic JSON and PostgreSQL implementations. Select PostgreSQL only when `DATABASE_URL` is configured; otherwise use JSON. Store the same validated project document in both modes. Keep source/export media on a private persistent volume.

PostgreSQL objects live in the private `clipmine` schema and are not exposed to Supabase browser/Data API roles.

## Consequences

- The app starts locally without an account, provider or database.
- Connecting PostgreSQL is a configuration-only step.
- JSON and PostgreSQL behaviour share one API model.
- Existing JSON projects do not automatically appear in PostgreSQL.
- A JSONB document limits relational queries and concurrency at scale.
- Database backup alone is insufficient because media remains on the volume.

## Reversal trigger

Before multi-tenant/public beta, normalise workspace, project, asset, job, transcript, candidate and edit data through forward migrations. Retain the store boundary until the new repository layer is proven.
