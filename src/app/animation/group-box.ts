import { findFigmaItem, readFigmaDesign } from "../mo/figma-paste-import";
import { readGroupStyles } from "./group-style";
import type { AnimationSpec } from "./animation-spec";
import { readLayerSizes } from "./layer-size";

export type LayerLike = Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string }>;
export type Box = Readonly<{ h: number; w: number; x: number; y: number }>;

// Whether a frame cuts what it holds: what Clip content says in the Layer section, or (before anything is set there) what the frame
// had in Figma. False for a layer that is not a frame.
export function frameClips(spec: AnimationSpec, id: string, params?: Readonly<Record<string, unknown>>): boolean {
  const item = findFigmaItem(spec, id);
  if (!item?.frame) return false;
  const own = params ? readGroupStyles(params)[id] : undefined;
  return own ? own.clip : item.frame.clip;
}

// The box around the design's own boxes of the layers a group holds (its size and place before moving or scaling), in the
// design's coordinates, or null when they are not known. A frame that clips what it holds is its own box: what sticks out of it
// is cut away and is not part of it.
export function naturalGroupBox(spec: AnimationSpec, layers: readonly LayerLike[], groupId: string, params?: Readonly<Record<string, unknown>>): Box | null {
  const placed = new Map<string, Box>();
  for (const block of readFigmaDesign(spec)?.blocks ?? []) {
    const k = block.s || 1;
    for (const item of block.items) placed.set(item.id, { h: item.h * k, w: item.w * k, x: block.x + item.x * k, y: block.y + item.y * k });
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const seen = new Set<string>();
  const add = (id: string): void => {
    const item = placed.get(id);
    if (!item) return;
    x0 = Math.min(x0, item.x);
    y0 = Math.min(y0, item.y);
    x1 = Math.max(x1, item.x + item.w);
    y1 = Math.max(y1, item.y + item.h);
  };
  const walk = (parent: string): void => {
    for (const layer of layers) {
      if (layer.parentGroupId !== parent || seen.has(layer.id)) continue;
      seen.add(layer.id);
      if (layer.kind === "group") {
        // A frame's own fill is part of it (its id is the group's id); a plain group has none. A clipping frame shows only its own box.
        add(layer.id);
        if (!frameClips(spec, layer.id, params)) walk(layer.id);
        continue;
      }
      add(layer.id);
    }
  };
  add(groupId);
  if (!frameClips(spec, groupId, params)) walk(groupId);
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { h: y1 - y0, w: x1 - x0, x: x0, y: y0 } : null;
}

// Where the group is now: its own box moved and scaled (from its top-left corner) by the Layer section's size settings.
export function placedGroupBox(spec: AnimationSpec, layers: readonly LayerLike[], groupId: string, params: Readonly<Record<string, unknown>>): Box | null {
  const natural = naturalGroupBox(spec, layers, groupId, params);
  if (!natural) return null;
  const size = readLayerSizes(params)[groupId];
  if (!size) return natural;
  return { h: (natural.h * size.sy) / 100, w: (natural.w * size.sx) / 100, x: natural.x + size.x, y: natural.y + size.y };
}

// Where one pasted layer sits in the design (block offset and scale included), or null when it is not part of the pasted design.
export function placedItemBox(spec: AnimationSpec, id: string): Box | null {
  for (const block of readFigmaDesign(spec)?.blocks ?? []) {
    const item = block.items.find((own) => own.id === id);
    if (!item) continue;
    const k = block.s || 1;
    return { h: item.h * k, w: item.w * k, x: block.x + item.x * k, y: block.y + item.y * k };
  }
  return null;
}

