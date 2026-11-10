#!/usr/bin/env node
// For agents working on the open seaMotion project (see docs/mo-app/agent-motion-guide.md, "Agent channel").
//   node scripts/mo-agent.mjs status "<project name>" <percent> "<what you are doing>"
//   node scripts/mo-agent.mjs apply <update.json>      the new animation / settings; the app applies it in place and
//                                                     saves it as a new version ("version" in the file, else v_NN)
//   node scripts/mo-agent.mjs clear                   removes a status or update that is no longer wanted
// The app (with npm run dev running) shows the status over the artboard and picks the update up within a second.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".mo-app", "agent");
const [command, ...args] = process.argv.slice(2);

async function put(name, data) {
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, name);
  await writeFile(`${file}.tmp`, JSON.stringify(data));
  await rename(`${file}.tmp`, file);
}

if (command === "status") {
  const [project, percent, ...message] = args;
  if (!project) throw new Error('Usage: status "<project>" <percent> "<message>"');
  await put("status.json", { at: Date.now(), message: message.join(" "), percent: Math.max(0, Math.min(100, Number(percent) || 0)), project });
  console.log(`status: ${project} ${percent}% ${message.join(" ")}`);
} else if (command === "apply") {
  const data = JSON.parse(await readFile(args[0], "utf8"));
  if (!data.project) throw new Error("The update needs a project (the open project's name).");
  data.id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await put("update.json", data);
  console.log(`update ${data.id} for ${data.project} is waiting for the app`);
} else if (command === "clear") {
  await rm(path.join(DIR, "status.json"), { force: true });
  await rm(path.join(DIR, "update.json"), { force: true });
  console.log("cleared");
} else {
  console.log("commands: status, apply, clear");
}
