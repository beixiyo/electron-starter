#!/bin/bash
set -e

if [ "$(uname)" != "Darwin" ]; then
  echo "⏭ Skipping native build (macOS only)"
  exit 0
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)"
RES="$DIR/resources"

build_universal() {
  local name="$1"
  local src="$RES/$name.swift"
  local out="$RES/$name"
  local min_macos="${2:-11.0}"
  local extra_flags="${3:-}"

  echo "Building $name (macOS $min_macos+)..."

  if swiftc -O "$src" $extra_flags \
      -target "arm64-apple-macos$min_macos" -o "${out}-arm64" 2>/dev/null && \
     swiftc -O "$src" $extra_flags \
      -target "x86_64-apple-macos$min_macos" -o "${out}-x86_64" 2>/dev/null; then
    lipo -create -output "$out" "${out}-arm64" "${out}-x86_64"
    rm "${out}-arm64" "${out}-x86_64"
    echo "  ✅ Universal binary: $out"
  else
    rm -f "${out}-arm64" "${out}-x86_64"
    swiftc -O "$src" $extra_flags -o "$out"
    echo "  ✅ Native binary ($(uname -m)): $out"
  fi

  chmod +x "$out"
}

build_universal "focus-check"
build_universal "fn-listener"
build_universal "audio-monitor" "14.2" "-framework CoreAudio -framework AppKit"
build_universal "audio-recorder" "14.0" "-framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia -framework CoreAudio -framework AppKit"

echo ""
echo "All native binaries built ✅"
