# Contributing

ClipMine contains a working private MVP and a documented public-beta path.

## Set up

Follow [local development](docs/operations/local-development.md). Never use customer footage in development or commit real media. The API tests generate synthetic footage.

## Change workflow

1. Read `PROJECT_CONTEXT.md`, the PRD, technical specification and relevant ADRs.
2. Create a focused branch from the current default branch.
3. Inspect current implementation and tests before changing behaviour.
4. Make the smallest coherent change.
5. Add/update tests and affected documentation.
6. Run the relevant quality gates.
7. Open a pull request using the repository template.

## Quality gates

```bash
npm run lint:docs
npm run check:links
npm run lint:web
npm run test:web
npm run build:web
.venv/bin/ruff check services/api/clipmine_api services/api/tests
cd services/api && ../../.venv/bin/pytest -q
```

Media-processing changes need a reproducible synthetic or permissioned fixture and should verify output format, duration, dimensions and edit preservation.

## Commit guidance

Use short, intention-revealing messages, for example:

- `add postgres project store`
- `improve candidate overlap scoring`
- `verify vertical render dimensions`

## Documentation ownership

- Product behaviour: `docs/product/`
- UI/interaction rules: `docs/design/`
- Architecture/contracts: `docs/technical/`
- Local/deployment handoff: `docs/operations/`
- Privacy/security/rights: `docs/security/`
- Durable decisions: `docs/decisions/`

Update `PROJECT_CONTEXT.md` when current implementation, scope, database handoff or public-readiness status changes.

## Security and scope

- Do not introduce arbitrary YouTube downloading or scraping.
- Do not add unattended social publishing.
- Do not weaken rights confirmation or private-media handling.
- Do not claim the current app is multi-user/public-ready.
- Keep providers behind explicit boundaries and pin dependencies/lockfiles.

## Licence

No open-source licence has been selected. Public repository visibility does not automatically grant reuse rights. Resolve licensing before accepting external code contributions.
