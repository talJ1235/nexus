"""R19 B0 — which chains' transparency portals answer from here, and what they publish.

Lists every active chain's files with the maintained OpenIsraeliSupermarkets scrapers (`il-supermarket-scraper`,
pinned in scripts/prices/requirements.txt) — no file is downloaded for the listing — then downloads one Stores file
per chain to prove the files themselves come through. Prints one JSON line per chain and a summary table.

  python scripts/prices/probe.py [--out probe.json] [--chains SHUFERSAL,RAMI_LEVY] [--timeout 120] [--no-download]
"""
import argparse, asyncio, json, os, re, sys, tempfile, time
from collections import Counter

from il_supermarket_scarper.scrappers_factory import ScraperFactory
from il_supermarket_scarper.utils.scraping.state import FilterState
from il_supermarket_scarper.utils.files.file_output import DiskFileOutput

# Chains name their files differently: Price7290027600007-001-001-20261019-160000.gz (Shufersal: chain-sub-store-date-time),
# PriceFull7290058140886-001-202610190300.xml, Stores7290027600007-000-202610190201 … — kind first, the date last.
NAME = re.compile(r"^(pricefull|promofull|price|promo|storesfull|stores?)(\d{13})[-_](?:(\d{1,4})[-_])?(\d{1,4})[-_](\d{8})[-_]?(\d{4,6})?", re.I)
KIND = {"pricefull": "PriceFull", "promofull": "PromoFull", "price": "Price", "promo": "Promo", "stores": "Stores", "store": "Stores", "storesfull": "Stores"}


def parse_name(n):
    m = NAME.match(os.path.basename(n or ""))
    if not m:
        return None
    kind, _chain, a, b, day, hm = m.groups()
    store = int(b if a is not None else b)
    return KIND[kind.lower()], store, day + (hm or "")[:4]


def make(name):
    # 1.0.15's default output (no file_output) looks the folder up by the enum member and raises — pass one.
    cls = ScraperFactory.get(getattr(ScraperFactory, name))
    return cls(file_output=DiskFileOutput(storage_path=os.path.join(os.getcwd(), "dumps", name)))


async def list_chain(name, timeout):
    """Every file the portal lists (names + sizes, nothing downloaded); stops at the timeout and says it's partial."""
    scraper = make(name)
    kinds, stores, newest, sizes, other = Counter(), set(), {}, Counter(), []
    t0 = time.time()
    partial = False

    async def run():
        async for d in scraper.collect_files_details_from_site(FilterState(), files_types=None):
            n = getattr(d, "name", None) or (d.get("name") if isinstance(d, dict) else str(d))
            p = parse_name(n)
            if not p:
                if len(other) < 3:
                    other.append(str(n)[:80])
                continue
            k, store, stamp = p
            kinds[k] += 1
            sizes[k] += float(getattr(d, "size", 0) or 0)
            stores.add(store)
            if stamp > newest.get(k, ""):
                newest[k] = stamp

    try:
        await asyncio.wait_for(run(), timeout)
    except asyncio.TimeoutError:
        partial = True
    return {"files": dict(kinds), "stores": len(stores), "newest": newest, "mb": {k: round(v / 1e6, 1) for k, v in sizes.items()}, "unparsed": other, "partial": partial, "list_s": round(time.time() - t0, 1)}


async def one_stores_file(name, timeout):
    scraper = make(name)
    t0 = time.time()
    got = []

    async def run():
        async for r in scraper.scrape(limit=1, files_types=["STORE_FILE"]):
            got.append(getattr(r, "file_name", None) or str(r)[:120])

    await asyncio.wait_for(run(), timeout)
    return {"stores_file": got[0] if got else None, "download_s": round(time.time() - t0, 1)}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--chains")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--no-download", action="store_true")
    a = ap.parse_args()
    chains = a.chains.split(",") if a.chains else ScraperFactory.all_listed_scrappers()
    os.chdir(tempfile.mkdtemp(prefix="nexus-probe-"))  # the scrapers write their dumps / status under the cwd
    rows = []
    for name in chains:
        row = {"chain": name}
        try:
            row.update(await list_chain(name, a.timeout))
            row["ok"] = sum(row["files"].values()) > 0
        except Exception as e:  # noqa: BLE001 — a blocked / broken portal is a result, not a crash
            row.update({"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}"})
        if row.get("ok") and not a.no_download:
            try:
                row.update(await one_stores_file(name, a.timeout))
            except Exception as e:  # noqa: BLE001
                row["download_error"] = f"{type(e).__name__}: {str(e)[:160]}"
        print(json.dumps(row, ensure_ascii=False), flush=True)
        rows.append(row)
    ok = [r for r in rows if r.get("ok")]
    print(f"SUMMARY {len(ok)}/{len(rows)} chains list files; blocked or failing: {', '.join(r['chain'] for r in rows if not r.get('ok')) or 'none'}")
    if a.out:
        with open(a.out, "w", encoding="utf8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
