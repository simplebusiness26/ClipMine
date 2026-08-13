# ADR-002: Export First and Human Approval

- Status: Accepted
- Date: 2026-08-13

## Context

Direct publishing requires platform OAuth, eligibility, app review, changing media constraints and careful retry/reconciliation. AI-selected clips may also be misleading, poorly framed or contextually unsuitable.

## Decision

The MVP renders downloadable files and requires the user to review them. Direct platform publishing is added later through official APIs and always remains a distinct, explicit user-confirmed action.

## Consequences

- Core value can launch without platform approvals
- Creators retain editorial control
- Early product has slightly more manual distribution friction
- Publishing can be built and monitored one platform at a time

## Reversal trigger

Human approval is a safety/product invariant and is not expected to reverse. Export-first may expand once official integrations are approved and reliable.

