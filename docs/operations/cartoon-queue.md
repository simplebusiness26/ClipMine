# Cartoon queue operations

Owner instruction, 6 November 2026: reschedule the remaining Craig's Cartoons
videos to 09:00, 14:00 and 19:00 Europe/London, with a maximum of three videos
per account per local day. TikTok remains drafts only.

`ops/niches-bridge/cartoon-queue.mjs` runs only through the existing AISO bridge
against the dedicated Niches database. It verifies the niche and three provider
identities, inventories media and publication records without reading tokens,
and requires two identical snapshots ten seconds apart. Apply requires the
exact owner-operation environment value documented in the source. Without it,
the operation is a dry run.

A materialized snapshot guard prevents changes if another operator edits the
queue. One SQL UPDATE, with a narrowly scoped temporary operation trigger,
updates calendar dates, publication due times and audit records together.
The trigger is removed afterward. It rejects attempted, leased or submitted
jobs and jobs due within five minutes. Existing publication IDs, metadata,
media, options and provider receipts are preserved. No new publication is
created and no completed publication is cancelled.

Published/uncertain outcomes consume daily capacity. A complete duplicate can
be suppressed only when all three destinations have existing published
receipts for the same media. Partial duplicates or uncertain outcomes abort
planning for review. Old drafts are retained and are not approved implicitly.

The operation saves before/after private recovery inventories in its runner;
the bridge retains these as private short-lived workflow artifacts. After
database verification, inspect the live Niches calendar and account history.
The script does not deploy application changes or activate rendering services.

Run the regression checks with:

```sh
node --test ops/niches-bridge/cartoon-queue.test.mjs
```

The production scripts recovered from earlier cartoon sessions use Python,
Pillow, NumPy and FFmpeg for animated frames, captions and audio assembly.
The newer voice version uses HeyGen audio with two British voices and trims
silence to short reply gaps. These scripts are separate from ClipMine's
long-video clipping engine; a working clipping engine does not establish
automated original cartoon production. Verify new MP4 audio/video streams,
duration, 9:16 dimensions and full decode before importing or scheduling them.
