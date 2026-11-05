import { readInteractionPlan } from "./interaction-plan";
import { leavesOf, type Box } from "./layer-geometry";

type LayerLike = Readonly<{ id: string; kind?: string; parentGroupId?: string }>;

// Whether the open scene has a Float loop (Floating preset): only then does the outline need the playhead.
export function hasFloat(params: Readonly<Record<string, unknown>>): boolean {
  return readInteractionPlan(params).animations.some((animation) => animation.effect === "float" && animation.enabled !== false);
}

// A Float loop moves its layer while it plays (two bobs and a sway in every period, the same curve the drawing uses). The outline and its handles
// sit where the layer is drawn at the playhead, not where it rests, or they drift off the picture as it floats. `time` is the seconds into the scene.
export function withMotionOffsets(boxes: ReadonlyMap<string, Box>, layers: readonly LayerLike[], params: Readonly<Record<string, unknown>>, time: number): Map<string, Box> {
  const out = new Map(boxes);
  const drawn = new Set(boxes.keys());
  for (const animation of readInteractionPlan(params).animations) {
    if (animation.effect !== "float" || animation.enabled === false || !animation.layer) continue;
    const begin = animation.delay || 0;
    const length = Math.max(0.001, animation.duration || 0.6);
    if (time < begin || time > begin + length) continue;
    const period = Math.max(0.01, animation.period || 8);
    const bob = animation.distance == null ? 6 : animation.distance;
    const turn = ((((time + (animation.phase || 0)) / period) % 1) + 1) % 1 * Math.PI * 2;
    const dy = bob * Math.sin(2 * turn);
    const dx = bob * 0.58 * Math.sin(turn + 1.2);
    for (const id of leavesOf(layers, [animation.layer], drawn)) {
      const box = out.get(id);
      if (box) out.set(id, { ...box, x: box.x + dx, y: box.y + dy });
    }
  }
  return out;
}
