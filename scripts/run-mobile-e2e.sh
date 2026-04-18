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

# Propagate WebDAV credentials to Maestro so sync-flow.yaml can reach
# them via ${KKK_WEBDAV_*}. Only passed if set in the shell.
env_args=()
for var in KKK_WEBDAV_URL KKK_WEBDAV_USER KKK_WEBDAV_PASS KKK_WEBDAV_CLEAR_URL; do
  if [ -n "${!var-}" ]; then
    env_args+=(-e "${var}=${!var}")
  fi
done

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
    cd "$mobile_dir" && maestro test --device "$udid" "${env_args[@]}" "$@"
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
    # Suppress system-wide ANR / crash dialogs. On low-spec emulators
    # (Small_Phone at 4GB RAM) background services like Digital
    # Wellbeing occasionally ANR mid-test; the ANR dialog renders on
    # top of our app and blocks Maestro taps. This setting tells the
    # system to silently kill the offending process instead.
    adb -s "$serial" shell settings put global hide_error_dialogs 1 \
      >/dev/null 2>&1 || true
    # Push CSV + encrypted-backup fixtures so import-export flows
    # can pick them from /sdcard/Download. Idempotent — adb push
    # overwrites. Silent on success.
    #
    # Pixel devices (and any modern Android with scoped storage) don't
    # surface adb-pushed files to the document picker until the
    # MediaStore scanner indexes them. Broadcast a scan after each
    # push; emulators ignore this harmlessly.
    fixtures_dir="$repo_root/e2e/fixtures/password-imports"
    if [ -d "$fixtures_dir" ]; then
      for f in "$fixtures_dir"/*.csv; do
        [ -f "$f" ] || continue
        base="$(basename "$f")"
        adb -s "$serial" push "$f" "/sdcard/Download/$base" >/dev/null 2>&1 || true
        adb -s "$serial" shell am broadcast \
          -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
          -d "file:///sdcard/Download/$base" >/dev/null 2>&1 || true
      done
    fi
    cd "$mobile_dir" && maestro test --device "$serial" "${env_args[@]}" "$@"
    ;;
  *)
    echo "Unknown platform: $platform (expected ios|android)"
    exit 2
    ;;
esac
