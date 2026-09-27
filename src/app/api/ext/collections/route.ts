import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyExtensionRequest } from "@/lib/ext-token";

export async function GET(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const collections = await db
    .select({ id: schema.collections.id, name: schema.collections.name, kind: schema.collections.kind })
    .from(schema.collections)
    .where(eq(schema.collections.archived, false))
    .orderBy(asc(schema.collections.sortOrder));
  return Response.json({ collections });
}
