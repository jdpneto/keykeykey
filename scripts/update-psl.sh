#!/usr/bin/env bash
#
# Refresh the vendored Mozilla Public Suffix List consumed by the iOS
# credential-provider appex. The CI staleness check fails PRs if this file
# is >180 days old, so run this quarterly.
#
# Usage: scripts/update-psl.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$REPO_ROOT/apps/mobile/targets/credential-provider/public_suffix_list.dat"
URL="https://publicsuffix.org/list/public_suffix_list.dat"

echo "Fetching $URL …"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP"

# Sanity check — must contain the ICANN / PRIVATE section markers.
if ! grep -q "===BEGIN ICANN DOMAINS===" "$TMP"; then
  echo "error: downloaded file missing ICANN DOMAINS marker — upstream format changed?" >&2
  exit 1
fi

mv "$TMP" "$TARGET"
LINES=$(wc -l < "$TARGET" | tr -d ' ')
echo "Wrote $TARGET ($LINES lines)"
