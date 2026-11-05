import type { AnimationSpec } from "./animation-spec";
import { union, type Box } from "./layer-geometry";
import { layerEffects } from "./layer-perspective";

type LayerLike = Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string; visible: boolean }>;

// The drawing aligns, scales and moves a layer (or a group) after it is placed: the Layer section's alignment icons, size and position. The
// boxes the artboard outlines and picks by must follow, or the selection stays where the layer was before those settings moved it.
// Same rules as the drawing: scale from the box's top-left corner, then align the scaled box to an edge or the middle of the artboard, then the move.
export function withLayerEffects(
  boxes: ReadonlyMap<string, Box>,
  layers: readonly LayerLike[],
  params: Readonly<Record<string, unknown>>,
  spec: AnimationSpec | null,
  area: Readonly<{ height: number; width: number }>,
): Map<string, Box> {
  const out = new Map(boxes);
  for (const effect of layerEffects(layers, params, spec)) {
    if (!effect.align && !effect.size) continue;
    const held = effect.ids.filter((id) => out.has(id));
    const around = union(held.map((id) => out.get(id) as Box));
    if (!around) continue;
    const sx = effect.size?.sx ?? 1;
    const sy = effect.size?.sy ?? 1;
    const w = around.w * sx;
    const h = around.h * sy;
    let dx = 0;
    let dy = 0;
    if (effect.align) {
      if (effect.align.h === "left") dx = -around.x;
      else if (effect.align.h === "right") dx = area.width - (around.x + w);
      else if (effect.align.h === "center") dx = (area.width - w) / 2 - around.x;
      if (effect.align.v === "top") dy = -around.y;
      else if (effect.align.v === "bottom") dy = area.height - (around.y + h);
      else if (effect.align.v === "middle") dy = (area.height - h) / 2 - around.y;
    }
    dx += effect.size?.x ?? 0;
    dy += effect.size?.y ?? 0;
    for (const id of held) {
      const box = out.get(id) as Box;
      out.set(id, { h: box.h * sy, w: box.w * sx, x: around.x + (box.x - around.x) * sx + dx, y: around.y + (box.y - around.y) * sy + dy });
    }
  }
  return out;
}
