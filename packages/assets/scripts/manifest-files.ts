// ADR-138: every manifest*.json in the repo (art pack + assets/), skipping node_modules/dist/.git and vitest scratch dirs.
import { readdirSync } from "node:fs"; import { join } from "node:path";
const SKIP = new Set(["node_modules", ".git", "dist", "dummy-non-existing-folder", "src"]);
export function manifestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(join(d, e.name)); }
    else if (/^manifest.*\.json$/.test(e.name)) out.push(join(d, e.name));
  } };
  for (const sub of ["packages/assets", "assets"]) walk(join(root, sub));
  return out.sort();
}
