#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS native build requires Darwin; refusing to use a host fallback" >&2
  exit 1
fi

for command in swift lipo otool file awk shasum curl ditto; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required macOS build tool: $command" >&2
    exit 1
  fi
done

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
NATIVE_DIR="$APP_DIR/native/mac"
OUT_DIR="$APP_DIR/resources/native/mac"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/electron-starter-native-build.XXXXXX")"

readonly ARM64_TRIPLE_PREFIX="arm64-apple-macos"
readonly X86_64_TRIPLE_PREFIX="x86_64-apple-macos"
readonly APM_RELEASE_TAG="recorder-apm-v1"
readonly APM_RELEASE_ASSET="RecorderAPM-2.1-shim-v1-macos-universal.xcframework.zip"
readonly APM_RELEASE_SHA256="4db25d7ddbbc55a63de6132b763e15bc254bcc0b455acc7b56bfcd121169ea99"
readonly APM_RELEASE_URL="https://github.com/beixiyo/electron-starter/releases/download/$APM_RELEASE_TAG/$APM_RELEASE_ASSET"

cleanup() {
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT

mkdir -p "$OUT_DIR"

verify_binary() {
  local binary="$1"
  local product="$2"
  local minimum_macos="$3"

  if [[ ! -x "$binary" ]]; then
    echo "Missing executable output for $product: $binary" >&2
    exit 1
  fi

  local file_description
  file_description="$(file -b "$binary")"
  if [[ "$file_description" != *"Mach-O"* ]]; then
    echo "Output for $product is not a Mach-O binary: $file_description" >&2
    exit 1
  fi

  local architectures
  architectures="$(lipo -archs "$binary")"
  if [[ "$architectures" != "arm64 x86_64" && "$architectures" != "x86_64 arm64" ]]; then
    echo "Output for $product is not a strict arm64+x86_64 universal binary: $architectures" >&2
    exit 1
  fi

  local arch
  for arch in arm64 x86_64; do
    local thin_binary="$BUILD_ROOT/${product}-${arch}.verify"
    lipo -thin "$arch" "$binary" -output "$thin_binary"

    local detected_minimum
    detected_minimum="$(otool -l "$thin_binary" | awk '
      /cmd LC_BUILD_VERSION/ { in_build_version = 1; next }
      in_build_version && /minos / { print $2; exit }
      in_build_version && /^Load command/ { in_build_version = 0 }
    ' | tr -d '[:space:]')"

    if [[ "$detected_minimum" != "$minimum_macos" ]]; then
      echo "Unexpected macOS minimum for $product ($arch): expected $minimum_macos, got ${detected_minimum:-unknown}" >&2
      exit 1
    fi
  done

  echo "  verified $product: $architectures, macOS >= $minimum_macos"
}

build_arch() {
  local package_dir="$1"
  local product="$2"
  local arch="$3"
  local triple="$4"

  echo "  swift build $product ($arch, $triple)"
  swift build \
    --package-path "$package_dir" \
    --configuration release \
    --triple "$triple" \
    --product "$product"

  local bin_path
  bin_path="$(swift build \
    --package-path "$package_dir" \
    --configuration release \
    --triple "$triple" \
    --show-bin-path)"
  ARCH_BINARY="$bin_path/$product"
}

build_product() {
  local package_name="$1"
  local product="$2"
  local minimum_macos="$3"
  local package_dir="$NATIVE_DIR/$package_name"
  local output="$OUT_DIR/$product"

  if [[ ! -f "$package_dir/Package.swift" ]]; then
    echo "Missing Swift package manifest for $product: $package_dir/Package.swift" >&2
    exit 1
  fi

  local arm64_binary
  local x86_64_binary
  build_arch "$package_dir" "$product" arm64 "${ARM64_TRIPLE_PREFIX}${minimum_macos}"
  arm64_binary="$ARCH_BINARY"
  build_arch "$package_dir" "$product" x86_64 "${X86_64_TRIPLE_PREFIX}${minimum_macos}"
  x86_64_binary="$ARCH_BINARY"

  local universal_binary="$BUILD_ROOT/${product}.universal"
  lipo -create -output "$universal_binary" "$arm64_binary" "$x86_64_binary"
  chmod +x "$universal_binary"
  verify_binary "$universal_binary" "$product" "$minimum_macos"

  mv -f "$universal_binary" "$output"
  chmod +x "$output"
  echo "  output: $output"
}

APM_XCFRAMEWORK="$NATIVE_DIR/audio-recorder/Vendor/RecorderAPM.xcframework"
apm_provenance_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' \
    "$APM_XCFRAMEWORK/BUILD-PROVENANCE.txt"
}

apm_file_matches_provenance() {
  local file="$1"
  local key="$2"
  local expected
  expected="$(apm_provenance_value "$key")"
  [[ -n "$expected" ]] || return 1
  [[ "$(shasum -a 256 "$file" | awk '{print $1}')" == "$expected" ]]
}

has_valid_apm_artifact() {
  local required_file
  for required_file in \
    "$APM_XCFRAMEWORK/Info.plist" \
    "$APM_XCFRAMEWORK/BUILD-PROVENANCE.txt" \
    "$APM_XCFRAMEWORK/macos-arm64_x86_64/libRecorderAPM.a" \
    "$APM_XCFRAMEWORK/macos-arm64_x86_64/Headers/RecorderAPM.h" \
    "$APM_XCFRAMEWORK/macos-arm64_x86_64/Headers/module.modulemap"; do
    [[ -s "$required_file" ]] || return 1
  done

  local architectures
  if ! architectures="$(lipo -archs "$APM_XCFRAMEWORK/macos-arm64_x86_64/libRecorderAPM.a" 2>/dev/null)"; then
    return 1
  fi
  [[ "$architectures" == "arm64 x86_64" || "$architectures" == "x86_64 arm64" ]] || return 1

  apm_file_matches_provenance \
    "$NATIVE_DIR/audio-recorder/APMShim/RecorderAPM.cpp" \
    shim_cpp_sha256 || return 1
  apm_file_matches_provenance \
    "$NATIVE_DIR/audio-recorder/APMShim/include/RecorderAPM.h" \
    shim_header_sha256 || return 1
  apm_file_matches_provenance \
    "$SCRIPT_DIR/build-webrtc-apm.sh" \
    build_script_sha256 || return 1
  apm_file_matches_provenance \
    "$APM_XCFRAMEWORK/macos-arm64_x86_64/Headers/RecorderAPM.h" \
    vendored_header_sha256 || return 1
  apm_file_matches_provenance \
    "$APM_XCFRAMEWORK/macos-arm64_x86_64/Headers/module.modulemap" \
    modulemap_sha256 || return 1
  apm_file_matches_provenance \
    "$APM_XCFRAMEWORK/Info.plist" \
    info_plist_sha256 || return 1
  apm_file_matches_provenance \
    "$APM_XCFRAMEWORK/macos-arm64_x86_64/libRecorderAPM.a" \
    archive_sha256
}

download_apm_artifact() {
  local archive="$BUILD_ROOT/$APM_RELEASE_ASSET"
  local extract_dir="$BUILD_ROOT/recorder-apm-release"
  local extracted_framework="$extract_dir/RecorderAPM.xcframework"
  local installing_framework="${APM_XCFRAMEWORK}.installing"

  echo "RecorderAPM artifact is missing; downloading $APM_RELEASE_TAG"
  if ! curl \
    --fail \
    --location \
    --silent \
    --show-error \
    --connect-timeout 10 \
    --max-time 180 \
    --retry 2 \
    "$APM_RELEASE_URL" \
    -o "$archive"; then
    return 1
  fi

  local actual_sha256
  actual_sha256="$(shasum -a 256 "$archive" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$APM_RELEASE_SHA256" ]]; then
    echo "Unexpected RecorderAPM release SHA256: $actual_sha256" >&2
    return 2
  fi

  mkdir -p "$extract_dir"
  if ! ditto -x -k "$archive" "$extract_dir" || [[ ! -d "$extracted_framework" ]]; then
    echo "Invalid RecorderAPM release archive layout" >&2
    return 2
  fi

  rm -rf -- "$installing_framework"
  if ! cp -R "$extracted_framework" "$installing_framework"; then
    echo "Failed to stage RecorderAPM release artifact" >&2
    return 2
  fi
  rm -rf -- "$APM_XCFRAMEWORK"
  if ! mv "$installing_framework" "$APM_XCFRAMEWORK"; then
    echo "Failed to install RecorderAPM release artifact" >&2
    return 2
  fi
  echo "RecorderAPM release installed: $APM_XCFRAMEWORK"
}

if ! has_valid_apm_artifact; then
  download_status=0
  download_apm_artifact || download_status=$?
  if [[ "$download_status" -eq 1 ]]; then
    echo "RecorderAPM release is unavailable; building it from pinned source"
    bash "$SCRIPT_DIR/build-webrtc-apm.sh"
  elif [[ "$download_status" -ne 0 ]]; then
    exit 1
  fi

  if ! has_valid_apm_artifact; then
    echo "RecorderAPM artifact failed provenance validation" >&2
    exit 1
  fi
fi

APM_LICENSES_SOURCE="$NATIVE_DIR/audio-recorder/Vendor/RecorderAPM-LICENSES"
APM_LICENSES_OUTPUT="$OUT_DIR/RecorderAPM-LICENSES"
readonly APM_LICENSE_FILES=(
  Abseil-LICENSE
  Ooura-LICENSE
  PFFFT-LICENSE
  RNNoise-COPYING
  SPLSqrtFloor-LICENSE
  WebRTC-LICENSE
  WebRTC-PATENTS
  WebRTCFFT-LICENSE
  webrtc-audio-processing-COPYING
)
if [[ ! -d "$APM_LICENSES_SOURCE" ]]; then
  echo "Missing RecorderAPM license directory: $APM_LICENSES_SOURCE" >&2
  exit 1
fi
for license_file in "${APM_LICENSE_FILES[@]}"; do
  if [[ ! -s "$APM_LICENSES_SOURCE/$license_file" ]]; then
    echo "Missing or empty RecorderAPM license file: $APM_LICENSES_SOURCE/$license_file" >&2
    exit 1
  fi
done

build_product accessibility focus-check 11.0
build_product accessibility fn-listener 11.0
build_product accessibility settings-window 11.0
build_product hour-cycle hour-cycle 14.2
build_product audio-monitor audio-monitor 14.2
build_product audio-recorder audio-recorder 14.0
build_product screenshot-capture screenshot-capture 14.0

rm -rf -- "$APM_LICENSES_OUTPUT"
mkdir -p "$APM_LICENSES_OUTPUT"
for license_file in "${APM_LICENSE_FILES[@]}"; do
  cp "$APM_LICENSES_SOURCE/$license_file" "$APM_LICENSES_OUTPUT/$license_file"
done
echo "  output: $APM_LICENSES_OUTPUT"

echo
echo "All macOS native binaries built and verified"
