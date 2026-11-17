# ADR-009: ClipMine export handoff without sharing account credentials

- Status: Implemented; live browser verification pending
- Date: 2026-11-17

## Context

The Colab notebook's password client was blocked because it requested Niches
credentials outside a verified Niches authentication page. Normal Colab downloads
also did not produce a completed browser download. The user authorised improving
ClipMine and retrying campaign exports without paid services or another editor.

## Decision

Keep authentication entirely on Niches. A ClipMine output button opens a Niches
review page and sends only the selected MP4 through a browser `postMessage`
exchange. The sender validates the exact Niches origin and popup reference.
The receiver validates its opener, the Colab origin, MP4 signature and 25 MiB cap.
It accepts one payload into memory. The readiness signal contains no private data.

Receiving data does not upload, create a draft, schedule or publish. The operator
must review the video, explicitly select one connected Instagram account and click
Save Instagram draft. Niches uses its existing authenticated upload/draft routes.
No new credentials, grants, public media URLs or server authentication bypasses are
introduced. Existing server ownership, Origin and storage protections stay in force.

## Consequences

Both tabs must remain open during transfer. Popup/opener restrictions can prevent
the exchange; do not disable browser protections to make it work. Untrusted Colab
content can offer a file for review, but cannot select the account or save it.
The MP4 is visible in the private notebook output, like its existing video preview;
do not share that notebook or commit its outputs. Only reviewed clips should be sent.

Publishing remains a separate Niches action. Distribution must be rechecked at
scheduling, including any master-brand automatic account setting.
