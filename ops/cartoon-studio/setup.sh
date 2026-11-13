#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m pip install -r requirements.txt
mkdir -p assets
for name in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ ! -f "assets/$name" ]; then
    curl -fL "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$name" -o "assets/$name"
  fi
done
cd assets
sha256sum -c ../model-sha256.txt
