import { planAnimationRange, readInteractionPlan, type InteractionPlanData, type PlanAnimation } from "./interaction-plan";

// Scenes can overlap: a scene may start before the one before it ends. While two scenes play at once, the picture is drawn with the later
// scene's settings and with the effects of both: the earlier scene's effects are moved onto the later scene's own clock (they start
// before it, so their delays are negative) and come first, so where both work on the same layer the later scene has the last word.

export type OverlapSource = Readonly<{ end: number; params: unknown; start: number }>;

// Hide is a state, not a motion: a scene hides the layers that are not its own while it plays (the scene before hides what comes in
// later; the scene after hides what the scene before shows). In the overlap each keeps to its own time, so the later scene's layers come
// in (the earlier scene's hides end where the later scene starts) and the earlier scene's layers stay (the later scene's hides start where
// the earlier scene ends): the earlier scene fades out over the later scene instead of cutting to it.
export function mergeOverlapPlans(main: unknown, mainStart: number, others: readonly OverlapSource[]): InteractionPlanData {
  const own = readInteractionPlan({ plan: main });
  const moved: PlanAnimation[] = [];
  // Where the earlier scenes end on this scene's clock.
  const free = others.length > 0 ? Math.max(...others.map((other) => other.end - mainStart)) : 0;
  for (const other of others) {
    const plan = readInteractionPlan(other.params);
    const shift = other.start - mainStart;
    for (const animation of plan.animations) {
      if (!animation.enabled) continue;
      const [from, to] = planAnimationRange(plan, animation);
      // The earlier scene's hide stops where this scene starts (0 on this scene's clock).
      const stop = animation.effect === "hide" ? -shift : to;
      if (animation.effect === "hide" && from >= stop) continue;
      const last = Math.min(to, stop);
      // The loops (spin, wave, float) count the seconds already run: they stay in step with their own scene.
      const phase = animation.effect === "spin" || animation.effect === "wave" || animation.effect === "float" ? { phase: (animation.phase ?? 0) - shift } : {};
      moved.push({ ...animation, ...phase, delay: from + shift, duration: Math.max(0.001, last - from), id: `${animation.id}@${other.start}`, segmentId: null });
    }
  }
  const animations = own.animations.map((animation) => {
    if (animation.effect !== "hide" || !animation.enabled || others.length === 0) return animation;
    const [from, to] = planAnimationRange(own, animation);
    const begin = Math.max(from, free);
    return begin === from ? animation : { ...animation, delay: begin, duration: Math.max(0.001, to - begin), segmentId: null };
  });
  return { animations: [...moved, ...animations], segments: own.segments };
}
