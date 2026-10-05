// Guard: every field Better Auth (with our plugins) expects exists in src/db/auth-schema.ts.  npx tsx --conditions=react-server scripts/check-auth-schema.ts
import { getAuthTables } from "better-auth/db";
import { getTableColumns } from "drizzle-orm";
import { auth } from "../src/lib/auth/server";
import * as s from "../src/db/auth-schema";

const map: Record<string, Parameters<typeof getTableColumns>[0]> = { user: s.user, session: s.session, account: s.account, verification: s.verification, passkey: s.passkey, organization: s.space, member: s.member, invitation: s.invitation, rateLimit: s.authRateLimit };
let bad = 0;
for (const [model, t] of Object.entries(getAuthTables(auth.options))) {
  const table = map[t.modelName] ?? map[model];
  if (!table) { console.log(`MISSING table for model ${model}`); bad++; continue; }
  const cols = getTableColumns(table);
  for (const [field, attr] of Object.entries(t.fields)) {
    const key = (attr as { fieldName?: string }).fieldName ?? field;
    if (!(key in cols)) { console.log(`MISSING ${model}.${key}`); bad++; }
  }
}
console.log(bad ? `FAIL ${bad}` : "OK auth schema covers every Better Auth field");
process.exit(bad ? 1 : 0);
