// R17 rehearsal helper: B1's short-name backfill on TURSO_DATABASE_URL (a copy), rules only (no AI), every space,
// until nothing is left. Prints counts as JSON.  tsx --conditions=react-server scripts/lib/backfill-cli.ts
import { Scoped } from "../../src/lib/db-scoped";
import { backfillShortNames } from "../../src/lib/db-scoped/short-names";
import { systemSpaces } from "../../src/lib/db-scoped/system";

async function main() {
  const total = { changed: 0, skipped: 0, viaAi: 0, spaces: 0 };
  for (const sp of await systemSpaces()) {
    total.spaces++;
    const s = new Scoped({ spaceId: sp.id, userId: sp.ownerId, by: "system" });
    for (let round = 0; round < 50; round++) {
      const r = await backfillShortNames(s, { left: 10_000 }, 50, async () => null);
      total.changed += r.changed;
      total.skipped += r.skipped;
      if (!r.changed) break;
    }
  }
  console.log(JSON.stringify(total));
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
