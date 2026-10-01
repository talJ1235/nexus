# Dev helper: insert a block of new dictionary groups right after `tagline` in en.ts / he.ts.
# Usage: python scripts/i18n-add.py en_block.ts he_block.ts
import sys, re
for path, block in (("src/lib/i18n/en.ts", sys.argv[1]), ("src/lib/i18n/he.ts", sys.argv[2])):
    s = open(path, encoding="utf-8").read()
    add = open(block, encoding="utf-8").read().rstrip() + "\n"
    m = re.search(r"\n  tagline: [^\n]*\n", s)
    s = s[: m.end()] + add + s[m.end():]
    open(path, "w", encoding="utf-8").write(s)
print("ok")
