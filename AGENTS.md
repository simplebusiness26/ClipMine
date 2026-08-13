# Agent Working Agreement

These instructions apply across the repository.

## Required reading

Before implementation, read:

1. `PROJECT_CONTEXT.md`
2. `docs/product/prd.md`
3. `docs/technical/technical-spec.md`
4. Any ADR related to the proposed change

## Working rules

- Inspect before editing. Do not claim a feature exists without locating and testing it.
- Work on one bounded milestone at a time.
- Keep secrets out of source control, fixtures, logs and screenshots.
- Do not introduce arbitrary YouTube downloading or scraping.
- Do not publish content without an explicit, recorded user action.
- Preserve source media and generated media privacy boundaries.
- Add or update tests with every behaviour change.
- Update documentation when an interface, data model or confirmed decision changes.
- Record meaningful architectural choices in `docs/decisions/`.
- Do not silently widen MVP scope.

## Completion report

Every implementation handoff must state:

- What changed
- What was tested and the exact result
- What remains incomplete
- Any migration, credential, platform review or manual action still required

