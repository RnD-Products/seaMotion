// The size of a layer or group: a scale for across and down (percent of its own size) and whether the two stay together. Kept as a
// setting (`__layerSize`: layer id -> { lock, sx, sy }); the drawing script scales the box around what it draws from that box's
// top-left corner, picture after picture.
export const LAYER_SIZE_KEY = "__layerSize";

export type LayerSize = Readonly<{ lock: boolean; rot: number; sx: number; sy: number; x: number; y: number }>;
export const NO_SIZE: LayerSize = Object.freeze({ lock: true, rot: 0, sx: 100, sy: 100, x: 0, y: 0 });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const move = (value: unknown, limit: number): number => (typeof value === "number" && Number.isFinite(value) ? Math.min(limit, Math.max(-limit, value)) : 0);
const percent = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.min(2000, Math.max(1, value)) : 100);

export function readLayerSize(value: unknown): LayerSize {
  if (!isRecord(value)) return NO_SIZE;
  return { lock: value.lock !== false, rot: move(value.rot, 360), sx: percent(value.sx), sy: percent(value.sy), x: move(value.x, 20000), y: move(value.y, 20000) };
}

export function readLayerSizes(params: Readonly<Record<string, unknown>>): Readonly<Record<string, LayerSize>> {
  const raw = params[LAYER_SIZE_KEY];
  if (!isRecord(raw)) return {};
  const out: Record<string, LayerSize> = {};
  for (const [id, value] of Object.entries(raw)) out[id] = readLayerSize(value);
  return out;
}

export const isUnscaled = (size: LayerSize): boolean => size.sx === 100 && size.sy === 100 && size.x === 0 && size.y === 0 && size.rot === 0;
