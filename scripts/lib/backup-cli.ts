// Helper for scripts/db-restore-test.mjs: runs the app's own backup code against TURSO_DATABASE_URL, in the first
// personal space of that DB (the admin's after the R15 migration).
//   tsx --conditions=react-server scripts/lib/backup-cli.ts dump <out.json>
//   tsx --conditions=react-server scripts/lib/backup-cli.ts restore <in.json>
import { readFileSync, writeFileSync } from "node:fs";
import { Scoped } from "../../src/lib/db-scoped";
import { buildBackup, restoreBackup } from "../../src/lib/db-scoped/backup";
import { systemSpaces } from "../../src/lib/db-scoped/system";

async function main() {
  const [cmd, file] = process.argv.slice(2);
  const [sp] = await systemSpaces();
  if (!sp) throw new Error("no space in this DB (run the migration with ADMIN_EMAIL set)");
  const s = new Scoped({ spaceId: sp.id, userId: sp.ownerId });
  if (cmd === "dump") {
    const b = await buildBackup(s);
    writeFileSync(file, JSON.stringify(b));
    const counts = Object.fromEntries(Object.entries(b.data).map(([k, v]) => [k, (v as unknown[]).length]));
    console.log(JSON.stringify(counts));
  } else if (cmd === "restore") {
    const counts = await restoreBackup(s, JSON.parse(readFileSync(file, "utf8")), "replace");
    console.log(JSON.stringify(counts));
  } else throw new Error("usage: dump|restore <file>");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
