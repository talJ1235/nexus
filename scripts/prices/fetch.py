"""R19 B2 — download the chains' transparency files with the maintained scrapers (`il-supermarket-scraper`, pinned in
scripts/prices/requirements.txt); the Node side (scripts/prices/ingest.mts) parses them and writes the changes.

  python scripts/prices/fetch.py --out prices-dump [--chains RAMI_LEVY,SHUFERSAL] [--types Stores,PriceFull,PromoFull]
                                 [--stores 1,7] [--limit 40] [--since-hours 6] [--timeout 900]

--types: Stores · PriceFull · PromoFull (the nightly full files) · Price · Promo (the partial files published during the
day). --stores keeps only those store ids (per chain, `CHAIN:1,7` or plain ids for all). --since-hours keeps files
published in the last N hours (intraday runs). The scrapers remember what they already downloaded under --out/status,
so a cached --out makes every run incremental. Prints one JSON line per chain: files, MB, seconds, error.
"""
import argparse, asyncio, datetime as dt, json, os, re, sys, time

from il_supermarket_scarper.scrappers_factory import ScraperFactory
from il_supermarket_scarper.utils.files.file_output import DiskFileOutput

TYPES = {"Stores": "STORE_FILE", "PriceFull": "PRICE_FULL_FILE", "PromoFull": "PROMO_FULL_FILE", "Price": "PRICE_FILE", "Promo": "PROMO_FILE"}


def stores_for(arg, chain):
    if not arg:
        return [None]
    picked = []
    for part in arg.split(";"):
        if ":" in part:
            c, ids = part.split(":", 1)
            if c != chain:
                continue
        else:
            ids = part
        picked += [int(x) for x in ids.split(",") if x.strip()]
    return picked or None


async def fetch_chain(name, out, types, stores, limit, since_hours, timeout):
    cls = ScraperFactory.get(getattr(ScraperFactory, name))
    t0 = time.time()
    got, size = [], 0.0
    regex = None
    if since_hours:
        # Files carry their publish stamp in the name (…-YYYYMMDDHHMM…); keep today's / yesterday's dates, then filter.
        days = {(dt.datetime.utcnow() - dt.timedelta(hours=h)).strftime("%Y%m%d") for h in (0, since_hours)}
        regex = "|".join(days)

    async def run():
        nonlocal size
        for store in stores:
            scraper = cls(file_output=DiskFileOutput(storage_path=os.path.join(out, name)))
            async for r in scraper.scrape(limit=limit, files_types=[TYPES[t] for t in types], store_id=store, file_name_regex=regex):
                fn = getattr(r, "file_name", None)
                if fn:
                    got.append(fn)
                    p = os.path.join(out, name, fn)
                    if os.path.exists(p):
                        size += os.path.getsize(p)

    err = None
    try:
        await asyncio.wait_for(run(), timeout)
    except Exception as e:  # noqa: BLE001 — one chain failing never stops the others
        err = f"{type(e).__name__}: {str(e)[:160]}"
    return {"chain": name, "files": len(got), "mb": round(size / 1e6, 1), "s": round(time.time() - t0, 1), "error": err}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--chains")
    ap.add_argument("--types", default="Stores,PriceFull,PromoFull")
    ap.add_argument("--stores")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--since-hours", type=int)
    ap.add_argument("--timeout", type=int, default=900)
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    os.chdir(out)  # the scrapers' status / cookies live under the cwd
    chains = a.chains.split(",") if a.chains else ScraperFactory.all_listed_scrappers()
    types = [t for t in a.types.split(",") if t]
    bad = [t for t in types if t not in TYPES]
    if bad:
        sys.exit(f"unknown --types {bad}; use {list(TYPES)}")
    rows = []
    for name in chains:
        r = await fetch_chain(name, out, types, stores_for(a.stores, name), a.limit, a.since_hours, a.timeout)
        print(json.dumps(r, ensure_ascii=False), flush=True)
        rows.append(r)
    with open(os.path.join(out, "fetch-summary.json"), "w", encoding="utf8") as f:
        json.dump({"at": dt.datetime.utcnow().isoformat() + "Z", "types": types, "rows": rows}, f, ensure_ascii=False, indent=1)
    print(f"SUMMARY {sum(r['files'] for r in rows)} files, {round(sum(r['mb'] for r in rows), 1)} MB, failing: {', '.join(r['chain'] for r in rows if r['error']) or 'none'}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
