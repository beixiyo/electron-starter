#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/resources/focus-check.swift"
OUT="$DIR/resources/focus-check"

echo "Building focus-check..."

if swiftc -O "$SRC" -target arm64-apple-macos11.0 -o "${OUT}-arm64" 2>/dev/null && \
   swiftc -O "$SRC" -target x86_64-apple-macos10.15 -o "${OUT}-x86_64" 2>/dev/null; then
  lipo -create -output "$OUT" "${OUT}-arm64" "${OUT}-x86_64"
  rm "${OUT}-arm64" "${OUT}-x86_64"
  echo "✅ Universal binary: $OUT"
else
  rm -f "${OUT}-arm64" "${OUT}-x86_64"
  swiftc -O "$SRC" -o "$OUT"
  echo "✅ Native binary ($(uname -m)): $OUT"
fi

chmod +x "$OUT"
