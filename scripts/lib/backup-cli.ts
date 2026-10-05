// Helper for scripts/db-restore-test.mjs: runs the app's own backup code against TURSO_DATABASE_URL.
//   tsx --conditions=react-server scripts/lib/backup-cli.ts dump <out.json>
//   tsx --conditions=react-server scripts/lib/backup-cli.ts restore <in.json>
import { readFileSync, writeFileSync } from "node:fs";
import { buildBackup, restoreBackup } from "../../src/lib/backup";

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === "dump") {
    const b = await buildBackup();
    writeFileSync(file, JSON.stringify(b));
    const counts = Object.fromEntries(Object.entries(b.data).map(([k, v]) => [k, (v as unknown[]).length]));
    console.log(JSON.stringify(counts));
  } else if (cmd === "restore") {
    const counts = await restoreBackup(JSON.parse(readFileSync(file, "utf8")), "replace");
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
