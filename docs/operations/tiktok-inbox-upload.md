# TikTok inbox upload

TikTok delivery defaults to Direct Post. Creators may choose Send to TikTok inbox for a selected TikTok account and explicitly confirm the transfer. Inbox uploads use video.upload with the inbox initialization endpoint and the existing verified, short-lived media URL. Captions, audience, disclosures and final publishing are completed in TikTok's app after opening its inbox notification.

The existing outbox records the upload identifier before polling. SEND_TO_USER_INBOX ends the job as inbox_delivered. It does not mark the video published or automatically resubmit it. The calendar and account history explain the next step. Existing Direct Post jobs and their recorded approval settings retain their behavior. No database migration is required.

Reference documentation checked on 12 November 2026.

- https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video
- https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status

Provider integration and review approval require real sandbox verification and footage. Automated tests use fixtures.
