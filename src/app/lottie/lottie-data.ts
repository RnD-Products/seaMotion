import type { LayerSpec } from "../animation/animation-spec";

// A Lottie animation (Bodymovin JSON) as it is stored in a Lottie Animation project (`spec.lottie`).
export type LottieData = Readonly<Record<string, unknown>>;

export type LottieInfo = Readonly<{
  durationSeconds: number;
  fps: number;
  frames: number;
  height: number;
  name: string;
  width: number;
}>;

export type LottieLayerStyle = Readonly<{ blend?: string; opacity?: number }>;

export type LottiePrepareOptions = Readonly<{
  // A solid colour layer added under everything (#RRGGBB), or null for a transparent animation.
  background: string | null;
  // Top-level layer ids (`lottie-<ind>`) to hide.
  hidden: readonly string[];
  // Per-layer blend and opacity from the Layer section, by layer id.
  styles: Readonly<Record<string, LottieLayerStyle>>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// A Bodymovin file: frame rate, in and out frames, size and a layer list.
export function isLottieData(value: unknown): value is LottieData {
  return (
    isRecord(value) &&
    isNumber(value.fr) &&
    value.fr > 0 &&
    isNumber(value.ip) &&
    isNumber(value.op) &&
    value.op > value.ip &&
    isNumber(value.w) &&
    value.w > 0 &&
    isNumber(value.h) &&
    value.h > 0 &&
    Array.isArray(value.layers)
  );
}

export function lottieInfo(data: LottieData): LottieInfo {
  const fps = data.fr as number;
  const frames = (data.op as number) - (data.ip as number);
  return {
    durationSeconds: frames / fps,
    fps,
    frames,
    height: data.h as number,
    name: typeof data.nm === "string" ? data.nm : "",
    width: data.w as number,
  };
}

// The id a top-level Lottie layer has in the Layers panel.
export function lottieLayerId(layer: unknown, index: number): string {
  const ind = isRecord(layer) && isNumber(layer.ind) ? layer.ind : index;
  return `lottie-${ind}`;
}

// The top-level layers, top first, as the project's design layers. Matte sources (td) are listed too.
export function lottieLayers(data: LottieData): LayerSpec[] {
  const layers = data.layers as unknown[];
  return layers.map((layer, index) => ({
    id: lottieLayerId(layer, index),
    name: isRecord(layer) && typeof layer.nm === "string" && layer.nm.trim() !== "" ? layer.nm : `Layer ${index + 1}`,
  }));
}

// The animation as it is drawn and exported: hidden layers switched off, the Layer section's blend and
// opacity written into each layer, and an optional background layer. Self-contained (no outside names):
// the Lottie preview script inside the sandbox runs this same function from its source text.
export function prepareLottie(source: unknown, options: LottiePrepareOptions): Record<string, unknown> {
  const data = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  const BLENDS: Record<string, number> = {
    color: 14,
    "color-burn": 7,
    "color-dodge": 6,
    darken: 4,
    difference: 10,
    exclusion: 11,
    "hard-light": 8,
    hue: 12,
    lighten: 5,
    luminosity: 15,
    multiply: 1,
    normal: 0,
    overlay: 3,
    saturation: 13,
    screen: 2,
    "soft-light": 9,
    "source-over": 0,
  };
  const scaleOpacity = (property: unknown, factor: number): void => {
    if (typeof property !== "object" || property === null) return;
    const prop = property as Record<string, unknown>;
    if (typeof prop.k === "number") {
      prop.k = prop.k * factor;
      return;
    }
    if (!Array.isArray(prop.k)) return;
    for (const key of prop.k as unknown[]) {
      if (typeof key !== "object" || key === null) continue;
      const frame = key as Record<string, unknown>;
      for (const field of ["s", "e"]) {
        const value = frame[field];
        if (Array.isArray(value)) frame[field] = value.map((item) => (typeof item === "number" ? item * factor : item));
        else if (typeof value === "number") frame[field] = value * factor;
      }
    }
  };
  const layers = Array.isArray(data.layers) ? (data.layers as Record<string, unknown>[]) : [];
  const hidden = new Set(options.hidden);
  layers.forEach((layer, index) => {
    if (typeof layer !== "object" || layer === null) return;
    const id = `lottie-${typeof layer.ind === "number" ? layer.ind : index}`;
    if (hidden.has(id)) layer.hd = true;
    const style = options.styles[id];
    if (!style) return;
    if (typeof style.blend === "string" && style.blend in BLENDS) layer.bm = BLENDS[style.blend];
    if (typeof style.opacity === "number" && style.opacity >= 0 && style.opacity < 100) {
      if (typeof layer.ks !== "object" || layer.ks === null) layer.ks = {};
      const ks = layer.ks as Record<string, unknown>;
      if (typeof ks.o !== "object" || ks.o === null) ks.o = { a: 0, k: 100 };
      scaleOpacity(ks.o, style.opacity / 100);
    }
  });
  if (typeof options.background === "string" && /^#[0-9a-f]{6}$/i.test(options.background)) {
    const w = Number(data.w);
    const h = Number(data.h);
    const top = layers.reduce((most, layer) => (typeof layer?.ind === "number" && layer.ind > most ? layer.ind : most), 0);
    layers.push({
      ao: 0,
      bm: 0,
      ddd: 0,
      ind: top + 1,
      ip: data.ip,
      ks: {
        a: { a: 0, k: [w / 2, h / 2, 0] },
        o: { a: 0, k: 100 },
        p: { a: 0, k: [w / 2, h / 2, 0] },
        r: { a: 0, k: 0 },
        s: { a: 0, k: [100, 100, 100] },
      },
      nm: "Background",
      op: data.op,
      sc: options.background.toLowerCase(),
      sh: h,
      sr: 1,
      st: 0,
      sw: w,
      ty: 1,
    });
    data.layers = layers;
  }
  return data;
}
