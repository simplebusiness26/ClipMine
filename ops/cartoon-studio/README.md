# Craig's Cartoons reusable renderer

This preserves the original Python/Pillow cartoon cast and FFmpeg export path.
The three new scenes have animated limbs, audio-driven mouth movement, changing
props and speech-timed captions. These short cartoons use the established Python
system; the separate Blender book adaptation remains independent.

Kokoro ONNX is the default voice engine. It runs locally on CPU, with no paid
speech API or key. Existing accepted audio may be supplied with word timestamps
to avoid regenerating a successful take. That optional reuse was used for the
ME lines in the first three-cartoon batch. Future batches omit those arguments
and generate both characters locally. Dialogue stays at natural speed; short
reply gaps control pacing.

## Runtime

Use Python, FFmpeg and the pinned packages in requirements.txt. The current
shared cloud environment already has these installed and the model loaded.
For a new free Ubuntu runner, install FFmpeg and the Python requirements, then
download these versioned model assets from the original Kokoro ONNX project:

- https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
- https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

Pass the directory containing both files with `--assets`. Do not commit the
large models, private narration, renders or account data into Git.

## Commands

```sh
python ops/cartoon-studio/render.py --episodes episodes.json --out output --assets assets --smoke
python ops/cartoon-studio/render.py --episodes episodes.json --out output --assets assets
python ops/cartoon-studio/verify.py output
```

The smoke command renders and decodes five seconds per episode. The full render
checks streams, dimensions and duration. Verification decodes complete videos,
checks speech intervals, safe caption bounds, audio signal and sampled motion,
and saves one actual-export frame per second with contact sheets and SHA-256s.
Technical checks and screenshots do not substitute for a complete listening
review; disclose that limitation where applicable.

Episode JSON is a list of objects with id, heading, sub, scene, script (speaker
and text pairs), title, description and hashtags. Existing scenes are `bin`,
`robot` and `pigeon`. Add an appropriate scene implementation when a new subject
requires it; do not label an unrelated template as a matching scene. Reuse
existing cache keys for identical text/voice pairs and check the persistent
production ledger before generating another batch.

## Queue boundary

This renderer does not publish. Import only verified MP4s into the owner's
existing Niches cartoon niche. Review account identities and platform metadata,
then append after the actual last scheduled item at 09:00, 14:00 or 19:00
Europe/London, with three total posts per account per local day. Keep TikTok as
a separate draft. Never rerun the one-time historical rescheduling operation
as part of routine production.
