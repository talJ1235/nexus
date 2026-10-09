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
  // Round 9 D1.
  nav: z.array(z.string().max(40)).max(10).optional(),
  viewCount: z.number().int().min(0).max(100_000).optional(),
  network: z.object({ type: z.string().max(10).optional(), saveData: z.boolean().optional() }).optional(),
  failed: z.array(z.object({ at: z.number(), path: z.string().max(80), status: z.number().int().min(0).max(999) })).max(10).optional(),
  sw: z.string().max(40).nullable().optional(),
  hw: z.object({ memory: z.number().max(1024).optional(), cores: z.number().int().max(512).optional() }).optional(),
  // R17 G5: installed (standalone display mode) or in a browser tab.
  standalone: z.boolean().optional(),
});
