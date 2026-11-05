import type { AnimationSpec } from "./animation-spec";
import { readInteractionPlan } from "./interaction-plan";
import { withLayerEffects } from "./layer-effect-boxes";
import { currentBoxes, leavesOf, readPlaced, union, type Box } from "./layer-geometry";

type LayerLike = Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string; visible: boolean }>;

// Floating never leaves the screen, so a layer can bob only as far as it has room on the artboard: across by 0.58 of a bob, down by a whole bob. A layer
// sitting on an edge (aligned to it) has no room on that side, so it bobs only along the other direction, or not at all in a corner.
// Returns the largest bob (design pixels) that keeps the layer's box on the artboard, or null when the layer is not found.
export function floatRoom(
  spec: AnimationSpec,
  layers: readonly LayerLike[],
  params: Readonly<Record<string, unknown>>,
  layerId: string,
  area: Readonly<{ height: number; width: number }>,
): number | null {
  const placed = readPlaced(spec, area);
  const shown = withLayerEffects(currentBoxes(placed, params), layers, params, spec, area);
  const around = union(leavesOf(layers, [layerId], new Set(placed.keys())).flatMap((id) => (shown.has(id) ? [shown.get(id) as Box] : [])));
  if (!around) return null;
  const across = Math.max(0, Math.min(around.x, area.width - (around.x + around.w)));
  const down = Math.max(0, Math.min(around.y, area.height - (around.y + around.h)));
  return Math.floor(Math.min(across / 0.58, down) * 2) / 2;
}

// After a layer is moved (aligned to an edge, say), the Floating preset on it keeps to the room the layer now has: its bob shrinks to fit, and grows
// back to the preset's own size once there is room again. Only the preset's own floats are touched (not a float edited in the Motion Plan).
export function limitFloats(
  params: Record<string, unknown>,
  spec: AnimationSpec,
  layers: readonly LayerLike[],
  layerIds: readonly string[],
  area: Readonly<{ height: number; width: number }>,
): Record<string, unknown> {
  const plan = readInteractionPlan(params);
  const full = Math.max(3, Math.round(Math.min(area.width, area.height) * 0.018 * 2) / 2);
  let changed = false;
  const animations = plan.animations.map((animation) => {
    if (animation.effect !== "float" || !animation.id.startsWith("preset-float-") || !layerIds.includes(animation.layer ?? "")) return animation;
    const room = floatRoom(spec, layers, params, animation.layer as string, area);
    if (room === null) return animation;
    const distance = Math.max(0, Math.min(full, room));
    if (distance === animation.distance) return animation;
    changed = true;
    return { ...animation, distance };
  });
  return changed ? { ...params, plan: { ...plan, animations } } : params;
}
