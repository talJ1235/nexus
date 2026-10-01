#!/usr/bin/env bash
# Packs extension/ into public/nexus-extension.zip (a folder named nexus-extension inside).
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
cp -r extension "$tmp/nexus-extension"
rm -f public/nexus-extension.zip
if command -v zip >/dev/null; then
  (cd "$tmp" && zip -qr -X "$OLDPWD/public/nexus-extension.zip" nexus-extension)
else
  # Windows Git Bash has no zip: use jszip (already installed via exceljs).
  node -e '
    const fs = require("fs"), path = require("path"), JSZip = require("jszip");
    const [src, out] = process.argv.slice(1), zip = new JSZip();
    const add = (dir, rel) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f), r = rel + "/" + f;
      fs.statSync(p).isDirectory() ? add(p, r) : zip.file(r, fs.readFileSync(p), { date: new Date("1980-01-02T00:00:00Z") }); } };
    add(src, "nexus-extension");
    zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }).then((b) => fs.writeFileSync(out, b));
  ' "$tmp/nexus-extension" public/nexus-extension.zip
fi
rm -rf "$tmp"
echo "packed public/nexus-extension.zip"
