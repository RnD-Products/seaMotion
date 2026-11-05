#!/usr/bin/env node
// Starts the project auto-save helper next to the normal Toolcraft dev/preview server and
// stops it again when the server exits.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import spawn from "cross-spawn";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const helper = spawn(process.execPath, [join(scriptDir, "project-autosave.mjs")], { stdio: "inherit" });
const server = spawn(process.execPath, [join(scriptDir, "run-vite-on-free-port.mjs"), ...process.argv.slice(2)], {
  stdio: "inherit",
});

function stopHelper() {
  if (!helper.killed) helper.kill();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
  });
}
server.on("exit", (code, signal) => {
  stopHelper();
  process.exit(signal ? 1 : (code ?? 0));
});
process.on("exit", stopHelper);
