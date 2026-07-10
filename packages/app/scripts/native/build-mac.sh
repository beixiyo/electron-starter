#!/bin/bash
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "Skipping macOS native build: Swift helpers can only be built on macOS"
  exit 0
fi

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$APP_DIR/native/mac"
OUT="$APP_DIR/resources/native/mac"

mkdir -p "$OUT"

build_universal() {
  local name="$1"
  local src_file="$SRC/$name.swift"
  local src_dir="$SRC/$name"
  local out="$OUT/$name"
  local min_macos="${2:-11.0}"
  local extra_flags="${3:-}"
  local -a src_args

  echo "Building $name (macOS $min_macos+)..."

  if [ -d "$src_dir" ]; then
    src_args=("$src_dir"/*.swift)
  else
    src_args=("$src_file")
  fi

  if swiftc -O "${src_args[@]}" $extra_flags \
      -target "arm64-apple-macos$min_macos" -o "${out}-arm64" 2>/dev/null && \
     swiftc -O "${src_args[@]}" $extra_flags \
      -target "x86_64-apple-macos$min_macos" -o "${out}-x86_64" 2>/dev/null; then
    lipo -create -output "$out" "${out}-arm64" "${out}-x86_64"
    rm "${out}-arm64" "${out}-x86_64"
    echo "  Universal binary: $out"
  else
    rm -f "${out}-arm64" "${out}-x86_64"
    swiftc -O "${src_args[@]}" $extra_flags -o "$out"
    echo "  Native binary ($(uname -m)): $out"
  fi

  chmod +x "$out"
}

build_universal "focus-check"
build_universal "fn-listener"
build_universal "audio-monitor" "14.2" "-framework CoreAudio -framework AppKit"
build_universal "audio-recorder" "14.0" "-framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia -framework CoreAudio -framework AppKit"

echo ""
echo "All macOS native binaries built"
