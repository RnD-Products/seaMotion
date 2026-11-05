import { frameIds } from "../mo/figma-paste-import";
import type { MediaLayer } from "../media/media-layer";

// A project carries its own animation: the controls it offers, the layers it is made of, and a
// drawing script with every image and font it needs. The app itself contains no animation.
export type ControlSpec = Readonly<{
  default: unknown;
  group?: string;
  id: string;
  label: string;
  // The layer of the design this control changes ("Main card", "Cursor"...); cards group their controls by it.
  layer?: string;
  max?: number;
  min?: number;
  options?: readonly { label: string; value: string }[];
  // "frame" controls describe the design itself (corner radius, colors) and live under Frame Settings.
  section?: "frame";
  showWhen?: Readonly<{ equals: unknown; id: string }>;
  step?: number;
  type: "color" | "segmented" | "select" | "slider" | "switch";
  unit?: string;
}>;

export type LayerSpec = Readonly<{ id: string; name: string }>;

// A long page shown through a window: its total height, the window's size, and its sections top to bottom.
export type PageInfo = Readonly<{
  height: number;
  sections: readonly Readonly<{ height: number; id: string; name: string; top: number }>[];
  viewport: Readonly<{ height: number; width: number }>;
}>;

export type AnimationSpec = Readonly<{
  assets: Readonly<Record<string, string>>;
  // Script source. It runs inside the sandbox with `api` in scope and returns { init?, render }.
  code: string;
  controls: readonly ControlSpec[];
  // style is "normal" or "italic" (missing means normal).
  fonts: readonly Readonly<{ asset: string; family: string; style?: string; weight: string }>[];
  // A design pasted from Figma: its layers' shapes, texts and pictures, drawn by the app's design script
  // (src/app/mo/figma-paste-import.ts). Several pastes into one project are blocks, each placed and scaled.
  design?: Readonly<Record<string, unknown>>;
  id: string;
  imageAssets: readonly string[];
  // A page imported layer by layer: the pictures (keys of `assets`) each layer is painted with. The Layer files
  // control then replaces a picture in place instead of adding or removing images.
  layerImages?: Readonly<Record<string, readonly string[]>>;
  layers: readonly LayerSpec[];
  name: string;
  // Layer pictures replaced by a video or GIF, by picture key: `assets[key]` holds the clip's first frame (what
  // scripts load), and the clip itself is `assets[media.asset]`. The app swaps in the current frame while drawing.
  assetMedia?: Readonly<Record<string, MediaLayer>>;
  // Video and GIF layers by layer id (see src/app/media/media-layer.ts); the app decodes and places them.
  media?: Readonly<Record<string, MediaLayer>>;
  // A Lottie Animation project: the Lottie (Bodymovin) JSON it plays and exports. Its `code` is not used; the
  // app's own Lottie player draws it (src/app/lottie/lottie-runtime.ts).
  lottie?: Readonly<Record<string, unknown>>;
  // A Landing Page design: the whole page's height and its sections, for the Scroll plan.
  page?: PageInfo;
  // Optional, display-sized raster copies used only by low-quality interactive preview.
  // The source signature prevents a replaced original from reusing a stale preview copy.
  previewAssets?: Readonly<Record<string, Readonly<{ data: string; sourceSignature: string }>>>;
  // The size the design was made at; Original in Settings returns the canvas to it.
  size?: Readonly<{ height: number; width: number }>;
  version: number;
}>;

export type AnimationParams = Readonly<Record<string, unknown>>;

export const NO_ANIMATION = "none";
export const ANIMATION_TYPE_TARGET = "animation.type";
export const LAYER_STYLE_KEY = "__layerStyle";
export type LayerStyle = Readonly<{ blend?: string; opacity?: number }>;
export const ANIMATION_PARAMS_TARGET = "animation.params";
export const ANIMATION_FRAME_TARGET = "animation.frame";
export const ANIMATION_LIBRARY_TARGET = "animation.library";
export const ANIMATION_TEXTS_TARGET = "animation.texts";

export type AnimationLibrary = Readonly<{ items: Readonly<Record<string, AnimationSpec>> }>;
export const EMPTY_ANIMATION_LIBRARY: AnimationLibrary = Object.freeze({ items: Object.freeze({}) });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAnimationSpec(value: unknown): value is AnimationSpec {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.code === "string" &&
    Array.isArray(value.controls) &&
    Array.isArray(value.layers) &&
    isRecord(value.assets)
  );
}

export function readAnimationLibrary(value: unknown): AnimationLibrary {
  if (!isRecord(value) || !isRecord(value.items)) return EMPTY_ANIMATION_LIBRARY;
  const items: Record<string, AnimationSpec> = {};
  for (const [id, spec] of Object.entries(value.items)) {
    if (isAnimationSpec(spec)) items[id] = spec;
  }
  return { items };
}

export function getActiveAnimation(values: Readonly<Record<string, unknown>>): AnimationSpec | null {
  const type = values[ANIMATION_TYPE_TARGET];
  if (typeof type !== "string" || type === NO_ANIMATION) return null;
  return readAnimationLibrary(values[ANIMATION_LIBRARY_TARGET]).items[type] ?? null;
}

// The current value of every control; controls the project has not set yet use their defaults.
export function resolveParams(spec: AnimationSpec, params: unknown): Record<string, unknown> {
  const stored = isRecord(params) ? params : {};
  const resolved: Record<string, unknown> = {};
  for (const control of spec.controls) {
    resolved[control.id] = stored[control.id] !== undefined ? stored[control.id] : control.default;
  }
  // Per-layer settings made in the Layer section (blend and opacity, a pasted design's text and picture edits) are
  // kept under keys starting with "__" and travel with the other values.
  for (const [key, value] of Object.entries(stored)) {
    // "__frame" (a design layer chosen as the frame) belongs to the frame settings, which are off.
    if (key.startsWith("__") && key !== "__frame" && value !== undefined) resolved[key] = value;
  }
  // The hand-built Interaction plan (a scene's layer effects) is no control of the spec. The Layer section writes these resolved
  // params back whole when a layer setting changes, so the plan must travel with them or that edit wipes the scene's motion.
  if (stored.plan !== undefined) resolved.plan = stored.plan;
  return resolved;
}

export function getDefaultParams(spec: AnimationSpec): Record<string, unknown> {
  return resolveParams(spec, {});
}

type LayerLike = Readonly<{ id: string; kind?: string; parentGroupId?: string; visible: boolean }>;

// Ids of the animation's visible layers, bottom to top. Without any of its layers present
// (before they are created) every layer is drawn in the default order.
// A design pasted from Figma owns its layer list: deleting its layers (even all of them) leaves nothing to draw,
// instead of falling back to drawing every layer of the animation again.
export function hasOwnLayerList(spec: AnimationSpec): boolean {
  return spec.id.startsWith("figma-design-");
}

export function getLayerStack(spec: AnimationSpec, layers: readonly LayerLike[]): string[] {
  const known = new Set(spec.layers.map((layer) => layer.id));
  if (!hasOwnLayerList(spec) && !layers.some((layer) => known.has(layer.id))) return [...spec.layers].reverse().map((layer) => layer.id);
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const isShown = (layer: LayerLike): boolean => {
    const seen = new Set<string>();
    for (let current: LayerLike | undefined = layer; current; current = current.parentGroupId ? byId.get(current.parentGroupId) : undefined) {
      if (!current.visible || seen.has(current.id)) return false;
      seen.add(current.id);
    }
    return true;
  };
  // The drawing order follows the layer tree as the Layers panel shows it (a group, then what it holds, top first), not the
  // flat list: grouping layers can leave a group's sub-layers further down the list, which would draw them under a picture
  // that sits above them in the tree.
  const present = new Set(layers.map((layer) => layer.id));
  const children = new Map<string | undefined, LayerLike[]>();
  for (const layer of layers) {
    const parent = layer.parentGroupId && present.has(layer.parentGroupId) && layer.parentGroupId !== layer.id ? layer.parentGroupId : undefined;
    const list = children.get(parent);
    if (list) list.push(layer);
    else children.set(parent, [layer]);
  }
  const ordered: LayerLike[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | undefined): void => {
    for (const layer of children.get(parent) ?? []) {
      if (visited.has(layer.id)) continue;
      visited.add(layer.id);
      ordered.push(layer);
      walk(layer.id);
    }
  };
  walk(undefined);
  // Anything the walk could not reach (a cycle) keeps its place in the list, at the end.
  for (const layer of layers) if (!visited.has(layer.id)) ordered.push(layer);
  const stack: string[] = [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const layer = ordered[index];
    if (layer && known.has(layer.id) && isShown(layer)) stack.push(layer.id);
  }
  return underFrameContents(stack, frameIds(spec), byId);
}

// A frame layer (a Figma frame) draws its own fill under what it holds: its id comes just before the lowest layer inside it, outermost
// frames first so a frame inside a frame keeps its place in the order.
export function underFrameContents(stack: readonly string[], frames: ReadonlySet<string>, byId: ReadonlyMap<string, Readonly<{ parentGroupId?: string }>>): string[] {
  if (frames.size === 0) return [...stack];
  const parentOf = (id: string): string | undefined => byId.get(id)?.parentGroupId;
  const depth = (id: string): number => {
    let count = 0;
    for (let at = parentOf(id); at && count < 1000; at = parentOf(at)) count += 1;
    return count;
  };
  const inside = (id: string, frame: string): boolean => {
    for (let at = parentOf(id), guard = 0; at && guard < 1000; at = parentOf(at), guard += 1) if (at === frame) return true;
    return false;
  };
  const out = [...stack];
  for (const frame of stack.filter((id) => frames.has(id)).sort((a, b) => depth(a) - depth(b))) {
    const from = out.indexOf(frame);
    let lowest = -1;
    out.forEach((id, index) => {
      if (id !== frame && inside(id, frame) && (lowest < 0 || index < lowest)) lowest = index;
    });
    if (lowest >= 0 && lowest < from) {
      out.splice(from, 1);
      out.splice(lowest, 0, frame);
    }
  }
  return out;
}

// The Card layer is not listed: the frame's own fill, stroke and corner radius replace it.
export const HIDDEN_LAYER_IDS: readonly string[] = ["design-card"];

// Makes the Layers panel list exactly the animation's layers (all visible), replacing what was there.
export function getLayerCommands(
  current: readonly { id: string }[],
  allLayers: readonly LayerSpec[],
): ({ layerId: string; type: "layers.delete" } | { insertIndex: number; layer: { id: string; kind: "layer"; name: string; visible: boolean }; type: "layers.add" })[] {
  const layers = allLayers.filter((layer) => !HIDDEN_LAYER_IDS.includes(layer.id));
  return [
    ...current.map((layer) => ({ layerId: layer.id, type: "layers.delete" as const })),
    ...layers.map((layer, index) => ({
      insertIndex: index,
      layer: { id: layer.id, kind: "layer" as const, name: layer.name, visible: true },
      type: "layers.add" as const,
    })),
  ];
}

const singular = (word: string): string => word.replace(/s$/, "");

// The design layer a control edits, found from its id prefix (`card.radius` -> the Card layer):
// an exact layer name first, then a layer named for it (`image` -> Card image), then the same word
// in the plural (`image` -> Hover images). Controls with no matching layer belong to the whole design.
export function getControlLayerId(spec: AnimationSpec, control: ControlSpec): string | null {
  const prefix = control.id.split(".")[0] ?? "";
  const slug = (layer: LayerSpec): string => layer.id.replace(/^design-/, "");
  const found =
    spec.layers.find((layer) => slug(layer) === prefix) ??
    spec.layers.find((layer) => slug(layer).endsWith(`-${prefix}`)) ??
    spec.layers.find((layer) => slug(layer).split("-").some((word) => singular(word) === singular(prefix)));
  return found?.id ?? null;
}

const IMAGE_WORDS = new Set(["image", "photo"]);

// The images a layer holds. An image named for the layer (`header` -> Header, `hover-1` -> Hover
// images) belongs to it; images no layer is named for belong to the layer(s) described as image or
// photo layers (Card image, Photos). Layers without images return an empty list.
export function getLayerImageAssets(spec: AnimationSpec, layerId: string): string[] {
  if (spec.layerImages) return [...(spec.layerImages[layerId] ?? [])];
  const slug = (layer: LayerSpec): string => layer.id.replace(/^design-/, "");
  const wordsOf = (layer: LayerSpec): string[] => slug(layer).split("-").map(singular);
  const base = (asset: string): string => singular(asset.replace(/-?\d+$/, ""));
  const layer = spec.layers.find((item) => item.id === layerId);
  if (!layer) return [];
  const namedFor = (asset: string): LayerSpec | undefined => spec.layers.find((item) => wordsOf(item).includes(base(asset)));
  const own = spec.imageAssets.filter((asset) => namedFor(asset)?.id === layerId);
  const unnamed = spec.imageAssets.filter((asset) => !namedFor(asset));
  const describesImages = wordsOf(layer).some((word) => IMAGE_WORDS.has(word));
  return [...own, ...(describesImages ? unnamed : [])];
}

// The texts the user has changed: the text the animation draws -> the text to draw instead.
export function readTextOverrides(values: Readonly<Record<string, unknown>>): Record<string, string> {
  const stored = values[ANIMATION_TEXTS_TARGET];
  if (!isRecord(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

// The size the animation draws at: the size it was designed at, so a canvas of another shape
// never clips it. Designs that do not record one are drawn at the canvas size.
export function getRenderSize(
  spec: AnimationSpec,
  canvas: Readonly<{ height: number; width: number }>,
): Readonly<{ height: number; width: number }> {
  return spec.size ?? canvas;
}
