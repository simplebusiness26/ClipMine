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

## Niches infrastructure access

- Use AISO's existing operations route in `simplebusiness26/agentCart`, branch `ops/niches-cloudflare`, for Niches Cloudflare deployment and verification.
- `.github/workflows/niches-access-check.yml` is the read-only account/entitlement check; `.github/workflows/niches-portal-deploy.yml` is the separate immutable-source deployment launcher.
- The owner has reported Cloudflare browser sign-in does not work. Do not redirect them to Cloudflare browser login for tasks the authorised operations route can perform.
- Keep credentials inside the authorised runner, target only Niches resources, and preserve AISO's application and bridge. Do not retrieve secret values.
- A bridge credential does not bypass provider approval or account billing/entitlement. Diagnose those through the operations route and report exact evidence; do not activate paid products without owner approval.

## Completion report

Every implementation handoff must state:

- What changed
- What was tested and the exact result
- What remains incomplete
- Any migration, credential, platform review or manual action still required

