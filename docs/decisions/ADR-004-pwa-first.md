# ADR-004: Responsive Web/PWA Before Native Apps

- Status: Accepted
- Date: 2026-08-13

## Context

ClipMine must work on phones, but early risk lies in media processing and editorial quality rather than native-device capabilities. Building separate native clients would slow validation and complicate releases.

## Decision

Build a responsive web application/PWA first. Design and test core flows at phone widths. Add native applications or a wrapper only when user evidence identifies a capability the web product cannot provide well.

## Consequences

- One client reaches phone and desktop quickly
- Easier iteration during alpha
- Mobile browser upload/background limitations require careful recovery
- Native sharing, background transfer and store distribution are deferred

## Reversal trigger

Validated users require native-only capture, background upload, notification or editing capabilities strongly enough to justify the extra product surface.

