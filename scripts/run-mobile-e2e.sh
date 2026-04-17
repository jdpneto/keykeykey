#!/usr/bin/env bash
# Dispatch Maestro runs against whichever simulator/emulator is booted.
#
# Usage:
#   scripts/run-mobile-e2e.sh ios     [extra maestro args…]
#   scripts/run-mobile-e2e.sh android [extra maestro args…]
#
# If called with no platform, defaults to `ios`.
set -euo pipefail

platform="${1:-ios}"
shift || true

# pnpm's "--" separator shows up as a literal argument; drop a leading
# one so downstream maestro doesn't try to treat it as a flow path.
if [ "${1-}" = "--" ]; then
  shift
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/e2e/mobile"

# Honour a user-level Maestro install that may not be on PATH.
if ! command -v maestro >/dev/null 2>&1; then
  if [ -x "$HOME/.maestro/bin/maestro" ]; then
    export PATH="$PATH:$HOME/.maestro/bin"
  else
    echo "Maestro CLI not found. Install with:"
    echo "  curl -Ls https://get.maestro.mobile.dev | bash"
    exit 1
  fi
fi

case "$platform" in
  ios)
    if ! command -v xcrun >/dev/null 2>&1; then
      echo "xcrun not found — iOS requires a Mac with Xcode."
      exit 1
    fi
    udid=$(xcrun simctl list devices booted -j | python3 -c 'import sys,json; d=json.load(sys.stdin); print(next(iter([v[0]["udid"] for v in d["devices"].values() if v]), ""))' 2>/dev/null || true)
    if [ -z "${udid}" ]; then
      echo "No iOS simulator booted."
      echo "Boot one with: cd apps/mobile && npx expo run:ios --device \"iPhone 17 Pro\""
      exit 1
    fi
    echo "[run-mobile-e2e] iOS simulator: $udid"
    cd "$mobile_dir" && maestro test --device "$udid" "$@"
    ;;
  android)
    if ! command -v adb >/dev/null 2>&1; then
      echo "adb not found — Android requires Android SDK on PATH."
      exit 1
    fi
    serial=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}' || true)
    if [ -z "${serial}" ]; then
      echo "No Android emulator booted."
      echo "Boot one with: cd apps/mobile && npx expo run:android"
      exit 1
    fi
    echo "[run-mobile-e2e] Android emulator: $serial"
    cd "$mobile_dir" && maestro test --device "$serial" "$@"
    ;;
  *)
    echo "Unknown platform: $platform (expected ios|android)"
    exit 2
    ;;
esac
