# Niches TikTok setup — 4 November 2026

## Current verified result

- Existing app: Niches, ID `7704110079788124167`. No duplicate developer app was created.
- Production URL prefix `https://niches.ai-seo.workers.dev/` is verified using the exact public signature file `tiktokdF2GRe0W0jjwn9lFDwSY2iHKClGNEEDi.txt`.
- The corrected 1024x1024 icon was accepted.
- Terms: <https://niches.ai-seo.workers.dev/terms>.
- Privacy: <https://niches.ai-seo.workers.dev/privacy>.
- Both pages were checked by public HTTP fetch and browser: actual policy headings, approved contact `Craigs.cartoons98@gmail.com`, no placeholder/draft checklist. Operator name supplied by the owner: Niches; no registered-company status is claimed.
- Legal source release: `b4aead33d6ada4dbdab40395b9dcebfd7d8d3787`. Isolated bridge launcher: `6aaba6964a727b7641457dc23fd7fcbea0973fd2` on `ops/niches-cloudflare` in agentCart.
- Deployment run [41764008242](https://github.com/simplebusiness26/agentCart/actions/runs/41764008242) passed, including edge/config tests, build, live authenticated portal/media acceptance and browser smoke. Local build/type-check passed, 4 configuration/legal checks passed, and all 14 social tests passed with simulated provider transport.
- AISO application/database and existing provider credentials were not modified. Publishing flags remain disabled.

## Applied sandbox configuration

Existing-app sandbox `Niches integration testing`, ID `7704121996221204487`:
<https://developers.tiktok.com/app/7704110079788124167/sandbox/7704121996221204487>

Applied successfully after publishing the policies: accepted icon, Productivity category, 114-character description, Web platform, website and legal URLs, Login Kit and Content Posting API with Direct Post. Scopes: `user.info.basic`, `video.upload`, `video.publish`.

Exact saved callback: `https://niches.ai-seo.workers.dev/api/oauth/tiktok/callback`.

Production form contains the same details and an honest review explanation, but its Save is still blocked by the required real demo video. Its current edits are not confirmed persisted. Preserve the production draft tab. No final review submission was made.

## Actual blocker at account login

Selected Add account in sandbox, then the owner chose email/username sign-in through the secure authentication flow. TikTok returned **Maximum number of attempts reached. Try again later.** after this step's single login submission. No repeat attempt or method-switch bypass was made. No target user is confirmed added; do not treat the signed-in developer portal as a signed-in TikTok creator account.

Keep the current login tab for continuation once the platform allows another attempt. Never ask for passwords or OTPs in chat.

## Credential and test gates

TikTok remains unconnected to Niches. The Worker reported TikTok `setup_required` / `oauth_ready=false`; Facebook, Instagram and YouTube remained oauth_ready. The sandbox client key/secret have not been configured.

Use the existing agentCart Actions secrets `NICHES_TIKTOK_CLIENT_KEY` and `NICHES_TIKTOK_CLIENT_SECRET` for the credentials of this sandbox while testing. Existing configure-secrets.mjs imports them into the niches Worker only. Do not retrieve AISO credentials, log secret values, commit values, or assume production and sandbox credentials are interchangeable. The connected GitHub tools do not expose a secret-write endpoint; use a secure owner-operated secrets entry if needed.

After credentials are entered, trigger the existing isolated launcher, verify /api/providers, complete authorised TikTok OAuth, and verify encrypted token storage, connected account and refresh. Enable TikTok-only test publishing only when the account and review/approval screen are ready. Production prefix verification has succeeded; confirm any sandbox-specific media verification requirement before enabling its flag.

Existing publisher supports Direct Post, creator-info validation and status polling. It does not implement the video.upload inbox-draft endpoint. Implement and demonstrate that flow, or remove the unused scope with the owner's agreement before review. The public privacy policy accurately marks inbox-draft upload unavailable.

Then test one explicitly approved private original video and delayed execution, record the real provider ID and final completion, capture a genuine end-to-end sandbox demo, finish the production form, and obtain owner approval immediately before final submission. No real video publishing, scheduling or TikTok approval is claimed.

## Official sources checked

- <https://developers.tiktok.com/docs/en/getting-started-create-an-app>
- <https://developers.tiktok.com/docs/en/add-a-sandbox>
- <https://developers.tiktok.com/docs/en/content-sharing-guidelines>
- <https://developers.tiktok.com/docs/en/content-posting-api-get-started>
- <https://developers.tiktok.com/docs/en/login-kit-web>
- <https://www.cloudflare.com/cloudflare-customer-dpa/>
- <https://ico.org.uk/for-organisations/advice-for-small-organisations/getting-started-with-gdpr/data-protection-self-assessment-medium-businesses/what-information-you-must-supply-under-the-gdpr/>

TikTok requires original creator content and an app intended for a wider audience; an internal/private uploader for accounts managed by one team is explicitly excluded from Direct Post audit. Sandbox does not enable public video publishing. Describe Niches truthfully and demonstrate actual functionality.

## Credential and sandbox verification follow-up

The owner added target user `craigs.cartoon.st` at 03:13 on 4 November 2026; this was independently confirmed after reloading the sandbox. Both `NICHES_TIKTOK_CLIENT_KEY` and `NICHES_TIKTOK_CLIENT_SECRET` are now saved in the existing agentCart encrypted repository secrets. They were transferred directly from the sandbox credential controls into GitHub's secret form without printing values, screenshots of values, source commits or terminal storage. No AISO secret values were retrieved. The existing deployment job was rerun and /api/providers then reported TikTok oauth_ready=true, publishing_enabled=false. The other three providers remained oauth_ready=true.

The sandbox required its own URL property verification in addition to Production. Deployed exact file `apps/web/public/tiktokVyQaiOjmAsnd7BdXUR4GMixp4hVaU4Hd.txt`, source `4396e35e9911a2b6704aa7c0660f16f8d0ec1ccd`, launcher `2d6d81bd5729f6d25be9f8c18a8280f3f7da7744`. Run [41766390614](https://github.com/simplebusiness26/agentCart/actions/runs/41766390614) passed, including live portal/media and browser acceptance. Public file bytes matched the downloaded signature. TikTok sandbox displayed 'Your property has been verified' for `https://niches.ai-seo.workers.dev/`.

Clicked Connect TikTok from the existing Craig's Cartoons niche in the signed-in Niches workspace. Real OAuth initiation succeeded and navigated to TikTok's official login with the sandbox client key, requested three scopes and exact configured callback. It is awaiting TikTok account sign-in and owner consent. No callback success, stored token, connected TikTok account or real publication is yet confirmed. The prior cloud-browser email-login attempt had been rate-limited, so do not silently repeat it. The owner needs to complete sign-in/authorisation; then verify the final account row in Niches. If OAuth state expires while waiting, restart Connect from Niches after login, rather than constructing an auth URL or reusing a code.
