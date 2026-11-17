# Phone studio quality controls

The existing Colab studio uses `clipmine_api.phone_studio.select_clips` for Best
bits selection. Requested lengths are targets, with a 65–120% duration window.
Candidates end at transcript segment boundaries with sentence punctuation and
reject trailing connectors such as “so, if”. Heavy overlap is suppressed. Fewer
clips are returned when the source cannot supply enough distinct candidates.
Punctuation is a heuristic; it is not proof that a story stands alone.

Numbered parts retain exact boundaries and carry an explicit review warning.
They must not be treated as automatically compliant campaign clips.

Use the free local `small` Whisper model in the phone notebook. Supply verified
campaign names through `CLIPMINE_WHISPER_INITIAL_PROMPT` or the equivalent Settings
field. Hints improve recognition but cannot guarantee factual or verbatim text.
Previous-text conditioning is disabled to reduce repetition propagation.

Exports use ASS captions with an explicit output-sized canvas, a 5%-of-width font,
four-word cues and a lower safe margin of 19% of frame height. The foreground
continues to use contain scaling over a blurred background; no face tracking or
invented speaker crop is claimed. Optional transcript segments preserve pauses;
word timing inside a segment is approximate. Untimed manually edited captions
retain an approximate fallback and require sync review.

Before scheduling, review the actual rendered video for complete context, names,
caption sync, source framing, campaign assets and required disclosures. A render
success is not a campaign approval. Do not send Niches passwords to Colab; its
legacy password client is not a verified safe connection flow. Export transfer
and secure Niches authorization remain separate requirements.

## Regression validation

`tests/test_phone_quality.py` covers fixed-length mid-sentence regression,
short-source underfill, subtitle canvas, pause preservation, range validation and
ASS override escaping. The existing media end-to-end test exercises real FFmpeg
upload, analysis, render and download. Private campaign media stays outside Git.
