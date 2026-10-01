// Validation for client diagnostics sent with help questions and problem reports (lib/client-diag.ts).
import { z } from "zod";

export const clientDiagSchema = z.object({
  view: z.string().max(60),
  device: z.enum(["phone", "desktop"]),
  viewport: z.string().max(20),
  palette: z.string().max(20),
  mode: z.enum(["light", "dark"]),
  locale: z.string().max(5),
  online: z.boolean(),
  extension: z.string().max(20).nullable(),
  version: z.string().max(40),
  errors: z
    .array(z.object({ at: z.number(), kind: z.enum(["error", "rejection", "toast"]), message: z.string().max(300), where: z.string().max(120).optional() }))
    .max(20),
});
