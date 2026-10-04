#!/usr/bin/env bash
# Build KeyKeyKey for the Mac App Store and export (or upload) a signed .pkg.
#
#   APPLE_TEAM_ID=XXXXXXXXXX [BUILD_NUMBER=n] scripts/build-mac-app-store.sh [export|upload]
#
# Tauri builds a universal, sandboxed .app (identifier com.keykeykey.app, the
# same App Store record as iOS); we wrap it in an .xcarchive so Xcode's
# exportArchive does the distribution signing, provisioning profile and
# installer package with the Apple ID signed into Xcode — no API keys needed.
set -euo pipefail

: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID (10-char Team ID)}"
DESTINATION="${1:-export}"
case "$DESTINATION" in export | upload) ;; *) echo "usage: $0 [export|upload]" >&2; exit 2 ;; esac

cd "$(dirname "$0")/.."
OUT="src-tauri/target/mas"
rm -rf "$OUT"
mkdir -p "$OUT"

sed "s/TEAM_ID/$APPLE_TEAM_ID/g" src-tauri/Entitlements.appstore.plist >"$OUT/Entitlements.plist"
# Every App Store upload needs a higher CFBundleVersion than the last one.
BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
printf '{"bundle":{"macOS":{"entitlements":"%s","bundleVersion":"%s"}}}' \
  "$PWD/$OUT/Entitlements.plist" "$BUILD_NUMBER" >"$OUT/build.conf.json"

pnpm tauri build --target universal-apple-darwin \
  --config src-tauri/tauri.appstore.conf.json --config "$OUT/build.conf.json"

APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/KeyKeyKey.app"
INFO="$APP/Contents/Info.plist"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO")
BUILD=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO")

ARCHIVE="$OUT/KeyKeyKey.xcarchive"
mkdir -p "$ARCHIVE/Products/Applications"
ditto "$APP" "$ARCHIVE/Products/Applications/KeyKeyKey.app"
cat >"$ARCHIVE/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ApplicationProperties</key>
  <dict>
    <key>ApplicationPath</key><string>Applications/KeyKeyKey.app</string>
    <key>Architectures</key><array><string>arm64</string><string>x86_64</string></array>
    <key>CFBundleIdentifier</key><string>com.keykeykey.app</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key><string>$BUILD</string>
    <key>Team</key><string>$APPLE_TEAM_ID</string>
  </dict>
  <key>ArchiveVersion</key><integer>2</integer>
  <key>CreationDate</key><date>$(date -u +%Y-%m-%dT%H:%M:%SZ)</date>
  <key>Name</key><string>KeyKeyKey</string>
  <key>SchemeName</key><string>KeyKeyKey</string>
</dict>
</plist>
EOF

cat >"$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
</dict>
</plist>
EOF

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates
echo "Done: $OUT/export"
