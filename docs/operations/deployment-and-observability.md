# Deployment and Observability

## Environments

Use separate development, staging and production resources for:

- Database
- Object storage
- Queue/cache
- Authentication/OAuth applications
- AI provider credentials
- Social platform applications
- Logging and alerting

Never process real customer media in development.

## Deployment units

1. Web application
2. Control API
3. Media/AI worker image
4. Scheduled maintenance/reconciliation tasks
5. Database migrations

Workers and API may deploy independently but must honour versioned contracts and compatible schema transitions.

## CI/CD baseline

Pull request:

- Format/lint/type checks
- Unit and integration tests
- Migration validation
- Selected media golden tests
- Dependency/secret scanning
- Build deployable images/artifacts

Merge/default branch:

- Build immutable versioned images
- Deploy to staging
- Run smoke and migration tests
- Require explicit production promotion initially
- Deploy database expansion before dependent code
- Run production smoke checks and watch error/job metrics

## Infrastructure principles

- Infrastructure as code before public beta
- Private networking where practical
- Least-privilege service identities
- Object-store public access blocked centrally
- Encryption in transit and at rest
- Autoscaling based on safe queue/concurrency signals
- Hard resource limits for media containers

## Observability model

Every request/job carries a correlation/trace ID. Logs are structured and contain IDs, states, durations, versions and safe error codes—but not transcript text, credentials or signed URLs.

### Metrics

Product/system:

- Projects created, uploaded, ready, exported and deleted
- Job count by stage/state/error
- Queue age and depth
- Worker lease expiry and retry rate
- Processing latency per source minute
- Candidate count and no-candidate rate
- Render success and duration
- Object storage bytes and egress
- Provider usage/cost by stage
- API latency/error rate
- Authorisation denials and rate-limit events

### Alerts

- Oldest queued job exceeds threshold
- Stage failure/retry rate spikes
- Worker heartbeats absent
- API elevated errors or latency
- Upload completion failures spike
- Provider cost or usage anomaly
- Deletion reconciliation backlog
- Authentication/OAuth failure spike
- Storage nearing limit or lifecycle failure

Thresholds begin conservative and are calibrated from staging/alpha data.

## Runbooks

Create executable runbooks before beta for:

- Stuck queue/job
- Provider outage or rate limit
- Broken render deployment
- Database/storage degradation
- Suspected cross-tenant or media exposure
- Credential compromise
- Failed deletion/reconciliation
- Social publishing duplication/uncertain status
- Cost spike

Each runbook includes detection, containment, user impact, recovery, verification and follow-up owner.

## Backups and recovery

- Automated PostgreSQL backups with restore tests
- Point-in-time recovery where supported
- Object versioning/retention balanced against verified user deletion obligations
- Infrastructure/configuration reproducible from code
- Recovery objectives set after business impact assessment

Derived assets can usually be regenerated; source media, user edits and project history need the strongest recovery protection while retained.

## Media lifecycle maintenance

Scheduled tasks reconcile:

- Expired multipart uploads
- Orphaned objects/records
- Stale job leases
- Expired signed/export access
- Retention-expired proxies/exports
- Pending deletion requests
- Provider-side temporary files

Maintenance is idempotent and reports discrepancies before destructive cleanup where practical.

## Release and rollback

- Use immutable artifacts and recorded configuration version.
- Roll back application code without reversing completed destructive migrations.
- Feature-flag expensive/new provider paths.
- Retain the previous media worker image and pipeline config for rapid rollback.
- Stop enqueueing a bad stage before draining/retrying affected jobs.

