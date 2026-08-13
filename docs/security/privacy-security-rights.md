# Privacy, Security and Content Rights

Status: product and engineering baseline; not a substitute for jurisdiction-specific legal advice

## 1. Trust promise

Users may upload unpublished footage, client work and identifiable people. ClipMine must treat every source, transcript and generated clip as private workspace data unless the user explicitly publishes or shares it.

## 2. Rights model

### Allowed input

The user must own the media or have sufficient permission to process, edit and republish it. Ownership of a YouTube channel does not automatically prove rights to every song, guest contribution, stock asset or clip inside a video.

### YouTube input

The MVP accepts the user's original file. It must not download arbitrary YouTube URLs. YouTube's current terms restrict downloading or automated access unless authorised by the service, YouTube/rightsholders, or applicable law. A public URL is therefore metadata or a publishing reference, not permission to fetch the media.

References:

- [YouTube Terms of Service](https://www.youtube.com/static?gl=GB&template=terms)
- [YouTube API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service)

### Attestation

Before upload completion, record:

- User/workspace ID
- Project ID
- Attestation text/version
- Timestamp and region if needed for policy

The UI must not imply that checking a box transfers legal responsibility away from ClipMine. It is one control within a wider complaints and enforcement process.

### Complaints and takedown

Before public beta, provide:

- A published rights-complaint channel
- Required claim information and identity verification appropriate to the process
- Prompt disabling/preservation workflow where necessary
- User notice and fair dispute route
- Repeat-abuse policy
- Audited administrator actions

Obtain legal review for the launch jurisdictions and business model.

## 3. Privacy principles

- Collect the minimum data needed to provide the workflow.
- Keep source and derived media private by default.
- Explain each provider that receives media, audio or transcript data.
- Do not use customer media to train shared models by default.
- Prefer provider settings/contracts that disable training and minimise retention.
- Give users visible project/account deletion controls.
- Separate product analytics from media/transcript content.
- Do not log transcript bodies or long-lived media URLs.

## 4. Data classification

| Class | Examples | Baseline handling |
|---|---|---|
| Restricted media | Source video, audio, exports | Private storage, encrypted, signed access, strict retention |
| Restricted text | Transcripts, captions, AI prompts containing speech | Encrypted, tenant-scoped, excluded from logs |
| Credentials | OAuth tokens, signing secrets, provider keys | Secret manager/encrypted token store, least privilege |
| Personal data | Account details, speakers/faces, support records | Purpose-limited access and deletion/export process |
| Operational metadata | Job state, durations, error codes, usage | Minimised and pseudonymous where possible |
| Public content | Only content the user explicitly publishes | Platform and user-selected visibility rules |

## 5. Retention baseline

The final periods require product/legal approval, but the implementation must support separate policies for:

- Incomplete uploads
- Source media
- Analysis proxies/audio extracts
- Candidate previews
- Final exports
- Transcripts/features
- Logs, audits and billing/usage records
- Provider-side files

Deletion begins by making the project inaccessible, then removes every derived object and text record asynchronously. Backups age out under a documented schedule and are not restored into active service after a valid deletion without controls.

## 6. Security controls

### Identity and tenant isolation

- Server verifies every access token.
- All tenant data is scoped by workspace.
- Authorisation tests attempt cross-user and guessed-ID access.
- Administrative access is least privilege, time-bounded where possible and audited.

### Media storage

- Block public access at bucket/account level.
- Use random/opaque object keys generated server-side.
- Signed URLs expire quickly and are limited to the required operation.
- Validate file type from content, not extension.
- Scan uploads and sandbox media processing.
- Enforce size, duration, codec and decompression/resource limits.

### Worker isolation

- Run FFmpeg and media parsers with limited permissions, CPU/memory/time and no unnecessary network access.
- Keep base images patched and pin dependencies.
- Treat source metadata, filenames and transcripts as untrusted input.
- Never convert transcript text into executable commands or trusted prompts.

### Credentials

- Store secrets outside source control.
- Encrypt social refresh tokens and separate them from normal application data.
- Rotate credentials and revoke on disconnect/security events.
- Use distinct identities for API, workers and deployment.

### Application security

- CSRF protection for cookie-authenticated commands.
- Restrictive CORS and security headers.
- Rate limiting and abuse quotas.
- Parameterised database access.
- Output encoding and sanitisation for titles/transcripts.
- Idempotency and replay protection on render/publish commands.

## 7. Threat scenarios

| Threat | Primary controls |
|---|---|
| User accesses another workspace's project | Server-side tenant scope, opaque IDs, authorisation tests |
| Signed media URL leaks | Short expiry, purpose limitation, redacted logs, revocation path |
| Malicious media exploits parser | Sandbox, resource limits, patched FFmpeg, validation |
| Transcript contains prompt injection | Treat as data, fixed system policy, schema validation, no tool authority |
| Stolen social token publishes content | Encrypted tokens, minimal scopes, explicit confirmation, revocation, audit |
| Cost exhaustion through repeated jobs | Allowance reservation, concurrency caps, idempotency, rate limits |
| Deleted media remains in derivatives | Asset lineage, deletion state machine, reconciliation audit |
| Support staff overreach | Exceptional access flow, reason, role, audit and alerts |

## 8. AI/provider data governance

Maintain a provider register containing:

- Data categories sent
- Processing region where known
- Retention/training settings
- Subprocessors and agreement status
- Model/version
- Deletion mechanism
- Fallback provider implications

Provider changes that alter data use require privacy review and user-facing policy updates before rollout.

## 9. Publishing controls

- Use official OAuth, never request social passwords.
- Ask for minimum scopes.
- Show exact destination, account, clip and visibility before confirmation.
- Validate platform constraints before upload.
- Default test/sandbox submissions to the least public visibility available.
- Store publication status and external ID without treating a timeout as proof of failure; reconcile before retry.

## 10. Compliance preparation

Before launch, identify the controller/processor roles, lawful basis, user age policy, international transfers, accessibility obligations and consumer/subscription rules for launch markets. Complete a data map, retention schedule, incident plan, processor agreements and appropriate privacy impact review with qualified advice.

## 11. Security launch gate

- Threat model reviewed
- Cross-tenant tests pass
- Secret and dependency scans pass
- Deletion verified across database, object storage and providers
- Backup restore tested
- Incident contacts and severity process active
- Rights complaint route active
- Privacy notice and terms match actual data flow

