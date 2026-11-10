// Copies the saved project files (../Recovered/*.json, the app's current projects) into public/projects with an index.json, so the hosted
// site (no auto-save helper) can list and open them. Skipped quietly when ../Projects does not exist.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Your newest autosaves (../Recovered) when they exist; otherwise the example projects kept in the repo, so builds
// that only have the repo (GitHub deploys) still publish them.
const recovered = path.resolve(root, "..", "Recovered");
const source = fs.existsSync(recovered) ? recovered : path.join(root, "example-projects");
const target = path.join(root, "public", "projects");

if (!fs.existsSync(source)) {
  console.log("[publish-projects] no ../Recovered or example-projects folder, skipping");
  process.exit(0);
}
fs.rmSync(target, { force: true, recursive: true });
fs.mkdirSync(target, { recursive: true });
const items = [];
for (const name of fs.readdirSync(source).filter((n) => n.endsWith(".json")).sort()) {
  const stat = fs.statSync(path.join(source, name));
  fs.copyFileSync(path.join(source, name), path.join(target, name));
  items.push({ modified: Math.round(stat.mtimeMs), name, size: stat.size });
}
items.sort((a, b) => b.modified - a.modified);
fs.writeFileSync(path.join(target, "index.json"), JSON.stringify({ items }));
console.log(`[publish-projects] ${items.length} projects copied to public/projects`);
