# User Flows

## 1. First successful project

1. User creates an account and personal workspace.
2. User starts a project.
3. Product explains supported files, expected processing and rights requirement.
4. User selects an original file and confirms authorisation.
5. Upload continues directly to private object storage and can recover from interruption.
6. Server validates the media and creates processing stages.
7. User may leave the page and receives in-app status on return.
8. ClipMine produces a transcript and ranked candidate list.
9. User previews candidates, rejects weak ones and opens one in the editor.
10. User trims, corrects captions, adjusts framing and selects a style.
11. User requests final render.
12. User previews and downloads the MP4.

Success: a playable, correctly framed clip is downloaded and remains linked to its source project.

## 2. Upload interruption

1. Connection drops during upload.
2. UI preserves project and confirmed upload parts.
3. User retries from the last confirmed part.
4. Server completes checksum and media validation once all parts arrive.
5. Abandoned multipart uploads are cleaned up after the documented period.

## 3. Low-quality source

1. System detects silence, unusable audio, unsupported codec or insufficient coherent speech.
2. Processing stops at the earliest useful stage.
3. User receives a specific explanation and suggested next action.
4. Failed work does not consume the same allowance as a successfully analysed full project unless costs were already incurred and the policy clearly says so.

## 4. Candidate editing

1. User opens a candidate.
2. Preview starts at the proposed boundary.
3. Transcript highlights with playback.
4. User drags trim handles or selects transcript words.
5. User corrects caption groups and visual focus.
6. Proxy preview updates quickly.
7. Final render creates an immutable version from saved edit instructions.

## 5. Deletion

1. User selects delete project and sees exactly what will be removed.
2. UI requires confirmation.
3. Project becomes unavailable immediately.
4. Asynchronous deletion removes source, proxies, exports, transcript content and derived embeddings.
5. Necessary security/billing records retain only the minimum non-media data for the documented period.
6. UI reports deletion completion or escalation.

## 6. Later direct publishing

1. User connects a supported social account through official OAuth.
2. ClipMine displays account eligibility and current platform-specific requirements.
3. User selects an approved clip, destination and metadata.
4. Product validates media before submission.
5. User explicitly confirms publication.
6. Worker submits or uploads a draft through the official API.
7. Status is updated by polling/webhook with recoverable errors shown clearly.
8. User can disconnect the account and revoke stored authorisation.

