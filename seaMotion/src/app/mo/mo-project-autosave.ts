// The auto-save helper (scripts/project-autosave.mjs) runs next to the dev server and writes the
// posted project into one fixed folder. Browsers cannot write to a chosen path by themselves.
const AUTOSAVE_URL = "http://127.0.0.1:3011";

export type GithubAutosaveInfo = Readonly<{
  branch: string | null;
  enabled: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  state: "error" | "off" | "synced" | "syncing" | "waiting";
}>;

export type AutosaveInfo = Readonly<{ dir: string; dirMissing: boolean; github: GithubAutosaveInfo | null }>;

// Resolves with the folder the helper saves to, or rejects when the helper is not running.
export async function pingProjectAutosave(): Promise<AutosaveInfo> {
  const response = await fetch(`${AUTOSAVE_URL}/ping`);
  if (!response.ok) throw new Error("Auto-save helper unavailable.");
  const body = (await response.json()) as { dir?: unknown; dirMissing?: unknown; github?: unknown };
  if (typeof body.dir !== "string") throw new Error("Auto-save helper unavailable.");
  const raw = typeof body.github === "object" && body.github !== null ? (body.github as Record<string, unknown>) : null;
  const state = raw?.state;
  const github =
    raw && typeof raw.enabled === "boolean" && ["error", "off", "synced", "syncing", "waiting"].includes(String(state))
      ? {
          branch: typeof raw.branch === "string" ? raw.branch : null,
          enabled: raw.enabled,
          error: typeof raw.error === "string" ? raw.error : null,
          lastSyncedAt: typeof raw.lastSyncedAt === "number" ? raw.lastSyncedAt : null,
          state: state as GithubAutosaveInfo["state"],
        }
      : null;
  return { dir: body.dir, dirMissing: body.dirMissing === true, github };
}

export async function saveProjectToAutosave(name: string, data: unknown): Promise<void> {
  const response = await fetch(`${AUTOSAVE_URL}/save?name=${encodeURIComponent(name)}`, {
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Could not save the project.");
}

export type SavedProjectFile = Readonly<{ modified: number; name: string; size: number }>;

// The project files in the auto-save folder, newest first.
export async function listSavedProjects(source: "projects" | "recovered" = "projects"): Promise<readonly SavedProjectFile[]> {
  let response: Response | null = null;
  try {
    response = await fetch(`${AUTOSAVE_URL}/list${source === "recovered" ? "?dir=recovered" : ""}`);
  } catch {
    response = null;
  }
  // Hosted site (no helper): the projects published with the build (scripts/publish-projects.mjs).
  if (!response?.ok) response = await fetch("/projects/index.json");
  if (!response?.ok) throw new Error("Auto-save helper unavailable.");
  const body = (await response.json()) as { items?: unknown };
  if (!Array.isArray(body.items)) return [];
  return body.items.filter(
    (item): item is SavedProjectFile =>
      typeof item === "object" && item !== null && typeof (item as SavedProjectFile).name === "string",
  );
}

export async function readSavedProject(name: string, source: "projects" | "recovered" = "projects"): Promise<string> {
  let response: Response | null = null;
  try {
    response = await fetch(`${AUTOSAVE_URL}/file?name=${encodeURIComponent(name)}${source === "recovered" ? "&dir=recovered" : ""}`);
  } catch {
    response = null;
  }
  if (!response?.ok) {
    const published = await fetch(`/projects/${encodeURIComponent(name)}`);
    if (!published.ok) throw new Error("Could not read that saved project.");
    return published.text();
  }
  if (!response?.ok) throw new Error("Could not read that saved project.");
  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") throw new Error("Could not read that saved project.");
  return body.text;
}

// Removes one saved project file from the auto-save folder.
export async function deleteSavedProject(name: string): Promise<void> {
  const response = await fetch(`${AUTOSAVE_URL}/delete?name=${encodeURIComponent(name)}`, { method: "POST" });
  if (!response.ok) throw new Error("Could not delete that saved project.");
}

// Points the helper at another folder; the saved projects listed afterwards are the ones in it.
export async function setProjectAutosaveDir(path: string): Promise<string> {
  const response = await fetch(`${AUTOSAVE_URL}/dir`, {
    body: JSON.stringify({ path }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({}))) as { dir?: unknown; error?: unknown };
  if (!response.ok || typeof body.dir !== "string") throw new Error(typeof body.error === "string" ? body.error : "Could not use that folder.");
  return body.dir;
}

// Opens the system folder picker (macOS) through the helper; null when it was cancelled.
export async function chooseProjectAutosaveDir(): Promise<string | null> {
  const response = await fetch(`${AUTOSAVE_URL}/choose-dir`, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { cancelled?: unknown; error?: unknown; path?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not open the folder picker.");
  return typeof body.path === "string" && body.path ? body.path : null;
}

// "/Users/me/Documents/seaMotion/Recovered" -> "~/Documents/seaMotion/Recovered".
export function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

// The agent channel (see scripts/mo-agent.mjs): what an agent working on a project is doing, and an update it has
// ready for the open project.
export type AgentStatus = Readonly<{ at: number; message: string; percent: number; project: string }>;
export type AgentUpdateInfo = Readonly<{ id: string | null; project: string | null; version: string | null }>;

export async function readAgentChannel(): Promise<{ status: AgentStatus | null; update: AgentUpdateInfo | null }> {
  const response = await fetch(`${AUTOSAVE_URL}/agent`);
  if (!response.ok) throw new Error("Agent channel unavailable.");
  const body = (await response.json()) as { status?: unknown; update?: unknown };
  const status = body.status as Partial<AgentStatus> | null | undefined;
  const update = body.update as Partial<AgentUpdateInfo> | null | undefined;
  return {
    status:
      status && typeof status.project === "string" && typeof status.percent === "number"
        ? { at: typeof status.at === "number" ? status.at : 0, message: typeof status.message === "string" ? status.message : "", percent: status.percent, project: status.project }
        : null,
    update: update && typeof update.id === "string" ? { id: update.id, project: typeof update.project === "string" ? update.project : null, version: typeof update.version === "string" ? update.version : null } : null,
  };
}

export async function readAgentUpdate(): Promise<string> {
  const response = await fetch(`${AUTOSAVE_URL}/agent/update`);
  if (!response.ok) throw new Error("No agent update.");
  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") throw new Error("No agent update.");
  return body.text;
}

export async function finishAgentUpdate(id: string): Promise<void> {
  await fetch(`${AUTOSAVE_URL}/agent/done?id=${encodeURIComponent(id)}`, { method: "POST" });
}
