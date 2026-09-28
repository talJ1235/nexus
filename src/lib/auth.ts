import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "./session";

/** Throws unless the request carries the owner's session cookie. */
export async function assertOwner() {
  const jar = await cookies();
  if (!(await verifySessionValue(jar.get(SESSION_COOKIE)?.value))) throw new Error("unauthorized");
}
