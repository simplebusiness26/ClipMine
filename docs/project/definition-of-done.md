# Definition of Done

A task is done only when the behaviour is implemented, tested, documented and safely operable.

## Every change

- Acceptance criteria are met.
- Relevant formatting, lint, type and tests pass.
- New failure states have safe user messages and technical observability.
- No secrets or private media are committed/logged.
- Documentation/contracts reflect changed behaviour.
- Rollback or disable path is understood.
- Pull request identifies remaining limitations.

## API/data changes

- Authentication and workspace authorisation tested.
- Request/response schemas and stable errors documented.
- Idempotency considered for commands.
- Migration has forward path and is tested on representative data.
- Index/query impact reviewed.

## Media/AI changes

- Pipeline/provider/config version recorded.
- Permissioned golden/evaluation fixtures pass.
- Output format, duration and A/V sync verified.
- Quality compared with the current baseline.
- Cost and latency measured.
- Low-confidence/failure behaviour tested.
- No source meaning is fabricated or silently altered.

## UI changes

- Loading, empty, success and error states exist.
- Keyboard and phone-width behaviour tested.
- Keyboard navigation, focus and labels checked.
- Destructive actions require clear confirmation and report completion state.

## Security/privacy changes

- Data flow and retention effects reviewed.
- Tenant isolation and least privilege preserved.
- Logs redact private content and credentials.
- Deletion includes new derivatives/provider data.
- Audit event added for elevated/security-sensitive actions.

## Release complete

- Staging smoke passes.
- Migration/deployment results recorded.
- Monitoring shows healthy API, queue and worker state.
- Known issues and support impact documented.
- Production smoke verifies create/upload/process/render/download/delete as applicable.

