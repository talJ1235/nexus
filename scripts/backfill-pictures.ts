// One-off (Round 11 D1): re-normalize every stored product picture to the one-catalogue look, in batches, until none
// is left. Needs the production env (TURSO_* + BLOB_READ_WRITE_TOKEN), e.g. after `vercel env pull .env.prod`:
//   node --env-file=.env.prod node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/backfill-pictures.ts
// The daily cron does the same in small batches, so running this is optional.
import { normalizeOldPictures } from "../src/lib/picture-backfill";

async function main() {
  let total = 0;
  for (let round = 1; round <= 200; round++) {
    const r = await normalizeOldPictures(60_000, 25);
    if ("skipped" in r) return console.log("SKIP no BLOB_READ_WRITE_TOKEN — nothing to write pictures to");
    total += r.done;
    console.log(`round ${round}: ${r.done}/${r.tried} normalized, ${r.left} left`);
    if (!r.tried || !r.left || !r.done) break;
  }
  console.log(`OK ${total} pictures normalized`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
