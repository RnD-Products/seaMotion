import type { AnimationSpec } from "./animation-spec";
import { LAYER_ALIGN_KEY, readLayerAligns, type AlignEdge } from "./layer-align";
import { withLayerEffects } from "./layer-effect-boxes";
import { currentBoxes, leavesOf, readPlaced, union, withBoxes, type Box } from "./layer-geometry";

type LayerLike = Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string; visible: boolean }>;

// Pressing an alignment icon is an action, as in Figma: the layer (or group) moves so that its box touches that edge or middle of the artboard, and
// the icon stays unlit. Nothing is kept except the new position. A layer that still has an alignment kept by an earlier version has it folded into
// its position first, so it does not jump.
export function alignLayer(
  edge: Exclude<AlignEdge, "center">,
  spec: AnimationSpec,
  layers: readonly LayerLike[],
  layerId: string,
  params: Readonly<Record<string, unknown>>,
  area: Readonly<{ height: number; width: number }>,
): Record<string, unknown> | null {
  const placed = readPlaced(spec, area);
  const resting = currentBoxes(placed, params);
  const kept = readLayerAligns(params);
  const { [LAYER_ALIGN_KEY]: _aligns, ...withoutAligns } = params;
  const remaining = { ...kept };
  delete remaining[layerId];
  const others = Object.keys(remaining).length > 0 ? { ...withoutAligns, [LAYER_ALIGN_KEY]: remaining } : withoutAligns;
  const shownNow = withLayerEffects(resting, layers, params, spec, area);
  const shownWithout = withLayerEffects(resting, layers, others, spec, area);
  const leaves = leavesOf(layers, [layerId], new Set(placed.keys()));
  const around = union(leaves.flatMap((id) => (shownNow.has(id) ? [shownNow.get(id) as Box] : [])));
  if (!around) return null;
  let dx = 0;
  let dy = 0;
  if (edge === "left") dx = -around.x;
  else if (edge === "hcenter") dx = (area.width - around.w) / 2 - around.x;
  else if (edge === "right") dx = area.width - (around.x + around.w);
  else if (edge === "top") dy = -around.y;
  else if (edge === "vcenter") dy = (area.height - around.h) / 2 - around.y;
  else dy = area.height - (around.y + around.h);
  const targets = new Map<string, Box>();
  for (const id of leaves) {
    const rest = resting.get(id);
    const now = shownNow.get(id);
    const without = shownWithout.get(id);
    if (!rest || !now || !without) continue;
    // Where it rests = where it rests now + what the old alignment added + this move.
    targets.set(id, { ...rest, x: rest.x + (now.x - without.x) + dx, y: rest.y + (now.y - without.y) + dy });
  }
  return withBoxes(others, placed, targets);
}
