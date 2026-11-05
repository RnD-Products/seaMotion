// Presets kept for every project, by the auto-save helper (~/Documents/Mo_App/Presets/<kind>/<name>.json).
const AUTOSAVE_URL = "http://127.0.0.1:3011";

export type Preset = Readonly<{ name: string; savedAt: number; values: Readonly<Record<string, unknown>> }>;

export async function listPresets(kind: string): Promise<readonly Preset[] | null> {
  try {
    const response = await fetch(`${AUTOSAVE_URL}/presets?kind=${encodeURIComponent(kind)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: readonly Preset[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return null;
  }
}

export async function savePreset(kind: string, name: string, values: Readonly<Record<string, unknown>>): Promise<boolean> {
  try {
    const response = await fetch(`${AUTOSAVE_URL}/presets/save?kind=${encodeURIComponent(kind)}`, {
      body: JSON.stringify({ name, values }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deletePreset(kind: string, name: string): Promise<boolean> {
  try {
    const response = await fetch(`${AUTOSAVE_URL}/presets/delete?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}
