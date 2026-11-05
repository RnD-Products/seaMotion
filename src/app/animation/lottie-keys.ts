// The keyframes of a Lottie animation, for the timeline: per layer and per property, the seconds each keyframe sits at.
export type LottieKeyProperty = Readonly<{ label: string; times: readonly number[] }>;
export type LottieKeyLayer = Readonly<{ id: string; name: string; properties: readonly LottieKeyProperty[] }>;

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// The keyframe frames of a Lottie property ({ a: 1, k: [{ t, ... }] }); empty when the property does not move.
function framesOf(property: unknown): number[] {
  if (!isRecord(property) || property.a !== 1 || !Array.isArray(property.k)) return [];
  const frames: number[] = [];
  for (const key of property.k) if (isRecord(key) && typeof key.t === "number") frames.push(key.t);
  return frames;
}

const PROPERTIES: readonly (readonly [string, string])[] = [
  ["p", "Position"],
  ["r", "Rotation"],
  ["s", "Scale"],
  ["o", "Opacity"],
  ["a", "Anchor"],
  ["sk", "Skew"],
];

export function lottieKeyLayers(data: Readonly<Record<string, unknown>> | undefined): LottieKeyLayer[] {
  if (!data || !Array.isArray(data.layers) || typeof data.fr !== "number" || data.fr <= 0) return [];
  const fps = data.fr;
  const start = typeof data.ip === "number" ? data.ip : 0;
  // A property baked with a key on every frame would be a wall of diamonds: only about every 0.25 s of them show (the first and the last always).
  const seconds = (frames: readonly number[]): number[] => {
    const all = [...new Set(frames.map((frame) => Math.round(((frame - start) / fps) * 1000) / 1000))].sort((a, b) => a - b);
    if (all.length <= 48) return all;
    const out: number[] = [];
    for (const time of all) if (out.length === 0 || time - (out[out.length - 1] as number) >= 0.25 - 1e-6) out.push(time);
    const last = all[all.length - 1] as number;
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  };
  const out: LottieKeyLayer[] = [];
  data.layers.forEach((layer, index) => {
    if (!isRecord(layer) || !isRecord(layer.ks)) return;
    const ind = typeof layer.ind === "number" ? layer.ind : index;
    const properties: LottieKeyProperty[] = [];
    for (const [key, label] of PROPERTIES) {
      const property = layer.ks[key];
      // A position split into X and Y has a property each.
      if (key === "p" && isRecord(property) && property.s === true) {
        for (const [axis, name] of [["x", "X"], ["y", "Y"]] as const) {
          const times = seconds(framesOf(property[axis]));
          if (times.length > 0) properties.push({ label: `${label} ${name}`, times });
        }
        continue;
      }
      const times = seconds(framesOf(property));
      if (times.length > 0) properties.push({ label, times });
    }
    if (properties.length > 0) out.push({ id: `lottie-${ind}`, name: typeof layer.nm === "string" && layer.nm.trim() !== "" ? layer.nm : `Layer ${index + 1}`, properties });
  });
  return out;
}
