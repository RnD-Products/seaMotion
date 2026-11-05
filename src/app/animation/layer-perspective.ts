// Perspective for any layer (or a group of layers), with the same settings as the frame's perspective: a switch, four pins
// (corners) and a move pad. A pin moves a corner of the layer's box by a fraction of the box (-0.5 to 0.5 of its width and
// height), and the layer is drawn warped to the new corners. Stored with the animation's values (`__layerPerspective`: layer
// id -> { enabled, points }); the drawing script's sandbox gets the layers each entry holds (`__perspectives`) and warps them.
import { DEFAULT_FRAME_PERSPECTIVE, PERSPECTIVE_CORNERS, type FramePerspective, type PerspectiveCorner } from "./frame-transform";
import { readGroupStyles } from "./group-style";
import { readLayerAligns } from "./layer-align";
import { isUnscaled, readLayerSizes } from "./layer-size";
import type { AnimationSpec } from "./animation-spec";
import { placedItemBox } from "./group-box";
import { findFigmaItem, frameIds } from "../mo/figma-paste-import";

export const LAYER_PERSPECTIVE_KEY = "__layerPerspective";
export const PERSPECTIVES_PARAM = "__perspectives";
export const TOOL_PERSPECTIVE_TARGET = "tool.perspective";

type LayerLike = Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const fraction = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.min(0.5, Math.max(-0.5, value)) : 0);

export function readLayerPerspective(value: unknown): FramePerspective {
  if (!isRecord(value)) return DEFAULT_FRAME_PERSPECTIVE;
  const points = isRecord(value.points) ? value.points : {};
  const read = (corner: PerspectiveCorner): { x: number; y: number } => {
    const point = isRecord(points[corner]) ? (points[corner] as Record<string, unknown>) : {};
    return { x: fraction(point.x), y: fraction(point.y) };
  };
  return {
    enabled: value.enabled === true,
    points: { bottomLeft: read("bottomLeft"), bottomRight: read("bottomRight"), topLeft: read("topLeft"), topRight: read("topRight") },
  };
}

export function readLayerPerspectives(params: Readonly<Record<string, unknown>>): Readonly<Record<string, FramePerspective>> {
  const raw = params[LAYER_PERSPECTIVE_KEY];
  if (!isRecord(raw)) return {};
  const out: Record<string, FramePerspective> = {};
  for (const [id, value] of Object.entries(raw)) out[id] = readLayerPerspective(value);
  return out;
}

const isFlat = (perspective: FramePerspective): boolean => PERSPECTIVE_CORNERS.every((corner) => perspective.points[corner].x === 0 && perspective.points[corner].y === 0);

type Pins = { bl: { x: number; y: number }; br: { x: number; y: number }; tl: { x: number; y: number }; tr: { x: number; y: number } };
// What the drawing script does to a layer or a group, with the drawn layers it holds: warped to moved corners (perspective) and/or cut
// to a rounded box (a group that clips).
export type LayerEffect = { box?: { h: number; w: number; x: number; y: number }; size: { rot: number; sx: number; sy: number; x: number; y: number } | null; align: { h: string | null; v: string | null } | null; clip: { box?: { h: number; w: number; x: number; y: number }; radius: number[] } | null; group: string; ids: string[]; points: Pins | null };

// The frame a group clips to: the box of its own background layer (the layer named "<group> background" inside it, as pasted
// from Figma), in the drawing's coordinates; null when it has none (it then clips to the box around what it draws).
function clipBox(spec: AnimationSpec | null | undefined, layers: readonly LayerLike[], group: LayerLike): { h: number; w: number; x: number; y: number } | null {
  if (!spec?.design) return null;
  // A frame layer is its own background: its box is the frame's.
  const own = frameIds(spec).has(group.id) ? placedItemBox(spec, group.id) : null;
  if (own) {
    const design = spec.design as { height?: number; width?: number };
    const size = spec.size;
    const ox = size && typeof design.width === "number" ? (size.width - design.width) / 2 : 0;
    const oy = size && typeof design.height === "number" ? (size.height - design.height) / 2 : 0;
    return { h: own.h, w: own.w, x: own.x + ox, y: own.y + oy };
  }
  const wanted = `${(group.displayName ?? group.name ?? "").trim()} background`.toLowerCase();
  if (wanted === " background") return null;
  const seen = new Set<string>();
  const queue = [group.id];
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    for (const layer of layers) {
      if (layer.parentGroupId !== parent || seen.has(layer.id)) continue;
      seen.add(layer.id);
      if (layer.kind === "group") {
        queue.push(layer.id);
        continue;
      }
      if ((layer.displayName ?? layer.name ?? "").trim().toLowerCase() !== wanted) continue;
      const placed = placedItemBox(spec, layer.id);
      if (!placed) continue;
      // The design is centred in the drawing when the two sizes differ.
      const design = spec.design as { height?: number; width?: number };
      const size = spec.size;
      const ox = size && typeof design.width === "number" ? (size.width - design.width) / 2 : 0;
      const oy = size && typeof design.height === "number" ? (size.height - design.height) / 2 : 0;
      return { h: placed.h, w: placed.w, x: placed.x + ox, y: placed.y + oy };
    }
  }
  return null;
}

export function layerEffects(layers: readonly LayerLike[], params: Readonly<Record<string, unknown>>, spec?: AnimationSpec | null): LayerEffect[] {
  const perspectives = readLayerPerspectives(params);
  const groups = readGroupStyles(params);
  const out: LayerEffect[] = [];
  const aligns = readLayerAligns(params);
  const sizes = readLayerSizes(params);
  const wanted = new Set<string>([...Object.keys(perspectives), ...Object.keys(groups), ...Object.keys(aligns), ...Object.keys(sizes)]);
  const frames = frameIds(spec);
  for (const id of wanted) {
    const perspective = perspectives[id];
    const style = groups[id];
    const warp = perspective && perspective.enabled && !isFlat(perspective) ? perspective : null;
    const clip = style && style.clip ? style : null;
    const own = aligns[id];
    const align = own && (own.h !== null || own.v !== null) ? own : null;
    const ownSize = sizes[id];
    const size = ownSize && !isUnscaled(ownSize) ? ownSize : null;
    if (!warp && !clip && !align && !size) continue;
    const layer = layers.find((item) => item.id === id);
    if (!layer) continue;
    const ids = new Set<string>();
    const walk = (parent: string): void => {
      for (const child of layers) {
        if (child.parentGroupId !== parent) continue;
        if (child.kind === "group") {
          // A frame inside it brings its own fill.
          if (frames.has(child.id)) ids.add(child.id);
          walk(child.id);
        } else ids.add(child.id);
      }
    };
    if (layer.kind === "group") {
      if (frames.has(layer.id)) ids.add(layer.id);
      walk(layer.id);
    } else ids.add(layer.id);
    if (ids.size === 0) continue;
    const points = warp ? { bl: warp.points.bottomLeft, br: warp.points.bottomRight, tl: warp.points.topLeft, tr: warp.points.topRight } : null;
    // A text layer is aligned, scaled and moved by its own box (the text box), not by the pixels its letters cover: where the letters
    // sit inside the box is the text's own alignment (Font alignment), and stays as it is.
    const textBox = layer.kind !== "group" && spec && findFigmaItem(spec, id)?.kind === "text" ? placedItemBox(spec, id) : null;
    const design = (spec?.design ?? {}) as { height?: number; width?: number };
    const centred = textBox && spec?.size && typeof design.width === "number" && typeof design.height === "number" ? { x: (spec.size.width - design.width) / 2, y: (spec.size.height - design.height) / 2 } : { x: 0, y: 0 };
    const box = textBox ? { h: textBox.h, w: textBox.w, x: textBox.x + centred.x, y: textBox.y + centred.y } : null;
    out.push({ ...(box ? { box } : {}), size: size ? { rot: size.rot, sx: size.sx / 100, sy: size.sy / 100, x: size.x, y: size.y } : null, align: align ? { h: align.h, v: align.v } : null, group: id, clip: clip ? { ...(layer.kind === "group" ? (() => { const box = clipBox(spec, layers, layer); return box ? { box } : {}; })() : {}), radius: [...clip.radius] } : null, ids: [...ids], points });
  }
  return out;
}
