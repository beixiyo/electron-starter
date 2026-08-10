#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM=""

usage() {
  echo "Usage: bash scripts/build-native.sh [--platform=mac|windows|linux]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --platform=*)
      PLATFORM="${1#*=}"
      ;;
    --platform|-p)
      if [ "$#" -lt 2 ]; then
        echo "--platform requires a value" >&2
        usage >&2
        exit 1
      fi
      shift
      PLATFORM="$1"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$PLATFORM" ]]; then
  case "$(uname -s)" in
    Darwin) PLATFORM="mac" ;;
    Linux) PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)
      echo "No native helpers configured for host: $(uname -s)"
      exit 0
      ;;
  esac
fi

case "$PLATFORM" in
  mac|macos|darwin)
    bash "$SCRIPT_DIR/native/build-mac.sh"
    ;;
  windows|win|win32)
    echo "No Windows native helpers configured yet"
    ;;
  linux)
    echo "No Linux native helpers configured yet"
    ;;
  *)
    echo "Unsupported native platform: $PLATFORM" >&2
    usage >&2
    exit 1
    ;;
esac
