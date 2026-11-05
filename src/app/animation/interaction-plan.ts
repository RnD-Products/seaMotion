// The Interaction plan of a project that has no animation script: a list of segments played one after another, and a list of
// animations, each on a layer and in a segment. It is plain data kept in the project; each segment starts where the one before
// it ends (its travel time plus its hold), so changing one time moves everything after it.
export type PlanEffect = "blur" | "count" | "fade" | "flip" | "float" | "hide" | "in" | "letters" | "lettersOut" | "move" | "out" | "reveal" | "rotate" | "scale" | "spin" | "sweep" | "swap" | "trim" | "wave";

export const PLAN_EFFECTS: readonly Readonly<{ label: string; value: PlanEffect }>[] = [
  { label: "Fade", value: "fade" },
  { label: "Move", value: "move" },
  { label: "Scale", value: "scale" },
  { label: "Blur", value: "blur" },
  // One animation that brings a layer in (or takes it out) with a fade and, as set, a blur, a slide from a side and a scale.
  { label: "Come in", value: "in" },
  { label: "Go out", value: "out" },
  // A text comes in letter by letter (each letter with the same fade, blur and slide, one stagger after the one before).
  { label: "Letters in", value: "letters" },
  { label: "Letters out", value: "lettersOut" },
  // A stroke draws itself along its path.
  { label: "Trim path", value: "trim" },
  // A turn about the vertical axis (in perspective for an outline layer), from an angle to flat; it waits flat until it starts.
  { label: "Turn 3D", value: "flip" },
  // A band opens across the layer from the middle of the frame, to the top and to the bottom at once, until the layer is gone.
  { label: "Mask out", value: "reveal" },
  // A turn in the picture plane about a point, from an angle to where the layer is (a needle swinging into place).
  { label: "Rotate", value: "rotate" },
  // The layer shows through a wedge that opens from the left, as far as the direction it ends at (a gauge filling as its needle swings).
  { label: "Sweep reveal", value: "sweep" },
  // A turn that never stops: one whole turn every period, in step with the whole motion (see the phase), so a loop meets itself.
  { label: "Spin loop", value: "spin" },
  // A wave line moving sideways, one wave length (step) every period, in step with the whole motion.
  { label: "Wave loop", value: "wave" },
  // A layer that floats: it bobs and sways a few pixels, whole cycles every period in step with the whole motion, so the loop has no seam.
  { label: "Float loop", value: "float" },
  // A number in a text counts up (or down) to the value it has, with its decimals, leading zeros and the signs around it kept ("064", "72%").
  { label: "Count", value: "count" },
  // The layer is not drawn while the playhead is inside this animation's bar (a layer that has no part in a scene).
  { label: "Hide", value: "hide" },
  // A text shows other words while the playhead is inside this animation's bar, then is as it was ("CO2 today" shows "CO2 Wed").
  { label: "Swap text", value: "swap" },
];

// The settings of "Come in", "Go out" and "Letters in" (and the angle of "Turn 3D"): everything is optional, a missing value is none.
export type PlanSlide = "bottom" | "left" | "none" | "right" | "top";
export const PLAN_SLIDES: readonly Readonly<{ label: string; value: PlanSlide }>[] = [
  { label: "None", value: "none" },
  { label: "Top", value: "top" },
  { label: "Bottom", value: "bottom" },
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
];

export type PlanSegment = Readonly<{ hold: number; id: string; name: string; travel: number }>;

export type PlanAnimation = Readonly<{
  // "Come in" and "Go out": the angle in degrees of "Turn 3D" before it is flat.
  angle?: number;
  // "Come in", "Go out" and "Letters in": a blur (px) that clears, a slide (px) from or to a side, a scale (%) to start from or end at, and for
  // letters the seconds between one letter and the next.
  blur?: number;
  distance?: number;
  // "Count": the number it starts from, and the number it counts to (the layer's own number when missing).
  from?: number;
  to?: number;
  // "Swap text": the words the text shows.
  text?: string;
  // "Rotate", "Sweep reveal" and "Spin loop": the point they turn about (design pixels); the middle of the layer when missing.
  px?: number;
  py?: number;
  // "Sweep reveal": a needle that swings in step has its base at bx, by and this length (reach): the reveal, from the pivot (the ring's centre),
  // then ends under the needle's tip.
  bx?: number;
  by?: number;
  reach?: number;
  // "Spin loop" and "Wave loop": the seconds of one turn (or one wave length), and the seconds the motion has already run when this scene
  // starts (so the loop carries on from scene to scene and meets itself at the end).
  period?: number;
  phase?: number;
  scale?: number;
  slide?: PlanSlide;
  stagger?: number;
  // Seconds after the segment starts (or after the motion starts, for a whole-motion animation).
  delay: number;
  duration: number;
  effect: PlanEffect;
  enabled: boolean;
  id: string;
  // The layer of the design it works on; empty means the whole frame.
  layer: string;
  name: string;
  // The segment it belongs to; null plays across the whole motion.
  segmentId: string | null;
}>;

export type InteractionPlanData = Readonly<{ animations: readonly PlanAnimation[]; segments: readonly PlanSegment[] }>;

export const EMPTY_INTERACTION_PLAN: InteractionPlanData = Object.freeze({ animations: Object.freeze([]), segments: Object.freeze([]) });

const MAX_SECONDS = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(MAX_SECONDS, Math.max(0, value)) : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 80) : fallback;
}

// The plan lives in the "plan" key of the project's animation parameters.
export function readInteractionPlan(params: unknown): InteractionPlanData {
  const plan = isRecord(params) ? params.plan : undefined;
  if (!isRecord(plan)) return EMPTY_INTERACTION_PLAN;
  const segments: PlanSegment[] = [];
  if (Array.isArray(plan.segments)) {
    for (const raw of plan.segments) {
      if (!isRecord(raw) || typeof raw.id !== "string") continue;
      segments.push({ hold: seconds(raw.hold, 0.5), id: raw.id, name: text(raw.name, "Segment"), travel: seconds(raw.travel, 1) });
    }
  }
  const animations: PlanAnimation[] = [];
  if (Array.isArray(plan.animations)) {
    for (const raw of plan.animations) {
      if (!isRecord(raw) || typeof raw.id !== "string") continue;
      const effect = PLAN_EFFECTS.find((item) => item.value === raw.effect)?.value ?? "fade";
      const segmentId = typeof raw.segmentId === "string" && segments.some((segment) => segment.id === raw.segmentId) ? raw.segmentId : null;
      const number = (value: unknown, max: number): number | undefined => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(-max, value)) : undefined);
      const slide = PLAN_SLIDES.find((item) => item.value === raw.slide)?.value;
      animations.push({
        ...(number(raw.angle, 720) === undefined ? {} : { angle: number(raw.angle, 720) }),
        ...(number(raw.blur, 400) === undefined ? {} : { blur: number(raw.blur, 400) }),
        ...(number(raw.distance, 5000) === undefined ? {} : { distance: number(raw.distance, 5000) }),
        ...(number(raw.from, 1000000) === undefined ? {} : { from: number(raw.from, 1000000) }),
        ...(number(raw.to, 1000000) === undefined ? {} : { to: number(raw.to, 1000000) }),
        ...(typeof raw.text === "string" ? { text: raw.text.slice(0, 200) } : {}),
        ...(number(raw.px, 100000) === undefined ? {} : { px: number(raw.px, 100000) }),
        ...(number(raw.py, 100000) === undefined ? {} : { py: number(raw.py, 100000) }),
        ...(number(raw.bx, 100000) === undefined ? {} : { bx: number(raw.bx, 100000) }),
        ...(number(raw.by, 100000) === undefined ? {} : { by: number(raw.by, 100000) }),
        ...(number(raw.reach, 100000) === undefined ? {} : { reach: number(raw.reach, 100000) }),
        ...(number(raw.period, 3600) === undefined ? {} : { period: number(raw.period, 3600) }),
        ...(number(raw.phase, 3600) === undefined ? {} : { phase: number(raw.phase, 3600) }),
        ...(number(raw.scale, 2000) === undefined ? {} : { scale: number(raw.scale, 2000) }),
        ...(slide === undefined ? {} : { slide }),
        ...(number(raw.stagger, 5) === undefined ? {} : { stagger: number(raw.stagger, 5) }),
        delay: seconds(raw.delay, 0),
        duration: seconds(raw.duration, 0.6),
        effect,
        enabled: raw.enabled !== false,
        id: raw.id,
        layer: text(raw.layer, ""),
        name: text(raw.name, "Animation"),
        segmentId,
      });
    }
  }
  return { animations, segments };
}

export function newPlanId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type SegmentTime = Readonly<{ end: number; id: string; start: number }>;

// Each segment starts where the one before it ends: its travel time, then its hold.
export function planSegmentTimes(plan: InteractionPlanData): SegmentTime[] {
  const times: SegmentTime[] = [];
  let at = 0;
  for (const segment of plan.segments) {
    const end = at + segment.travel + segment.hold;
    times.push({ end, id: segment.id, start: at });
    at = end;
  }
  return times;
}

export function planTotal(plan: InteractionPlanData): number {
  const times = planSegmentTimes(plan);
  return times[times.length - 1]?.end ?? 0;
}

// When an animation plays: its delay after its segment starts (or after 0), for its duration.
export function planAnimationRange(plan: InteractionPlanData, animation: PlanAnimation): readonly [number, number] {
  const segment = animation.segmentId ? planSegmentTimes(plan).find((time) => time.id === animation.segmentId) : undefined;
  const start = (segment?.start ?? 0) + animation.delay;
  return [start, start + animation.duration];
}
