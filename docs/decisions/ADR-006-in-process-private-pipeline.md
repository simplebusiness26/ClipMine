# ADR-006: In-Process Pipeline for the Private Proof

- Status: Accepted for private MVP only
- Date: 2026-08-13

## Context

The proof needs real background inspection, transcription and FFmpeg rendering, but a durable distributed queue would add infrastructure before candidate quality and workflow value are validated.

## Decision

Run bounded asynchronous tasks through a `PipelineManager` in the FastAPI process. Persist project stages, prevent duplicate active task keys, limit concurrency with a semaphore and resume pending analysis at startup.

## Consequences

- One Docker service demonstrates the full workflow.
- Page refreshes do not lose persisted progress.
- Restart recovery is simple and testable.
- Multiple API replicas, rolling deploys and strong exactly-once semantics are unsupported.
- A process crash may repeat a safe stage.
- Long-running production jobs lack leases, delayed retries and dead-letter handling.

## Reversal trigger

Before public multi-user deployment, persist explicit job records and move execution to a durable queue/worker service. Preserve the stage/media functions and API commands while replacing task ownership.
