// Self-host scanic's optional ML detector (model + ONNX Runtime WASM, ~3.4 MB) under /scanic-ml/ instead of loading
// it from a CDN at runtime (Round 8 A2). Runs before dev/build; the copy is git-ignored.
import { cpSync, existsSync, mkdirSync } from "node:fs";

const src = "node_modules/scanic-ml/dist";
const dst = "public/scanic-ml";
if (!existsSync(src)) {
  console.warn("scanic-ml not installed — the ML receipt detector stays off");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
