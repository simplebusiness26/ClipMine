# AI Clipping Pipeline

## Objective

Find a small, diverse set of understandable clip drafts with grounded reasons and low editing effort. ClipMine optimises for editorial usefulness, not guaranteed engagement.

## Implemented private-MVP stages

### 1. Media inspection

FFprobe reads streams, duration, dimensions, codec and audio presence. The pipeline rejects files with no video, invalid duration, unreadable metadata or a duration beyond the configured limit.

### 2. Speech transcription

The default provider is local Faster Whisper:

- Model defaults to `tiny` for practical CPU setup.
- Language may be automatic or supplied by the user.
- Voice activity detection is enabled.
- Output is converted to timestamped transcript segments.
- The model runs in an isolated child process so a native-library/CPU failure cannot terminate the API.

The source transcript is treated as untrusted data. It is never executed as an instruction.

If the package/model is unavailable, times out, exits unexpectedly or transcription fails, the project continues in `timeline-fallback` mode rather than failing the whole workflow. The isolation trades some model startup time for a safer private-MVP failure boundary.

### 3. Transcript candidate proposal

For every transcript segment start, the algorithm grows forward until it reaches the requested minimum length, stopping at the maximum. That creates candidate windows aligned to recognised segment boundaries.

### 4. Observable scoring

The deterministic scorer starts from a neutral baseline and adjusts for:

- Question or recognised hook near the opening
- Complete spoken start
- Sentence-complete ending
- Recognised takeaway/payoff language
- Useful speaking density
- Lexical concentration
- Filler-word ratio
- A practical short-form duration band

Reasons shown in the interface are selected from those observable signals. The score is clamped to zero–100 and mapped to high, medium or experimental confidence. It is not a viral prediction.

### 5. Diversity selection

Proposals sort by score. A new candidate is rejected if it overlaps more than 58% of the shorter range with an already selected candidate. Selected candidates are returned in source-time order.

### 6. Timeline fallback

If no transcript candidate exists, ClipMine divides the source into evenly spread ranges using the configured duration band. These candidates:

- Receive an experimental confidence label
- Use a neutral score
- Explain that they came from a continuous source section
- Ask the user to add/correct captions

This makes transcription degradation visible and editable.

### 7. User edit

The user can change title, start, end and caption text. ClipMine validates source bounds and maximum length before saving. An edit invalidates any prior render.

### 8. Vertical render

FFmpeg seeks to the saved source range, builds a 9:16 frame with a blurred fill and centred source, maps optional audio, burns grouped captions and writes an H.264/AAC MP4.

Captions are split into roughly seven-word cues spread across the clip duration. This is a readable MVP approximation, not word-level karaoke timing.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Missing/corrupt video | Project fails with a safe media error |
| Source too long | Project fails with configured limit message |
| Transcription unavailable | Timeline candidates continue |
| No transcript candidates | Timeline candidates continue |
| Invalid user range | API rejects edit without changing project |
| Render failure | Candidate keeps edits and reports failure |
| Process restart | Pending analysis resumes; interrupted render resets to idle |

## Current quality limitations

- Transcript segments are not word-level cues in the UI.
- Scoring is English-pattern-heavy even though transcription can recognise other languages.
- No topic model, semantic embedding or language model is used.
- No scene, face, speaker or motion analysis is used.
- Centre-fit rendering may waste space or reduce subject size.
- Captions distribute by word groups rather than actual word timing.
- No automatic loudness, profanity or platform-policy analysis exists.
- No permissioned human-quality benchmark has yet calibrated the score.

## Evaluation plan

Create a permissioned dataset spanning single/multiple speakers, landscape/portrait, lessons, interviews, screen shares, accents, noise and videos with no useful clips. Keep creators separated between calibration and test sets.

Human reviewers score opening clarity, standalone context, payoff, boundaries, caption accuracy, framing, edit burden and overall usability. Compare:

1. Random valid ranges
2. Timeline fallback
3. Current transcript heuristic
4. Any proposed semantic/visual pipeline

The next model earns adoption only if it improves top-k usable precision without unacceptable cost, latency or regressions.

## Production evolution

Add capabilities in evidence-led order:

1. Better sentence/word boundary alignment and cue timing
2. Language-aware scoring/configuration
3. Transcript semantic ranking with strict structured outputs
4. Scene and face/person tracks
5. Active-speaker confidence and smooth crop tracks
6. Multi-speaker/screen-share fallback layouts
7. Versioned provider/model/config provenance
8. Offline feedback calibration with rollback

Never fabricate quotes, alter the speaker's meaning, execute transcript instructions or publish without explicit user approval.
