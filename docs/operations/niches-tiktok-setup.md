# Niches TikTok setup — 2026-11-04

## Confirmed live state

- Existing developer app: Niches, app ID `7704110079788124167`, Production Draft. No duplicate app created.
- URL prefix `https://niches.ai-seo.workers.dev/` is verified in TikTok Production. The exact signature is served from `apps/web/public/tiktokdF2GRe0W0jjwn9lFDwSY2iHKClGNEEDi.txt`.
- Signature source release: `9993395aa1569b7f36983a161a3e510f92d3c164`. AISO operations launcher commit: `c6bb23f427838eb06107cc07f0b16a21c66dfece`, on `ops/niches-cloudflare` only.
- Worker health returned that release with database=true, storage=true, storage_backend=kv. The exact public signature bytes were checked.
- Workflow run `41761413692`: first attempt passed checks, edge/config tests, build and deployment; live acceptance failed with `ECONNRESET`. One retry was requested; consult its latest status before claiming acceptance passed.
- `/api/providers` reports TikTok setup_required / oauth_ready=false / publishing_enabled=false. Facebook, Instagram and YouTube report oauth_ready=true. No existing integration credentials were changed.
- `/terms` currently falls through to the workspace rather than displaying a policy. Legal pages are not verified or supplied to TikTok.

## Portal draft work

Entered Productivity category, a description within TikTok's 120-character limit, Web platform, website URL and exact Login Kit callback `https://niches.ai-seo.workers.dev/api/oauth/tiktok/callback`. Added Login Kit and Content Posting API, with Direct Post selected and user.info.basic, video.upload and video.publish visible. Entered an honest review explanation identifying untested functionality.

These form edits are NOT confirmed saved: TikTok rejects Save while icon, legal URLs and demo requirements are incomplete. Preserve the open draft tab. URL property verification is confirmed separately and persisted in the URL properties list.

The previous icon was found, but upload was rejected because its dimensions are not exactly 1024x1024. Do not call the icon uploaded.

## Secure configuration

Use existing agentCart repository Actions secrets `NICHES_TIKTOK_CLIENT_KEY` and `NICHES_TIKTOK_CLIENT_SECRET`. Existing configure-secrets.mjs imports them into the niches Worker only. Do not retrieve or print existing credentials; never commit values. Keep publish and media-verification feature flags off until the corresponding test gates are satisfied. No paid services are required by this setup.

## Remaining gates

1. Obtain real operator/controller name and an authorised public support/privacy email. Do not publish a personal email inferred from account screens or commit metadata. Prepare truthful UK-focused policies covering accounts, connected account IDs/tokens, original media, approvals/schedules, service providers, purposes/lawful bases, transfers, retention, deletion, rights, ICO complaints and contact. Verify public pages before filling portal URLs.
2. Supply a 1024x1024 icon and genuine end-to-end sandbox demonstration. Do not fabricate demo footage.
3. Configure sandbox for the same existing app, authorised test account and credentials through the secure workflow. Production Draft credentials alone are not proof OAuth is available.
4. Test live OAuth state/session validation, redirect, callback, encrypted token storage, connection and refresh. Do not treat deployment or local fixtures as provider verification.
5. Existing publisher implements Direct Post, creator-info validation and status polling. It does not implement the video.upload inbox-draft endpoint. Implement and demonstrate that flow, or remove the unused scope with the owner's agreement before review.
6. Test one explicitly approved private video, recording provider ID and final completion. Test delayed execution separately. Do not publish public user content implicitly.
7. Prepare final review explanation and recording, then ask the owner before final submission. Public Direct Post remains conditional on TikTok audit.

## Official requirements checked

- <https://developers.tiktok.com/docs/en/getting-started-create-an-app>
- <https://developers.tiktok.com/docs/en/content-sharing-guidelines>
- <https://developers.tiktok.com/docs/en/content-posting-api-get-started>
- <https://developers.tiktok.com/docs/en/login-kit-web>

TikTok requires original creator content and a service intended for a wide audience; an internal/private uploader for accounts managed by one team is explicitly not acceptable for Direct Post audit. Unaudited clients have private visibility and user restrictions. Niches must be described truthfully. App review requires a genuine sandbox demonstration for apps not approved before.
