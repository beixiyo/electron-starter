#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "RecorderAPM artifact build requires macOS" >&2
  exit 1
fi

for command in curl grep shasum python3 clang++ libtool lipo tar awk; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required build tool: $command" >&2
    exit 1
  fi
done

readonly APM_VERSION="2.1"
readonly APM_TARBALL_SHA256="ae9302824b2038d394f10213cab05312c564a038434269f11dbf68f511f9f9fe"
readonly APM_URL="https://gstreamer.freedesktop.org/src/mirror/webrtc-audio-processing/webrtc-audio-processing-${APM_VERSION}.tar.xz"
readonly MINIMUM_MACOS="14.0"
readonly MESON_VERSION="1.6.1"
readonly NINJA_VERSION="1.11.1.3"
readonly ABSEIL_VERSION="20240722.0"
readonly ABSEIL_SOURCE_SHA256="f50e5ac311a81382da7fa75b97310e4b9006474f9560ac46f54a9967f07d4ae3"
readonly ABSEIL_PATCH_SHA256="12dd8df1488a314c53e3751abd2750cf233b830651d168b6a9f15e7d0cf71f7b"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGE_DIR="$APP_DIR/native/mac/audio-recorder"
SHIM_DIR="$PACKAGE_DIR/APMShim"
XCFRAMEWORK_DIR="$PACKAGE_DIR/Vendor/RecorderAPM.xcframework"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/recorder-apm-build.XXXXXX")"
VENDOR_DIR="$BUILD_ROOT/RecorderAPM.xcframework/macos-arm64_x86_64"

cleanup() {
  rm -rf -- "$BUILD_ROOT"
}
trap cleanup EXIT

for source in "$SHIM_DIR/RecorderAPM.cpp" "$SHIM_DIR/include/RecorderAPM.h"; do
  if [[ ! -f "$source" ]]; then
    echo "Missing RecorderAPM shim source: $source" >&2
    exit 1
  fi
done

curl --fail --location --silent --show-error "$APM_URL" -o "$BUILD_ROOT/apm.tar.xz"
actual_tarball_sha="$(shasum -a 256 "$BUILD_ROOT/apm.tar.xz" | awk '{print $1}')"
if [[ "$actual_tarball_sha" != "$APM_TARBALL_SHA256" ]]; then
  echo "Unexpected WebRTC APM tarball SHA256: $actual_tarball_sha" >&2
  exit 1
fi

tar -xf "$BUILD_ROOT/apm.tar.xz" -C "$BUILD_ROOT"
SOURCE_DIR="$BUILD_ROOT/webrtc-audio-processing-$APM_VERSION"
ABSEIL_WRAP="$SOURCE_DIR/subprojects/abseil-cpp.wrap"
for expected_line in \
  "directory = abseil-cpp-$ABSEIL_VERSION" \
  "source_hash = $ABSEIL_SOURCE_SHA256" \
  "patch_hash = $ABSEIL_PATCH_SHA256"; do
  if ! grep -Fqx "$expected_line" "$ABSEIL_WRAP"; then
    echo "Unexpected Abseil wrap metadata: $expected_line" >&2
    exit 1
  fi
done

python3 -m venv "$BUILD_ROOT/venv"
"$BUILD_ROOT/venv/bin/python" -m pip install --quiet \
  "meson==$MESON_VERSION" \
  "ninja==$NINJA_VERSION"
export PATH="$BUILD_ROOT/venv/bin:$PATH"

build_arch() {
  local arch="$1"
  local cpu_family="$2"
  local cpu="$3"
  local cross_file="$BUILD_ROOT/cross-$arch.ini"
  local build_dir="$BUILD_ROOT/build-$arch"
  local install_dir="$BUILD_ROOT/install-$arch"
  local artifact_dir="$BUILD_ROOT/artifact-$arch"

  cat >"$cross_file" <<EOF
[binaries]
c = ['clang', '-arch', '$arch', '-mmacosx-version-min=$MINIMUM_MACOS']
cpp = ['clang++', '-arch', '$arch', '-mmacosx-version-min=$MINIMUM_MACOS']
ar = 'ar'
strip = 'strip'

[host_machine]
system = 'darwin'
cpu_family = '$cpu_family'
cpu = '$cpu'
endian = 'little'

[properties]
needs_exe_wrapper = true
EOF

  meson setup "$build_dir" "$SOURCE_DIR" \
    --cross-file "$cross_file" \
    --wrap-mode=forcefallback \
    --default-library=static \
    --buildtype=release \
    -Db_ndebug=true \
    --prefix="$install_dir"
  meson compile -C "$build_dir"
  meson install -C "$build_dir"

  mkdir -p "$artifact_dir"
  clang++ \
    -arch "$arch" \
    "-mmacosx-version-min=$MINIMUM_MACOS" \
    -std=c++17 -O3 -DNDEBUG \
    -DWEBRTC_POSIX -DWEBRTC_MAC -DWEBRTC_APM_DEBUG_DUMP=0 \
    -I"$SHIM_DIR/include" \
    -I"$SOURCE_DIR/webrtc" \
    -I"$SOURCE_DIR/subprojects/abseil-cpp-$ABSEIL_VERSION" \
    -c "$SHIM_DIR/RecorderAPM.cpp" \
    -o "$artifact_dir/RecorderAPM.o"
  libtool -static \
    -o "$artifact_dir/libRecorderAPM.a" \
    "$artifact_dir/RecorderAPM.o" \
    "$install_dir/lib/libwebrtc-audio-processing-2.a"
}

build_arch arm64 aarch64 arm64
build_arch x86_64 x86_64 x86_64

mkdir -p "$VENDOR_DIR/Headers"
lipo -create \
  -output "$BUILD_ROOT/libRecorderAPM.a" \
  "$BUILD_ROOT/artifact-arm64/libRecorderAPM.a" \
  "$BUILD_ROOT/artifact-x86_64/libRecorderAPM.a"
cp "$BUILD_ROOT/libRecorderAPM.a" "$VENDOR_DIR/libRecorderAPM.a"
cp "$SHIM_DIR/include/RecorderAPM.h" "$VENDOR_DIR/Headers/RecorderAPM.h"
cat >"$VENDOR_DIR/Headers/module.modulemap" <<'EOF'
module RecorderAPM {
  header "RecorderAPM.h"
  export *
}
EOF
cat >"$BUILD_ROOT/RecorderAPM.xcframework/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AvailableLibraries</key>
  <array>
    <dict>
      <key>HeadersPath</key>
      <string>Headers</string>
      <key>LibraryIdentifier</key>
      <string>macos-arm64_x86_64</string>
      <key>LibraryPath</key>
      <string>libRecorderAPM.a</string>
      <key>SupportedArchitectures</key>
      <array>
        <string>arm64</string>
        <string>x86_64</string>
      </array>
      <key>SupportedPlatform</key>
      <string>macos</string>
    </dict>
  </array>
  <key>CFBundlePackageType</key>
  <string>XFWK</string>
  <key>XCFrameworkFormatVersion</key>
  <string>1.0</string>
</dict>
</plist>
EOF

architectures="$(lipo -archs "$VENDOR_DIR/libRecorderAPM.a")"
if [[ "$architectures" != "arm64 x86_64" && "$architectures" != "x86_64 arm64" ]]; then
  echo "Unexpected RecorderAPM architectures: $architectures" >&2
  exit 1
fi

archive_sha256="$(shasum -a 256 "$VENDOR_DIR/libRecorderAPM.a" | awk '{print $1}')"
shim_cpp_sha256="$(shasum -a 256 "$SHIM_DIR/RecorderAPM.cpp" | awk '{print $1}')"
shim_header_sha256="$(shasum -a 256 "$SHIM_DIR/include/RecorderAPM.h" | awk '{print $1}')"
build_script_sha256="$(shasum -a 256 "$SCRIPT_DIR/build-webrtc-apm.sh" | awk '{print $1}')"
vendored_header_sha256="$(shasum -a 256 "$VENDOR_DIR/Headers/RecorderAPM.h" | awk '{print $1}')"
modulemap_sha256="$(shasum -a 256 "$VENDOR_DIR/Headers/module.modulemap" | awk '{print $1}')"
info_plist_sha256="$(shasum -a 256 "$BUILD_ROOT/RecorderAPM.xcframework/Info.plist" | awk '{print $1}')"
cat >"$BUILD_ROOT/RecorderAPM.xcframework/BUILD-PROVENANCE.txt" <<EOF
webrtc_audio_processing_version=$APM_VERSION
webrtc_audio_processing_tarball_sha256=$APM_TARBALL_SHA256
webrtc_baseline=M131
abseil_version=$ABSEIL_VERSION
abseil_source_sha256=$ABSEIL_SOURCE_SHA256
abseil_patch_sha256=$ABSEIL_PATCH_SHA256
meson_version=$MESON_VERSION
ninja_version=$NINJA_VERSION
minimum_macos=$MINIMUM_MACOS
architectures=$architectures
shim_cpp_sha256=$shim_cpp_sha256
shim_header_sha256=$shim_header_sha256
build_script_sha256=$build_script_sha256
vendored_header_sha256=$vendored_header_sha256
modulemap_sha256=$modulemap_sha256
info_plist_sha256=$info_plist_sha256
archive_sha256=$archive_sha256
EOF

echo "RecorderAPM built: $architectures"
echo "RecorderAPM archive SHA256: $archive_sha256"

mkdir -p "$(dirname "$XCFRAMEWORK_DIR")"
rm -rf -- "$XCFRAMEWORK_DIR"
mv "$BUILD_ROOT/RecorderAPM.xcframework" "$XCFRAMEWORK_DIR"
echo "RecorderAPM installed: $XCFRAMEWORK_DIR"
