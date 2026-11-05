// What a group layer has of its own: whether it clips what it holds, and the corner radii of that clip (top left, top right,
// bottom right, bottom left, in design units). Stored with the animation's values (`__groupStyle`: group id -> style); the
// drawing script draws a clipping group's layers together and cuts them to a rounded box around what they draw.
export const GROUP_STYLE_KEY = "__groupStyle";

export type Radii = readonly [number, number, number, number];
export type GroupStyle = Readonly<{ clip: boolean; radius: Radii }>;

export const NO_GROUP_STYLE: GroupStyle = Object.freeze({ clip: false, radius: Object.freeze([0, 0, 0, 0]) as Radii });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const radius = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.min(2000, Math.max(0, value)) : 0);

export function readGroupStyle(value: unknown): GroupStyle {
  if (!isRecord(value)) return NO_GROUP_STYLE;
  const list = Array.isArray(value.radius) ? value.radius : [];
  return { clip: value.clip === true, radius: [radius(list[0]), radius(list[1]), radius(list[2]), radius(list[3])] };
}

export function readGroupStyles(params: Readonly<Record<string, unknown>>): Readonly<Record<string, GroupStyle>> {
  const raw = params[GROUP_STYLE_KEY];
  if (!isRecord(raw)) return {};
  const out: Record<string, GroupStyle> = {};
  for (const [id, value] of Object.entries(raw)) out[id] = readGroupStyle(value);
  return out;
}
