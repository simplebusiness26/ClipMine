# Product Requirements Document

Status: baseline for prototype and MVP planning  
Date: 2026-08-13

## 1. Summary

ClipMine is a mobile-first web application that converts a creator-owned long-form video into several editable vertical video drafts. It uses transcription, semantic analysis and visual signals to find strong self-contained moments, then renders clips with active-speaker framing and captions. The creator reviews every result before download or later platform publishing.

## 2. Goals

- Reduce the time required to find usable moments in long video.
- Produce several genuinely distinct, coherent clip candidates.
- Make each draft publishable with only light corrections.
- Work reliably from a phone as well as desktop.
- Establish a secure, recoverable and cost-measurable processing pipeline.

## 3. Non-goals for MVP

- Arbitrary YouTube URL download
- One-click public autopublishing
- A full multitrack video editor
- Generative avatars, voice cloning or synthetic dialogue
- Automated claims that a clip will go viral
- Agency workflows, client approvals or deep analytics

## 4. Personas

### Solo creator

Uploads a weekly podcast, interview, lesson or commentary video and needs several shorts without manually reviewing the full recording.

### Small content operator

Processes videos for a founder, brand or show and needs consistent framing, captions and downloadable drafts.

### Administrator

Monitors system health, usage, abuse reports and failed processing without having routine access to private media.

## 5. Core user stories

- As a creator, I can upload an original video and recover from a weak connection.
- I can see processing stages and a useful failure message.
- I can receive ranked candidates with a reason each was selected.
- I can preview a candidate before rendering all outputs.
- I can adjust the start, end, crop focus and caption text.
- I can select a caption style and optional brand kit.
- I can render and download a standards-compliant MP4.
- I can delete a source, project and generated outputs.
- I can see how much processing allowance a project will consume.

## 6. Functional requirements

### FR-1 Accounts and workspaces

- Email or supported OAuth sign-in.
- One personal workspace at MVP launch.
- Server-side authorisation on every project and asset action.
- Account export and deletion entry points.

### FR-2 Project creation and upload

- Create a project with title, language selection or auto-detect, desired clip count and approximate target length.
- Accept supported original media containers after server validation.
- Use resumable multipart/direct-to-object-storage uploads.
- Display byte progress, pause/retry where supported, checksum and final validation.
- Require confirmation that the user owns or is authorised to process and republish the content.

### FR-3 Processing

- Generate a lower-resolution proxy for analysis and previews.
- Extract audio and produce timestamped transcription.
- Detect speaker turns, scenes and useful visual focus signals when feasible.
- Generate, score, deduplicate and rank candidate time ranges.
- Persist each stage so a failed job can resume safely.

### FR-4 Candidate review

- Display candidate title, duration, score band and selection reasons.
- Provide transcript search and source-time navigation.
- Allow accept, reject and regenerate actions.
- Never present the score as a guarantee of performance.

### FR-5 Editing

- Adjust in/out points within a bounded window.
- Correct words, punctuation and line breaks.
- Select or reposition the primary visual focus.
- Choose caption theme, placement and safe-area preview.
- Preview changes using a proxy before final render.

### FR-6 Rendering and export

- Render vertical MP4 using a documented output profile.
- Burn captions into video and optionally export an SRT/VTT sidecar.
- Expose render progress and retry.
- Provide a time-limited authenticated download.
- Retain a version history without duplicating unchanged source data.

### FR-7 Project management

- List projects by status and date.
- Cancel queued work where safe.
- Retry recoverable failures.
- Delete source and derived assets with a visible pending/completed state.

### FR-8 Administration

- View aggregate job health, cost and failure categories.
- Suspend abusive accounts and revoke sessions.
- Process deletion and rights complaints.
- Access private media only through an audited, exceptional support workflow.

## 7. Non-functional requirements

- **Privacy:** media private by default; no public object URLs.
- **Reliability:** jobs idempotent and restartable by stage.
- **Performance:** interactive pages remain responsive while background work runs.
- **Accessibility:** keyboard operation, meaningful labels, adequate contrast and caption editing that works without audio.
- **Mobile:** core upload, review, edit and download flows usable on a modern phone.
- **Observability:** correlation IDs, stage timing, failure taxonomy and cost events without transcript leakage.
- **Portability:** AI providers and social publishers accessed through explicit adapters.

## 8. Output requirements

The default output is a 9:16 H.264/AAC MP4 with web-compatible colour and audio settings. Exact platform duration, bitrate, resolution and metadata constraints must come from a versioned capability registry because platform rules change. Do not hard-code a single universal definition of a Short or Reel.

## 9. AI quality requirements

- Candidate boundaries must align with words and avoid clipped syllables.
- Each candidate must contain enough context to stand alone.
- The set must minimise near-duplicates.
- Selection reasons must be grounded in transcript or audiovisual evidence.
- Low-confidence or unsuitable source material must produce a clear message, not fabricated certainty.
- User edits, accepts and rejects may be stored as product feedback only under the documented privacy policy.

## 10. Rights and publishing requirements

- Original upload is the default input.
- Pasting a public video URL must not trigger scraping or downloading.
- Users must confirm sufficient rights before processing and again before publishing.
- Provide takedown, dispute, deletion and repeat-abuse processes before public launch.
- Direct publishing must use official platform authorisation and remain a distinct user-confirmed action.

## 11. Success measures

Prototype:

- At least 70% of test projects yield one candidate a reviewer marks usable with light editing.
- All tested jobs finish, recover or fail with an actionable message.
- No cross-user asset access in authorisation tests.

MVP beta:

- Project-to-export conversion
- Median accepted candidates per project
- Median caption corrections and trim adjustment per exported clip
- Processing time and cost per source minute
- Job success after automatic retry
- Four-week creator retention

Targets beyond the prototype are hypotheses and should be set after real baseline data.

## 12. Launch gates

- Rights acknowledgement and takedown process reviewed
- Data retention and deletion verified end to end
- Threat model and tenant-isolation tests complete
- Real-device mobile testing complete
- Processing cost caps and abuse limits enabled
- At least 20 permissioned videos across target genres evaluated
- Support runbook and status monitoring operational

## 13. Dependencies and risks

- Long uploads and mobile network failure
- Expensive or slow media processing
- Candidate quality varying by genre and language
- Incorrect speaker framing
- OAuth and platform review delays
- Copyrighted music or third-party material within otherwise owned footage
- AI/provider policy or pricing changes

## 14. Open product decisions

- Narrow beta segment
- Pricing and monthly processing allowance
- Maximum source length and size
- Supported launch languages
- Whether collaboration enters before or after direct social publishing

