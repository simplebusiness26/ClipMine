# Design Specification

Status: interaction baseline, not final visual brand

## Implementation snapshot

The current mobile-first React UI implements a branded dark/gold project home, upload form, upload progress, recent projects, processing state, failure/retry state, candidate list, source preview, title/range/caption editor, render/download state and delete confirmation. It uses sticky mobile actions, labelled controls, responsive grids and reduced-motion handling.

Not yet implemented: sign-in, separate navigation sections, transcript search, crop/focus controls, caption themes, undo/redo, export library, offline upload recovery and full WCAG/browser automation. The detailed specification below remains the target for those additions.

## 1. Experience goal

ClipMine should feel like a calm assistant doing heavy work in the background. The interface must make three things obvious at all times:

1. What the system is doing
2. What the user can change
3. What will happen to the user's media

The design should avoid exaggerated “viral score” theatre. Use plain language, visible confidence and useful explanations.

## 2. Primary form factor

Build a responsive web application/PWA with phone-first flows. Desktop may use additional width for transcript and preview side by side; mobile must retain every core action without horizontal overflow or hidden controls.

## 3. Information architecture

Primary navigation:

- **Projects** — all source videos and their status
- **Create** — start upload/project
- **Exports** — rendered clips
- **Settings** — account, retention, usage, brand and later social connections

Project navigation:

- Overview
- Candidates
- Transcript
- Exports
- Project settings

## 4. Core screens

### Welcome and sign-in

- One-sentence value proposition
- Sign-in/create-account action
- Clear statement that users may upload only content they are authorised to process

### Project list

- Project thumbnail, title, source duration, created date and status
- Status values use text plus icon/colour
- Main action changes by state: resume upload, view progress, review clips, retry or open project
- Empty state demonstrates the workflow without fake performance promises

### New project

- File picker and drag/drop on desktop
- Supported-format guidance before selection
- Language, desired clip count and target-length controls kept optional/simple
- Rights confirmation immediately before upload
- Estimated allowance/cost where known

### Processing

- Stages: Uploading, Validating, Transcribing, Finding moments, Preparing previews
- Overall progress must not invent precise percentages for indeterminate work
- Safe navigation away with return-state explanation
- Cancel shown only when cancellation is safe

### Candidate review

- Vertical preview
- Proposed title and duration
- Selection reasons such as “clear opening,” “complete explanation,” or “strong payoff”
- Score expressed as High/Medium/Experimental confidence, not a fake precision percentage
- Accept, edit and reject actions
- Filter by length/topic and avoid repeated candidates

### Clip editor

Desktop: preview on left; transcript and controls on right.  
Mobile: preview above a tabbed control sheet.

Controls:

- Trim by handles and transcript-word selection
- Play/pause and frame step where feasible
- Caption text, grouping, style and position
- Subject/focus selection and crop offset
- Safe-area overlays for platform UI
- Undo/redo within the current session
- Save draft and Render actions

The on-screen keyboard must move or resize editing controls so the active caption field and primary action remain visible.

### Export

- Render status and recoverable retry
- Final preview
- Download MP4
- Optional caption sidecar
- Version and source attribution within project history
- Later: destination-specific validation and publishing

## 5. Visual direction

Until branding is confirmed:

- Use a dark-neutral or light-neutral base with one high-contrast accent.
- Reserve gold/mining imagery for subtle product cues, not a literal novelty theme.
- Use strong typographic hierarchy and generous space around video.
- Keep analytical data secondary to the clips themselves.
- Do not finalise logo, colours or trademark-dependent assets during the engineering proof.

## 6. Caption system

- Captions stay inside configurable safe areas.
- Minimum text size must remain legible on a typical phone preview.
- Active-word highlighting is optional and must not reduce readability.
- Maximum lines and characters per line are template-controlled.
- Background/stroke/shadow must meet contrast needs over changing footage.
- User can correct words and line breaks before render.

## 7. States and feedback

Every asynchronous surface needs:

- Initial/loading state
- Meaningful empty state
- Progress or queued state
- Success state
- Recoverable error with retry
- Non-recoverable error with next action
- Offline/interrupted state where relevant

Never discard a user's saved edit because rendering failed.

## 8. Accessibility

- Meet WCAG 2.2 AA as the target.
- All actions keyboard reachable.
- Visible focus states.
- Controls have text labels, not icons alone.
- Colour never carries status alone.
- Captions can be edited without audio.
- Motion respects reduced-motion preference.
- Error summaries identify the field and resolution.

## 9. Responsive acceptance checks

Test at minimum:

- 360 px phone width
- 390–430 px common modern phone widths
- Tablet portrait
- 1280 px laptop width
- Software keyboard open during caption editing
- Slow connection and interrupted upload

## 10. Design deliverables before public beta

- Confirmed visual identity and brand clearance
- Component/token library
- High-fidelity flows for project, candidates, editor and export
- Empty/loading/error state inventory
- Usability test results from the chosen beta segment
- Accessibility review
