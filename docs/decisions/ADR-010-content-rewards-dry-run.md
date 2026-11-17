# ADR-010: Content Rewards campaign submission dry run

- Status: Implemented for a single-account dry run
- Date: 2026-11-17

## Context

Niches already retrieves Instagram's public Reel permalink and publish time.
A Content Rewards Creator submission currently uses its signed-in web form.
The account owner wants the Reel delivered to the original campaign within its
submission window.

## Decision

Extend the existing Niches scheduled Worker to dispatch a GitHub Actions dry
run for a configured test account once Instagram's publication link and time
are known. A database claim limits duplicate dispatch attempts, and the job
validates the destination and deadline again. The browser enters the link in
the intended campaign's form and stops before the campaign acknowledgement
and final submission action.

## Consequences

GitHub Actions needs an independently authenticated browser session. Its result
records whether the form was prepared. A repository event acceptance and a
prepared form both precede a real Content Rewards receipt; Niches retains the
existing manual submission status. See the
[publishing runbook](../operations/niches-publishing.md#content-rewards-browser-dry-run)
for configuration and test steps.
