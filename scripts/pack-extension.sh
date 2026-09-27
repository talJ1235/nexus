#!/usr/bin/env bash
# Packs extension/ into public/nexus-extension.zip (a folder named nexus-extension inside).
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
cp -r extension "$tmp/nexus-extension"
rm -f public/nexus-extension.zip
(cd "$tmp" && zip -qr -X "$OLDPWD/public/nexus-extension.zip" nexus-extension)
rm -rf "$tmp"
echo "packed public/nexus-extension.zip"
