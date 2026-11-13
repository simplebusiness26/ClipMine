# Niches publishing rollout

## Verified storage beta and email adapter — 2026-10-27

R2 is still blocked by the Cloudflare account entitlement (10042). The approved AISO operations launcher provisioned an isolated free Workers KV namespace (`niches-media-kv`) bound as `MEDIA_KV` without activating paid products. Runtime prefers R2 if a legitimate bucket is subsequently enabled. Live private upload, full download, video-style byte range, anonymous denial, registration, six planning accounts and a five-destination draft passed in [deployment run 40452645608](https://github.com/simplebusiness26/agentCart/actions/runs/40452645608). Beta limits: maximum 25 MiB/file, 250 MiB/user, 100 files/user and a conservative 500 MiB application total; KV is eventually consistent and the global aggregate quota is not atomic. Do not market this as scalable permanent video storage. Establish recoverable media backups before inviting public users.

The Worker also supports an optional direct Brevo reset sender (300 free emails/day according to Brevo's published plan) in addition to the existing HTTPS adapter. It requires separate `NICHES_BREVO_API_KEY` in the AISO operations secret configuration and a verified `NICHES_BREVO_SENDER_EMAIL` repository variable for the Niches Worker only; no real delivery has been validated. Keep these out of source code and never reuse unrelated AISO application credentials.


## Master-only niches

Create a niche with an optional master brand and source groups. Connect each
platform account in that niche, then assign it to the master brand or a source
group. Open a source group’s composer to label the draft with that group.
Publish now and Schedule use only selected master destinations. A source
account is for organisation and cannot receive a publication from that niche.
Master-only niches do not send Instagram Collab invitations.

Migration 0003 adds default-empty routing fields. Existing niches retain the
ordinary destination flow. Queued destinations remain pinned to the approved
account and accounts with work in progress cannot be moved between groups.

## Instagram Reel collaboration

In the final publishing review, select one Meta-connected Instagram account as
the publisher and enter one optional collaborator username. The same settings
apply to Publish now and Schedule. The worker adds the invite to the Reel
container request. The invited account accepts in Instagram. Direct Instagram
Login and image posts do not use this option. The existing approval and
publication records carry the option without a database migration. A live
provider test is required to verify the invite with the connected account.

## Implemented and tested locally

Each niche supports multiple accounts per platform, including planning accounts that remain explicitly unconnected. The composer proposes the niche's accounts, allows deselection, and saves master, platform and individual-account captions. Uploaded media supports batch drafting and upload progress. File selection and temporary previews also work when cloud storage is unavailable; previews are not cloud uploads and disappear when the page closes.

Official OAuth implementations cover Google/YouTube, TikTok and Meta Facebook Login for Pages and eligible Instagram professional accounts. One-time OAuth state is tied to the initiating browser and live session. Tokens and pending authorisation choices are encrypted using a separate Niches AES-GCM key with account-bound associated data. No social passwords are collected.

Direct publishing has an explicit review/approval boundary, per-account records, scheduled execution, leases, encrypted resumable state, duplicate approval protection and bounded retries. Ambiguous writes require checking the platform before retrying. Only provider-confirmed completion becomes published. Adapters cover YouTube resumable video, Instagram image/Reels containers, Facebook photos/Reels and TikTok direct video. The minute cron runs bounded stages; no paid queue is provisioned. Large videos remain limited to the configured 25 MB upload cap.

For a future direct publication, open its date in Calendar and select **Publish now**. Confirming moves the existing deliveries forward for all approved accounts. Niches preserves the delivery IDs and uses the same provider confirmation and retry process. If any delivery has started, use its account status instead.

The automated provider tests use simulated provider responses. No platform has passed an actual owner-authorised production publishing test. Custom YouTube thumbnail uploading, provider analytics/revenue imports, TikTok photo posts and long-running video throughput remain roadmap work.

## Live prerequisites

The read-only account check on 2026-10-27 returned R2 error `10042`, “Please enable R2 through the Cloudflare Dashboard.” This establishes service availability as the upload blocker. No paid product was activated. The current production configuration intentionally omits the R2 binding. An owner must approve any required billing and enable R2; afterwards deploy a distinct private `niches-media` bucket binding and verify a real upload. Do not reuse AISO storage.

Provider developer applications are external prerequisites. Configure the following project-specific secrets in the authorised `agentCart` operations repository (or move to the isolated ClipMine deployment environment). They are imported into the **niches Worker only** by `configure-secrets.mjs`:

| GitHub secret | Worker secret |
| --- | --- |
| `NICHES_YOUTUBE_CLIENT_ID` | `YOUTUBE_CLIENT_ID` |
| `NICHES_YOUTUBE_CLIENT_SECRET` | `YOUTUBE_CLIENT_SECRET` |
| `NICHES_TIKTOK_CLIENT_KEY` | `TIKTOK_CLIENT_KEY` |
| `NICHES_TIKTOK_CLIENT_SECRET` | `TIKTOK_CLIENT_SECRET` |
| `NICHES_META_APP_ID` | `META_APP_ID` |
| `NICHES_META_APP_SECRET` | `META_APP_SECRET` |
| `NICHES_INSTAGRAM_APP_ID` | `INSTAGRAM_APP_ID` |
| `NICHES_INSTAGRAM_APP_SECRET` | `INSTAGRAM_APP_SECRET` |

The runner creates `NICHES_TOKEN_KEY` once directly on Niches. It only reads secret names/types, never existing values; deployments never replace the encryption key. Back up or rotate this key only using an authorised secure procedure. Losing it requires social account reconnection.

Register these exact redirect URIs with their developer applications:

- `https://niches.ai-seo.workers.dev/api/oauth/youtube/callback`
- `https://niches.ai-seo.workers.dev/api/oauth/tiktok/callback`
- `https://niches.ai-seo.workers.dev/api/oauth/facebook/callback`
- `https://niches.ai-seo.workers.dev/api/oauth/instagram/callback`

Google needs YouTube Data API and appropriate OAuth verification; For Instagram direct Login, use the Instagram app ID and secret shown under Meta’s **Instagram API with Instagram Login** setup (not the Facebook app credentials); register the Instagram callback in Instagram Business Login settings and request `instagram_business_basic` and `instagram_business_content_publish`. Instagram must be Business/Creator; a Facebook Page is not required. Facebook Page authorisation retains its separate Facebook Login setup. Meta needs eligible accounts and any required app review; TikTok needs Content Posting access, required review and verification of the media URL/domain prefix. Account owners must complete OAuth. Never claim approval merely because credentials are configured.

Publishing defaults off. Only after the corresponding authorisation is suitable for a controlled real test, set the project-specific repository variable `NICHES_YOUTUBE_PUBLISH_ENABLED`, `NICHES_FACEBOOK_PUBLISH_ENABLED`, `NICHES_INSTAGRAM_PUBLISH_ENABLED` or `NICHES_TIKTOK_PUBLISH_ENABLED` to `1`. TikTok also requires `NICHES_TIKTOK_MEDIA_URL_VERIFIED=1` after actual developer-console verification. Deploy, connect the account, review its privacy choices and manually approve a real test post. Record its real provider ID and completion response before calling that integration verified. Provider configuration is not verification.

## Rollback and remaining work

Migration `0002_publishing.sql` adds columns/tables without deleting media, niches or the legacy drafts table. The existing deployment launcher retains a D1 recovery bookmark before applying migrations. Roll back Worker code using the previous immutable release pin; retain the database and storage. Only restore D1 from its bookmark after evaluating writes since that point. Never operate on `aiseo` or the AISO Worker.

Hosted Python/FFmpeg rendering and real reset-email delivery still require an economical authorised service. The existing real local render-to-private-storage journey is preserved; no Cloudflare runtime pretends to execute FFmpeg. Analytics currently displays available stored figures, not invented provider measurements. Cross-repository deployments remain immutable-pin releases rather than an automatic deploy on every ClipMine push.
# Campaign URL groundwork

Drafts may include an optional HTTPS campaign URL. It is stored on the post and
preserved when an edit omits it. Development work adds per-publication manual
confirmation, provider timestamp and permalink fields, a Published view and
server-generated in-app warning records. Instagram metadata retries are read-only;
they do not resubmit posts. The countdown requires an actual provider timestamp.
This work is not yet production-ready: Android push and deep links, full filtering,
cross-niche account reassignment, additional platform permalink retrieval, real
provider testing, and a Niches APK remain incomplete.

