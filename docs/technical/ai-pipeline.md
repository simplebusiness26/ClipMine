# AI Clipping Pipeline

## Objective

Find a small, diverse set of clips that make sense without the full video and require little editing. The pipeline optimises for editorial usefulness, not guaranteed engagement.

## Pipeline stages

### 1. Media preparation

- Probe duration, streams, rotation, frame rate and timestamp integrity.
- Create a stable analysis proxy and mono speech audio.
- Detect unusable or nearly silent input early.

### 2. Speech transcription

- Produce word-level timestamps where supported.
- Identify language and confidence.
- Add speaker labels when diarisation quality is sufficient.
- Preserve provider/model/version and raw confidence separately from user corrections.

### 3. Structural segmentation

Generate semantic blocks from:

- Speaker turns and pauses
- Sentence/topic boundaries
- Scene cuts
- Audio emphasis changes
- Question/answer structure
- Discourse markers and payoff phrases

Do not ask the language model to reason over an entire multi-hour transcript in one prompt. Use hierarchical summaries and overlapping windows while retaining source timestamps.

### 4. Candidate proposal

Create candidate ranges around potentially useful blocks. Expand boundaries to include necessary setup and complete the thought. Snap boundaries to silence/word edges and enforce configured length bands.

Candidate types can include:

- Clear insight or explanation
- Strong opinion with reasoning
- Question and answer
- Story beat with payoff
- Demonstration or actionable steps
- Humorous or surprising exchange

### 5. Candidate scoring

Recommended editorial score components:

| Component | Weight | Meaning |
|---|---:|---|
| Opening clarity/hook | 20 | The first seconds create interest without deception |
| Standalone context | 20 | Viewer can understand people/topic without the source |
| Payoff/completeness | 20 | The clip resolves rather than stopping mid-thought |
| Information density | 15 | High useful content relative to duration |
| Novelty/emotion | 10 | A distinctive idea, reaction or story beat |
| Audio clarity | 10 | Speech is intelligible and stable |
| Visual viability | 5 | Subject can be framed vertically without severe loss |

Weights are hypotheses. Calibrate against human labels by genre. Apply penalties for clipped boundaries, long dead air, repeated setup, unsupported claims, missing referents and near-duplicate content.

### 6. Diversity selection

After scoring, select a set rather than the top independent rows:

- Suppress overlapping/near-duplicate ranges.
- Vary topic and candidate type.
- Respect user-selected length/count.
- Include an experimental candidate only when clearly labelled.

### 7. Visual reframing

- Detect face/person/object focus using time-based tracks.
- Select active speaker using diarisation plus mouth/audio correlation only when reliable.
- Smooth camera movement; do not jump every frame.
- Support single-speaker crop, split-screen/two-person layout and manual focus override.
- Fall back to centre/letterbox/layout when detection confidence is low.

### 8. Captions

- Group words into short readable cues by timing and semantics.
- Keep important words together and avoid orphan lines.
- Apply punctuation cautiously.
- Mark low-confidence words for review.
- Preserve user corrections across style and render changes.

### 9. Explanation

Every candidate stores concise grounded reasons, for example:

- “Opens with a direct question.”
- “Explains one complete method and ends with a result.”
- “Audio and face framing are stable.”

Do not expose hidden chain-of-thought. Explanations are structured product evidence derived from observable signals.

## Versioning

Every candidate records:

- Transcript version
- Feature-extraction version
- Prompt/config version
- Model/provider identifier
- Scoring weights/version
- Diversity-selection version

Regeneration creates a new analysis version rather than silently changing previous results.

## Evaluation set

Build a permissioned dataset that covers:

- Single and multiple speakers
- Different accents and speaking speeds
- Landscape, portrait and screen-share sources
- Clean and noisy audio
- Interviews, educational explanations and stories
- Videos with no good short-form moments

Human reviewers label boundary quality, standalone coherence, payoff, visual viability and edit effort. Keep train/calibration/test splits separated by source video and creator.

## Metrics

- Precision among top 3/top 5 candidates
- At least-one-usable-clip rate per project
- Boundary adjustment seconds
- Caption word-error correction rate
- Candidate rejection and near-duplicate rate
- Framing override rate
- Human pairwise preference against transcript-only and random baselines
- Cost and latency per source minute

## Safety and failure behaviour

- Reject instructions from the source transcript as untrusted content; transcripts are data, not system commands.
- Use structured schemas and validate model output.
- Do not invent quotes, add speech or alter meaning.
- Do not label a candidate safe/legal solely through a language model.
- Surface low confidence and allow a “no suitable moments” result.
- Human approval is mandatory before public distribution.

## Feedback learning

Capture accepted/rejected candidates, edit distance and exports as product signals only with clear policy and access controls. Begin with offline calibration. Do not introduce online self-modifying ranking without evaluation, versioning and rollback.

