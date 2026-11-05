#!/usr/bin/env node
// Local helper for Mo_App: the app posts the open project here every few seconds and it
// is written as a .json file in one folder, so work is kept even when nothing was exported.
// It listens on 127.0.0.1 only and accepts requests only from pages served from localhost.
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const PORT = Number(process.env.PROJECT_AUTOSAVE_PORT ?? 3011);
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Where projects are saved: the folder chosen in the app (kept in ~/.mo-app/settings.json), else the
// PROJECT_AUTOSAVE_DIR setting, else ~/Documents/Mo_App/Recovered.
const SETTINGS_FILE = path.join(os.homedir(), ".mo-app", "settings.json");
const DEFAULT_DIR = path.join(os.homedir(), "Documents", "Mo_App", "Recovered");
function readSavedDir() {
  try {
    const saved = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")).projectDir;
    return typeof saved === "string" && path.isAbsolute(saved) ? saved : null;
  } catch {
    return null;
  }
}
let DIR = path.resolve(process.env.PROJECT_AUTOSAVE_DIR ?? readSavedDir() ?? DEFAULT_DIR);
// The 10 most recent projects are also copied to the Recovered folder next to the app folder, as a backup.
const RECOVERED_DIR = path.resolve(process.env.MO_APP_RECOVERED_DIR ?? path.join(APP_DIR, "..", "Recovered"));
const RECOVERED_COUNT = 10;
let recoveredTimer = null;
async function mirrorRecent() {
  if (path.resolve(DIR) === RECOVERED_DIR) return; // never prune the folder projects are saved in
  try {
    const recent = (await listProjects()).slice(0, RECOVERED_COUNT);
    await mkdir(RECOVERED_DIR, { recursive: true });
    const keep = new Set(recent.map((item) => item.name));
    for (const item of recent) {
      const target = path.join(RECOVERED_DIR, item.name);
      const have = await stat(target).catch(() => null);
      if (!have || have.mtimeMs < item.modified || have.size !== item.size) await copyFile(path.join(DIR, item.name), target);
    }
    for (const name of await readdir(RECOVERED_DIR)) {
      if (name.endsWith(".json") && !name.startsWith(".") && !keep.has(name)) await unlink(path.join(RECOVERED_DIR, name));
    }
  } catch (error) {
    console.error(`[autosave] Recovered copy failed: ${error instanceof Error ? error.message : error}`);
  }
}
function scheduleMirror() {
  if (recoveredTimer) clearTimeout(recoveredTimer);
  recoveredTimer = setTimeout(() => void mirrorRecent(), 2000);
}
const MAX_BYTES = 96 * 1024 * 1024;
const ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// Projects are kept in the chosen folder only; syncing the app's own Projects folder to GitHub is opt-in.
const GITHUB_SYNC_ENABLED = process.env.PROJECT_AUTOSAVE_GITHUB === "1";
const GITHUB_SYNC_DELAY_MS = Number(process.env.PROJECT_AUTOSAVE_GITHUB_DELAY_MS ?? 60_000);
const runProcess = promisify(execFile);
let githubTimer = null;
const githubSync = { branch: null, error: null, lastSyncedAt: null, state: GITHUB_SYNC_ENABLED ? "waiting" : "off" };

async function runGit(args) {
  return runProcess("git", ["-C", APP_DIR, ...args], { maxBuffer: 16 * 1024 * 1024 });
}

async function syncProjectsToGitHub() {
  if (!GITHUB_SYNC_ENABLED || githubSync.state === "syncing") return;
  githubSync.state = "syncing";
  githubSync.error = null;
  try {
    const branch = (await runGit(["branch", "--show-current"])).stdout.trim();
    if (!branch) throw new Error("No Git branch is checked out.");
    githubSync.branch = branch;
    await runGit(["add", "--", "Projects"]);
    const changed = (await runGit(["diff", "--cached", "--name-only", "--", "Projects"])).stdout.trim();
    if (changed) {
      const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
      await runGit(["commit", "--only", "-m", `chore: autosave app projects (${stamp})`, "--", "Projects"]);
      await runGit(["push", "origin", "HEAD"]);
    }
    githubSync.lastSyncedAt = Date.now();
    githubSync.state = "synced";
    console.log(`[autosave] GitHub synced Projects on ${branch}.`);
  } catch (error) {
    githubSync.error = error instanceof Error ? error.message.split("\n")[0] : "GitHub sync failed.";
    githubSync.state = "error";
    console.error(`[autosave] GitHub sync failed: ${githubSync.error}`);
  }
}

function scheduleGitHubSync() {
  if (!GITHUB_SYNC_ENABLED) return;
  if (githubTimer) clearTimeout(githubTimer);
  githubSync.state = "waiting";
  githubTimer = setTimeout(() => {
    githubTimer = null;
    void syncProjectsToGitHub();
  }, GITHUB_SYNC_DELAY_MS);
}

function safeName(raw) {
  const cleaned = String(raw ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80);
  return cleaned || "project";
}

function send(res, status, body, origin) {
  res.writeHead(status, {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin ?? "null",
    "Content-Type": "application/json",
    Vary: "Origin",
  });
  res.end(JSON.stringify(body));
}

// The saved project files in the folder, newest first.
async function listProjects(dir = DIR) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  const items = await Promise.all(
    names.map(async (name) => {
      const info = await stat(path.join(dir, name));
      return { modified: info.mtimeMs, name, size: info.size };
    }),
  );
  return items.sort((a, b) => b.modified - a.modified);
}

// The agent channel: while an agent works on the open project it writes status.json (percent and what it is doing)
// and, when done, update.json (the new animation and settings). The app shows the status over the artboard, applies
// the update to the open project in place and saves it as a new version, then clears both. Kept outside the project
// folder so it never shows in Open project.
const AGENT_DIR = path.join(os.homedir(), ".mo-app", "agent");
async function readAgentFile(name) {
  try {
    return JSON.parse(await readFile(path.join(AGENT_DIR, name), "utf8"));
  } catch {
    return null;
  }
}

// The app's saved fonts: font files you added for a design whose font was missing, kept for every project, so a
// design that needs the same font later gets it without asking again. An index lists each file's family and style.
const FONTS_DIR = path.resolve(process.env.MO_APP_FONTS_DIR ?? path.join(os.homedir(), "Documents", "Mo_App", "Fonts"));
const FONTS_INDEX = path.join(FONTS_DIR, "fonts.json");
const FONT_TYPES = { otf: "font/otf", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2" };
async function readFontIndex() {
  try {
    const items = JSON.parse(await readFile(FONTS_INDEX, "utf8"));
    return Array.isArray(items) ? items.filter((item) => item && typeof item.file === "string" && existsSync(path.join(FONTS_DIR, item.file))) : [];
  } catch {
    return [];
  }
}

// Font files put into the Fonts folder by hand (not through the app) are not in the index: their family and style come from the
// font's own name table (ttf/otf), or from the file name ("Geist Light.ttf", "Inter-Bold.otf") when that cannot be read.
const STYLE_WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
function readNameTable(bytes) {
  try {
    let base = 0;
    if (bytes.toString("latin1", 0, 4) === "ttcf") base = bytes.readUInt32BE(12);
    const tables = bytes.readUInt16BE(base + 4);
    for (let i = 0; i < tables; i += 1) {
      const at = base + 12 + i * 16;
      if (bytes.toString("latin1", at, at + 4) !== "name") continue;
      const offset = bytes.readUInt32BE(at + 8);
      const count = bytes.readUInt16BE(offset + 2);
      const strings = offset + bytes.readUInt16BE(offset + 4);
      const names = {};
      for (let n = 0; n < count; n += 1) {
        const rec = offset + 6 + n * 12;
        const platform = bytes.readUInt16BE(rec);
        const id = bytes.readUInt16BE(rec + 6);
        const length = bytes.readUInt16BE(rec + 8);
        const start = strings + bytes.readUInt16BE(rec + 10);
        const raw = bytes.subarray(start, start + length);
        const text = platform === 1 ? raw.toString("latin1") : Buffer.from(raw).swap16().toString("utf16le");
        if (!names[id] || platform !== 1) names[id] = text;
      }
      const family = names[16] || names[1];
      const style = names[17] || names[2];
      return family && style ? { family, style } : null;
    }
  } catch {
    // Not a readable font; the file name decides.
  }
  return null;
}
async function scanFontFolder(known) {
  let names = [];
  try {
    names = await readdir(FONTS_DIR);
  } catch {
    return [];
  }
  const found = [];
  for (const file of names) {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    if (!FONT_TYPES[ext] || file.startsWith(".") || known.has(file)) continue;
    let named = null;
    if (ext === "ttf" || ext === "otf") named = readNameTable(await readFile(path.join(FONTS_DIR, file)).catch(() => Buffer.alloc(0)));
    if (!named) {
      const stem = file.slice(0, -(ext.length + 1)).replace(/[_]+/g, " ");
      const parts = stem.split(/[-\s]+/).filter(Boolean);
      const last = parts.length > 1 ? parts[parts.length - 1] : "";
      const style = last && STYLE_WEIGHTS[last.toLowerCase().replace(/italic$/, "") || "regular"] ? last : "Regular";
      named = { family: (style === last ? parts.slice(0, -1) : parts).join(" ") || stem, style };
    }
    const lower = named.style.toLowerCase();
    const weight = STYLE_WEIGHTS[lower.replace(/\s*(italic|oblique)$/, "").replace(/\s+/g, "") || "regular"] ?? 400;
    found.push({ family: named.family, file, italic: /italic|oblique/.test(lower), style: named.style, weight });
  }
  return found;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Presets (the sticky settings, and others later) are kept for every project in one folder next to the projects and the fonts:
// ~/Documents/Mo_App/Presets/<kind>/<name>.json, each file { name, values }.
const PRESETS_DIR = path.resolve(process.env.MO_APP_PRESETS_DIR ?? path.join(os.homedir(), "Documents", "Mo_App", "Presets"));
const PRESET_KINDS = new Set(["sticky"]);
function presetDir(kind) {
  const clean = String(kind ?? "");
  if (!PRESET_KINDS.has(clean)) throw new Error("unknown preset kind");
  return path.join(PRESETS_DIR, clean);
}
async function readPresets(kind) {
  const dir = presetDir(kind);
  const names = existsSync(dir) ? (await readdir(dir)).filter((name) => name.endsWith(".json") && !name.startsWith(".")) : [];
  const items = [];
  for (const file of names) {
    try {
      const data = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      if (data && typeof data.name === "string" && data.values && typeof data.values === "object") {
        items.push({ name: data.name, savedAt: (await stat(path.join(dir, file))).mtimeMs, values: data.values });
      }
    } catch {
      // A file that is not a preset is left alone.
    }
  }
  return items.sort((a, b) => a.savedAt - b.savedAt);
}

const server = http.createServer((req, res) => {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin && !ORIGIN.test(origin)) {
    send(res, 403, { error: "origin not allowed" }, null);
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    send(res, 204, {}, origin);
    return;
  }
  if (req.method === "GET" && url.pathname === "/ping") {
    send(res, 200, { dir: DIR, dirMissing: !existsSync(DIR), github: { ...githubSync, enabled: GITHUB_SYNC_ENABLED }, ok: true }, origin);
    return;
  }
  if (req.method === "GET" && url.pathname === "/agent") {
    Promise.all([readAgentFile("status.json"), readAgentFile("update.json")]).then(([status, update]) =>
      send(res, 200, { status, update: update ? { id: update.id ?? null, project: update.project ?? null, version: update.version ?? null } : null }, origin),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/agent/update") {
    readFile(path.join(AGENT_DIR, "update.json"), "utf8").then(
      (text) => send(res, 200, { text }, origin),
      () => send(res, 404, { error: "no update" }, origin),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/agent/done") {
    const id = String(url.searchParams.get("id") ?? "");
    readAgentFile("update.json").then(async (update) => {
      if (update && String(update.id ?? "") !== id) {
        send(res, 409, { error: "a newer update is waiting" }, origin);
        return;
      }
      await unlink(path.join(AGENT_DIR, "update.json")).catch(() => undefined);
      await unlink(path.join(AGENT_DIR, "status.json")).catch(() => undefined);
      send(res, 200, { ok: true }, origin);
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/fonts") {
    readFontIndex().then(async (items) => {
      const extra = await scanFontFolder(new Set(items.map((item) => item.file)));
      send(res, 200, { dir: FONTS_DIR, items: [...items, ...extra] }, origin);
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/fonts/file") {
    const name = path.basename(String(url.searchParams.get("name") ?? ""));
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!FONT_TYPES[ext] || name.startsWith(".")) {
      send(res, 400, { error: "bad name" }, origin);
      return;
    }
    readFile(path.join(FONTS_DIR, name)).then(
      (bytes) => send(res, 200, { dataUrl: `data:${FONT_TYPES[ext]};base64,${bytes.toString("base64")}`, name }, origin),
      () => send(res, 404, { error: "not found" }, origin),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/fonts/save") {
    readBody(req).then(async (text) => {
      try {
        const body = JSON.parse(text);
        const family = String(body.family ?? "").trim();
        const style = String(body.style ?? "Regular").trim() || "Regular";
        const ext = String(body.fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
        const match = /^data:[^;]*;base64,(.*)$/s.exec(String(body.dataUrl ?? ""));
        if (!family || !FONT_TYPES[ext] || !match) throw new Error("Send a .ttf, .otf, .woff or .woff2 file with its family.");
        await mkdir(FONTS_DIR, { recursive: true });
        const file = `${safeName(family)} ${safeName(style)}.${ext}`;
        await writeFile(path.join(FONTS_DIR, file), Buffer.from(match[1], "base64"));
        const entry = { family, file, italic: body.italic === true, style, weight: Number(body.weight) || 400 };
        const items = (await readFontIndex()).filter((item) => !(item.family.toLowerCase() === family.toLowerCase() && item.style.toLowerCase() === style.toLowerCase()));
        items.push(entry);
        await writeFile(FONTS_INDEX, JSON.stringify(items, null, 2));
        console.log(`[autosave] Saved font ${family} ${style}`);
        send(res, 200, { item: entry, ok: true }, origin);
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : "bad request" }, origin);
      }
    }, () => send(res, 400, { error: "bad request" }, origin));
    return;
  }
  if (req.method === "GET" && url.pathname === "/presets") {
    readPresets(url.searchParams.get("kind")).then(
      (items) => send(res, 200, { dir: PRESETS_DIR, items }, origin),
      (error) => send(res, 400, { error: error instanceof Error ? error.message : "bad request" }, origin),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/presets/save") {
    readBody(req).then(async (text) => {
      try {
        const body = JSON.parse(text);
        const dir = presetDir(url.searchParams.get("kind"));
        const name = String(body.name ?? "").trim().slice(0, 60);
        if (!name || !body.values || typeof body.values !== "object") throw new Error("Send a name and the values.");
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, `${safeName(name)}.json`);
        await writeFile(`${file}.tmp`, JSON.stringify({ name, values: body.values }));
        await rename(`${file}.tmp`, file);
        console.log(`[autosave] Saved ${url.searchParams.get("kind")} preset ${name}`);
        send(res, 200, { ok: true }, origin);
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : "bad request" }, origin);
      }
    }, () => send(res, 400, { error: "bad request" }, origin));
    return;
  }
  if (req.method === "POST" && url.pathname === "/presets/delete") {
    try {
      const dir = presetDir(url.searchParams.get("kind"));
      const name = String(url.searchParams.get("name") ?? "").trim();
      unlink(path.join(dir, `${safeName(name)}.json`)).then(
        () => send(res, 200, { ok: true }, origin),
        () => send(res, 404, { error: "not found" }, origin),
      );
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : "bad request" }, origin);
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/list") {
    listProjects(url.searchParams.get("dir") === "recovered" ? RECOVERED_DIR : DIR).then(
      (items) => send(res, 200, { items }, origin),
      () => send(res, 200, { items: [] }, origin),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/dir") {
    readBody(req).then(async (text) => {
      try {
        const wanted = String(JSON.parse(text).path ?? "").trim().replace(/^~(?=$|\/)/, os.homedir());
        if (!path.isAbsolute(wanted)) throw new Error("Use a full folder path, like /Users/you/Documents/Projects.");
        const dir = path.resolve(wanted);
        await mkdir(dir, { recursive: true });
        await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
        await writeFile(SETTINGS_FILE, JSON.stringify({ projectDir: dir }, null, 2));
        DIR = dir;
        console.log(`[autosave] Saving projects to ${DIR}`);
        send(res, 200, { dir: DIR, ok: true }, origin);
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : "bad request" }, origin);
      }
    }, () => send(res, 400, { error: "bad request" }, origin));
    return;
  }
  if (req.method === "POST" && url.pathname === "/choose-dir") {
    if (process.platform !== "darwin") {
      send(res, 501, { error: "The folder picker is only available on macOS. Type the folder path instead." }, origin);
      return;
    }
    // The default location must exist, so walk up from the save folder to the nearest folder that does.
    let start = DIR;
    while (start !== path.dirname(start) && !existsSync(start)) start = path.dirname(start);
    const script = 'POSIX path of (choose folder with prompt "Choose where Mo_App saves projects" default location (POSIX file ' + JSON.stringify(start) + "))";
    runProcess("osascript", ["-e", script], { timeout: 300_000 }).then(
      ({ stdout }) => send(res, 200, { path: stdout.trim().replace(/\/$/, "") }, origin),
      (error) => {
        const message = String(error?.stderr ?? error?.message ?? error);
        if (/-128|cancel/i.test(message)) send(res, 200, { cancelled: true }, origin);
        else send(res, 500, { error: "Could not open the folder picker: " + message.trim().slice(0, 200) }, origin);
      },
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/file") {
    const name = path.basename(String(url.searchParams.get("name") ?? ""));
    if (!name.endsWith(".json") || name.startsWith(".")) {
      send(res, 400, { error: "bad name" }, origin);
      return;
    }
    readFile(path.join(url.searchParams.get("dir") === "recovered" ? RECOVERED_DIR : DIR, name), "utf8").then(
      (text) => send(res, 200, { name, text }, origin),
      () => send(res, 404, { error: "not found" }, origin),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/delete") {
    const name = path.basename(String(url.searchParams.get("name") ?? ""));
    if (!name.endsWith(".json") || name.startsWith(".")) {
      send(res, 400, { error: "bad name" }, origin);
      return;
    }
    unlink(path.join(DIR, name)).then(
      () => send(res, 200, { ok: true }, origin),
      () => send(res, 404, { error: "not found" }, origin),
    );
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/save") {
    send(res, 404, { error: "not found" }, origin);
    return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BYTES) {
      send(res, 413, { error: "too large" }, origin);
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    try {
      const text = Buffer.concat(chunks).toString("utf8");
      const data = JSON.parse(text);
      if (data?.format !== "mo-app-project") throw new Error("not a project file");
      await mkdir(DIR, { recursive: true });
      const file = path.join(DIR, `${safeName(url.searchParams.get("name") ?? data.name)}.json`);
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(data, null, 2));
      await rename(temp, file);
      scheduleGitHubSync();
      scheduleMirror();
      send(res, 200, { file, ok: true }, origin);
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : "bad request" }, origin);
    }
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`[autosave] Already running on port ${PORT}.`);
    process.exit(0);
  }
  throw error;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[autosave] Saving projects to ${DIR}; last ${RECOVERED_COUNT} copied to ${RECOVERED_DIR}`);
  scheduleGitHubSync();
  void mirrorRecent();
});
