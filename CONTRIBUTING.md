# Contributing

ClipMine is currently documentation-first and pre-MVP.

## Change workflow

1. Create a focused branch from the current default branch.
2. Link the work to a requirement, issue or documented decision.
3. Make the smallest coherent change.
4. Add tests and update affected documentation.
5. Run the relevant quality gates.
6. Open a pull request using the repository template.

## Commit guidance

Use short, intention-revealing commit messages, for example:

- `add resumable upload contract`
- `implement transcript job state machine`
- `document clip scoring calibration`

## Pull-request expectations

A pull request must describe its scope, reason, user impact, tests and remaining risks. Media-processing changes should include a small reproducible fixture or a documented test asset that the project has permission to use.

## Documentation changes

- Product behaviour belongs in `docs/product/`.
- UI rules belong in `docs/design/`.
- Architecture and contracts belong in `docs/technical/`.
- Privacy, security and rights rules belong in `docs/security/`.
- Durable decisions belong in `docs/decisions/`.

## Licence

No open-source licence has been selected. A public repository without a licence does not automatically grant reuse rights. Resolve licensing before accepting external code contributions.

