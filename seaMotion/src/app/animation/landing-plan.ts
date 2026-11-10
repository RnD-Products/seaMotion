import type { PageInfo } from "./animation-spec";
import { DEFAULT_START_COLOR, DEFAULT_START_PRESET, readStartPreset, type StartPreset } from "./start-screen";

// The Scroll plan of a Landing Page: how long the Start lasts, then a list of steps. Each step
// scrolls the page by `scroll` px from where it is (positive goes down, negative comes back up),
// taking `travel` seconds, and then waits `pause` seconds. Where a step lands is worked out by adding
// the steps up, so changing one step moves everything after it. A Reload step cuts back to the top.
export type PlanStepKind = "reload" | "scroll";

// How a step speeds up and slows down on its way to the next position.
export type EasingId = "custom" | "expo-in-out" | "in" | "lenis" | "linear" | "out" | "overshoot" | "smooth";
// A step's own choice: a preset, or "plan" to follow the plan's. It is stored as the word "plan" (a
// removed key would not be saved), and read back as no override.
export type EasingChoice = EasingId | "plan";

// A step's second scroll ("2nd At"): nested in its step, it starts `delay` seconds after the step
// starts, while the first scroll may still be running, and carries on from wherever the page is to a
// position that follows the step's own `y` (`offset` px from it). It has its own easing. The step's
// Hold comes after the second scroll ends.
export type PlanSecond = Readonly<{
  customEasing?: string;
  delay: number;
  easing: EasingChoice;
  offset: number;
  travel: number;
}>;

export type PlanStep = Readonly<{
  // The card's own name; empty means the automatic one (the section it is in).
  name?: string;
  // A pasted cubic-bezier for this step, used when its easing is "custom".
  customEasing?: string;
  // Overrides the plan's easing for this step.
  easing?: EasingChoice;
  id: string;
  kind: PlanStepKind;
  pause: number;
  // The section whose animation must be over before this step's Hold starts; null or missing waits for nothing.
  waitFor?: string | null;
  // How far this step scrolls, in px, from where the page is: positive goes down, negative comes
  // back up. Never a position on the page.
  scroll: number;
  // The nested second scroll; null when the step has none (stored as null, since a removed key is not saved).
  second?: PlanSecond | null;
  travel: number;
}>;

// What happens after the last step: stay on the bottom, scroll back up to the top (a loop), or cut
// back to the top as if the page reloaded.
export type EndMode = "hold" | "reload" | "top";

export type PlanEnd = Readonly<{
  // Seconds the timeline keeps running at the end.
  hold: number;
  mode: EndMode;
  // Seconds the scroll back to the top takes (mode "top").
  travel: number;
}>;

// One part of the Start. The parts play one after another: for example the page's top view held
// still as a thumbnail, then a preloader, then an intro transition.
export type StartPart = Readonly<{
  // Accent colour (used by the preloaders).
  color: string;
  duration: number;
  id: string;
  preset: StartPreset;
}>;

// Motion blur while the page scrolls: a vertical smear along the scroll, longer the faster it moves.
// `amount` is the shutter: 0 is off, 100 is a shutter open for 1/30 s. `preview` only decides whether the canvas
// preview shows it; a render (export) always has it.
export type MotionBlur = Readonly<{ amount: number; preview: boolean }>;

export type LandingPlan = Readonly<{
  // Motion blur of the page scroll.
  blur: MotionBlur;
  // A pasted cubic-bezier for the plan, used when its easing is "custom".
  customEasing: string;
  // The easing steps use unless they choose their own.
  easing: EasingId;
  // The same for every nested 2nd At that has no easing of its own ("2nd plan default"), and its pasted curve.
  secondCustomEasing: string;
  secondEasing: EasingId;
  // How the timeline ends.
  end: PlanEnd;
  // Seconds the whole Start lasts before the first step: the parts added up (0 = none). Worked out
  // from `start` whenever a plan is read.
  loading: number;
  // The Start's parts, in order (see start-screen.ts for the presets).
  start: readonly StartPart[];
  steps: readonly PlanStep[];
}>;

export const LANDING_PLAN_TARGET = "landing.plan";
export const DEFAULT_LOADING_SECONDS = 1.2;
// The defaults of a new Scroll plan: its Easing is this curve, and so is its "2nd At easing" with the second one.
export const DEFAULT_CUSTOM_EASING = "0.68, 0, 0.2, 1";
export const DEFAULT_SECOND_CUSTOM_EASING = "0, 0, 0.42, 0.82";
export const DEFAULT_END: PlanEnd = Object.freeze({ hold: 0, mode: "hold" as EndMode, travel: 1.6 });
export const DEFAULT_BLUR: MotionBlur = Object.freeze({ amount: 30, preview: true });
export const EMPTY_PLAN: LandingPlan = Object.freeze({
  blur: DEFAULT_BLUR,
  customEasing: DEFAULT_CUSTOM_EASING,
  easing: "custom" as EasingId,
  secondCustomEasing: DEFAULT_SECOND_CUSTOM_EASING,
  secondEasing: "custom" as EasingId,
  end: DEFAULT_END,
  loading: DEFAULT_LOADING_SECONDS,
  start: Object.freeze([Object.freeze({ color: DEFAULT_START_COLOR, duration: DEFAULT_LOADING_SECONDS, id: "start-1", preset: DEFAULT_START_PRESET })]),
  steps: Object.freeze([]),
});

const MIN_TRAVEL = 0.2;
const MAX_SECONDS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function readLandingPlan(value: unknown): LandingPlan {
  if (!isRecord(value)) return EMPTY_PLAN;
  const steps: PlanStep[] = [];
  // Plans saved before steps were relative stored where each step lands (`y`); those are turned
  // into steps by taking the difference from where the step before it landed.
  let previousFinal = 0;
  if (Array.isArray(value.steps)) {
    value.steps.forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const easing = raw.easing === "plan" ? ("plan" as const) : readEasing(raw.easing);
      const second = readSecond(raw.second);
      const reload = raw.kind === "reload";
      let scroll = 0;
      if (!reload) {
        if (typeof raw.scroll === "number" && Number.isFinite(raw.scroll)) scroll = Math.round(Math.max(-1_000_000, Math.min(1_000_000, raw.scroll)));
        else if (typeof raw.y === "number" && Number.isFinite(raw.y)) scroll = Math.round(raw.y - previousFinal);
      }
      steps.push({
        ...(typeof raw.customEasing === "string" ? { customEasing: raw.customEasing } : {}),
        ...(easing ? { easing } : {}),
        id: typeof raw.id === "string" ? raw.id : `step-${index + 1}`,
        kind: reload ? "reload" : "scroll",
        ...(typeof raw.name === "string" ? { name: raw.name.slice(0, 60) } : {}),
        pause: num(raw.pause, 0.7, 0, MAX_SECONDS),
        scroll,
        second,
        travel: num(raw.travel, 1, 0, MAX_SECONDS),
        ...(typeof raw.waitFor === "string" && raw.waitFor ? { waitFor: raw.waitFor.slice(0, 80) } : {}),
      });
      previousFinal = reload ? 0 : Math.max(0, previousFinal + scroll + (second?.offset ?? 0));
    });
  }
  const start = readStart(value);
  const end = isRecord(value.end) ? value.end : {};
  const blur = isRecord(value.blur) ? value.blur : {};
  const planEasing = readEasing(value.easing) ?? "lenis";
  const planCustom = typeof value.customEasing === "string" && parseBezier(value.customEasing) ? value.customEasing : DEFAULT_CUSTOM_EASING;
  return {
    // A plan saved before the 2nd At had its own default keeps its motion: it starts equal to the plan's easing.
    secondCustomEasing: typeof value.secondCustomEasing === "string" && parseBezier(value.secondCustomEasing) ? value.secondCustomEasing : planCustom,
    secondEasing: readEasing(value.secondEasing) ?? planEasing,
    blur: { amount: Math.round(num(blur.amount, DEFAULT_BLUR.amount, 0, 100)), preview: typeof blur.preview === "boolean" ? blur.preview : DEFAULT_BLUR.preview },
    customEasing: typeof value.customEasing === "string" && parseBezier(value.customEasing) ? value.customEasing : DEFAULT_CUSTOM_EASING,
    easing: readEasing(value.easing) ?? "lenis",
    end: {
      hold: num(end.hold, DEFAULT_END.hold, 0, MAX_SECONDS),
      mode: end.mode === "top" || end.mode === "reload" ? end.mode : "hold",
      travel: num(end.travel, DEFAULT_END.travel, 0, MAX_SECONDS),
    },
    loading: start.reduce((sum, part) => sum + part.duration, 0),
    start,
    steps,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const readColor = (value: unknown): string => (typeof value === "string" && HEX.test(value) ? value.toUpperCase() : DEFAULT_START_COLOR);

// The Start's parts. A plan saved before parts existed has one Start (`loading` seconds, preset
// `loadingStyle`, colour `startColor`), which becomes a single part.
function readStart(value: Record<string, unknown>): StartPart[] {
  if (Array.isArray(value.start)) {
    const parts: StartPart[] = [];
    value.start.forEach((raw, index) => {
      if (!isRecord(raw)) return;
      parts.push({
        color: readColor(raw.color),
        duration: num(raw.duration, 1, 0, 10),
        id: typeof raw.id === "string" ? raw.id : `start-${index + 1}`,
        preset: readStartPreset(raw.preset) ?? DEFAULT_START_PRESET,
      });
    });
    return parts;
  }
  const seconds = num(value.loading, DEFAULT_LOADING_SECONDS, 0, 10);
  if (seconds <= 0) return [];
  return [{ color: readColor(value.startColor), duration: seconds, id: "start-1", preset: readStartPreset(value.loadingStyle) ?? DEFAULT_START_PRESET }];
}

function readSecond(value: unknown): PlanSecond | null {
  if (!isRecord(value)) return null;
  const easing = value.easing === "plan" ? ("plan" as const) : (readEasing(value.easing) ?? ("plan" as const));
  return {
    ...(typeof value.customEasing === "string" ? { customEasing: value.customEasing } : {}),
    delay: num(value.delay, 0.3, 0, MAX_SECONDS),
    easing,
    offset: num(value.offset, 0, -1_000_000, 1_000_000),
    travel: num(value.travel, 1, 0, MAX_SECONDS),
  };
}

export function maxScroll(page: PageInfo): number {
  return Math.max(0, page.height - page.viewport.height);
}

// The plan with a new list of Start parts (and the total worked out from them).
export function withStart(plan: LandingPlan, start: readonly StartPart[]): LandingPlan {
  return { ...plan, loading: start.reduce((sum, part) => sum + part.duration, 0), start };
}

// A new part for the end of the Start: the page's top view still if there is nothing yet, otherwise a spinner.
export function newStartPart(plan: LandingPlan): StartPart {
  return {
    color: DEFAULT_START_COLOR,
    duration: plan.start.length === 0 ? 1 : 1.2,
    id: `start-${Date.now().toString(36)}-${plan.start.length + 1}`,
    preset: plan.start.length === 0 ? "thumbnail" : DEFAULT_START_PRESET,
  };
}

// Which part of the Start is on at `time`, and how far through it (0..1); null once the Start is over.
export function startAt(plan: LandingPlan, time: number): { color: string; index: number; preset: StartPreset; progress: number } | null {
  let from = 0;
  for (let index = 0; index < plan.start.length; index += 1) {
    const part = plan.start[index];
    if (!part || part.duration <= 0) continue;
    if (time < from + part.duration) return { color: part.color, index, preset: part.preset, progress: Math.max(0, (time - from) / part.duration) };
    from += part.duration;
  }
  return null;
}

let counter = 0;
export function newStepId(): string {
  counter += 1;
  return `step-${Date.now().toString(36)}-${counter}`;
}

const clampY = (page: PageInfo, y: number): number => Math.min(maxScroll(page), Math.max(0, Math.round(y)));

// Seconds a move of `distance` px takes: longer moves take longer, within a comfortable range.
export function travelFor(distance: number): number {
  return Math.round(Math.min(1.8, Math.max(0.8, Math.abs(distance) / 1200)) * 10) / 10;
}

// One stop at the top of every section, extra stops inside sections taller than the window, and a
// last stop at the very bottom, as steps: each one the distance from the stop before it.
export function autoSteps(page: PageInfo): PlanStep[] {
  const max = maxScroll(page);
  const view = page.viewport.height;
  const stride = view * 0.85;
  const positions: number[] = [];
  const push = (y: number): void => {
    const value = clampY(page, y);
    if (positions.length === 0 || value - (positions[positions.length - 1] ?? 0) >= 40) positions.push(value);
  };
  for (const section of page.sections) {
    push(section.top);
    if (section.height > view * 1.3) {
      let y = section.top;
      while (y + stride + view * 0.5 < section.top + section.height) {
        y += stride;
        push(y);
      }
    }
  }
  push(max);
  if ((positions[positions.length - 1] ?? 0) < max - 40) positions.push(max);
  if ((positions[0] ?? 0) !== 0) positions.unshift(0);
  return positions.map((y, index) => {
    const previous = index === 0 ? 0 : (positions[index - 1] ?? 0);
    const last = index === positions.length - 1;
    return {
      id: newStepId(),
      kind: "scroll" as const,
      pause: index === 0 ? 1 : last ? 1.2 : 0.7,
      scroll: y - previous,
      second: null,
      travel: index === 0 ? 0 : travelFor(y - previous),
    };
  });
}

// What the project shows: its own steps, or the automatic ones while it has none.
export function effectivePlan(plan: LandingPlan, page: PageInfo): LandingPlan {
  return plan.steps.length > 0 ? plan : { ...plan, steps: autoSteps(page) };
}

export type PlanSegment = Readonly<{
  custom: string;
  easing: EasingId;
  end: number;
  // When the first scroll ends (a second scroll may still be running).
  firstEnd: number;
  // Where the page is when the step starts, and where it lands when the step's motion is over.
  final: number;
  from: number;
  index: number;
  reload: boolean;
  // The nested second scroll, with its own start time, target and easing.
  second: Readonly<{ custom: string; easing: EasingId; start: number; to: number; travel: number }> | null;
  start: number;
  // The first scroll's target.
  to: number;
  // When all the step's motion (both scrolls) is over; the Hold starts here.
  travelEnd: number;
}>;

// Loading comes first (not a segment), then one segment per step, then one for the End. The End has
// index `steps.length`.
export function buildSegments(plan: LandingPlan, limit: number = Number.POSITIVE_INFINITY): { segments: readonly PlanSegment[]; total: number } {
  const segments: PlanSegment[] = [];
  let time = plan.loading;
  let at = 0;
  const clamp = (value: number): number => Math.min(limit, Math.max(0, value));
  plan.steps.forEach((step, index) => {
    const reload = step.kind === "reload";
    const to = reload ? 0 : clamp(at + step.scroll);
    const travel = reload ? 0 : step.travel;
    const own = stepEasing(plan, step);
    let second: PlanSegment["second"] = null;
    let motionEnd = time + travel;
    let final = to;
    if (!reload && step.second) {
      const two = step.second;
      const chosen = two.easing === "plan" ? { custom: plan.secondCustomEasing, id: plan.secondEasing } : { custom: two.customEasing ?? plan.secondCustomEasing, id: two.easing };
      second = { custom: chosen.custom, easing: chosen.id, start: time + two.delay, to: clamp(to + two.offset), travel: two.travel };
      motionEnd = Math.max(motionEnd, second.start + second.travel);
      final = second.to;
    }
    const end = motionEnd + step.pause;
    segments.push({ custom: own.custom, easing: own.id, end, final, firstEnd: time + travel, from: reload ? 0 : at, index, reload, second, start: time, to, travelEnd: motionEnd });
    time = end;
    at = final;
  });
  const { hold, mode, travel } = plan.end;
  const index = plan.steps.length;
  if (mode === "top" && at > 0) {
    const end = time + travel + hold;
    segments.push({ custom: plan.customEasing, easing: plan.easing, end, final: 0, firstEnd: time + travel, from: at, index, reload: false, second: null, start: time, to: 0, travelEnd: time + travel });
    time = end;
  } else if (mode === "reload") {
    segments.push({ custom: plan.customEasing, easing: plan.easing, end: time + hold, final: 0, firstEnd: time, from: 0, index, reload: true, second: null, start: time, to: 0, travelEnd: time });
    time += hold;
  } else if (hold > 0) {
    segments.push({ custom: plan.customEasing, easing: plan.easing, end: time + hold, final: at, firstEnd: time, from: at, index, reload: false, second: null, start: time, to: at, travelEnd: time });
    time += hold;
  }
  return { segments, total: time };
}

// Lenis' own ease: it leaves fast and slows into the stop. Scaled so it ends exactly on the target.
const EXPO_END = 1 - 2 ** -10;
export function lenisEase(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return (1 - 2 ** (-10 * t)) / EXPO_END;
}

// ---- Pasted easing: a CSS cubic-bezier ------------------------------------------------------------

const CSS_EASINGS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  "ease-out": [0, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

// Reads "cubic-bezier(0.22, 1, 0.36, 1)", "0.22 1 0.36 1" or a CSS keyword (ease, ease-in, ease-out,
// ease-in-out, linear). The two x values must be between 0 and 1.
export function parseBezier(text: string): readonly [number, number, number, number] | null {
  const clean = text.trim().toLowerCase();
  const named = CSS_EASINGS[clean];
  if (named) return named;
  const inner = clean.replace(/^cubic-bezier\s*\(/, "").replace(/\)\s*;?$/, "");
  const parts = inner.split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [x1, y1, x2, y2] = numbers as [number, number, number, number];
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
  return [x1, y1, x2, y2];
}

export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let round = 0; round < 8; round += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    while (high - low > 1e-6) {
      if (sampleX(t) < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}

const BACK = 1.70158;

export const EASINGS: readonly Readonly<{ ease: (x: number) => number; hint: string; id: EasingId; label: string }>[] = [
  { ease: lenisEase, hint: "Leaves fast and slows into the stop, like Lenis", id: "lenis", label: "Lenis" },
  { ease: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2), hint: "Soft start and soft stop", id: "smooth", label: "Smooth" },
  { ease: (x) => 1 - (1 - x) ** 3, hint: "Starts at speed, settles gently", id: "out", label: "Ease out" },
  { ease: (x) => x ** 3, hint: "Starts slowly, ends at speed", id: "in", label: "Ease in" },
  { ease: (x) => x, hint: "Even speed all the way", id: "linear", label: "Linear" },
  {
    ease: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
    hint: "Very slow at both ends, fast in the middle",
    id: "expo-in-out",
    label: "Expo in-out",
  },
  { ease: (x) => 1 + (BACK + 1) * (x - 1) ** 3 + BACK * (x - 1) ** 2, hint: "Goes slightly past the stop and comes back", id: "overshoot", label: "Overshoot" },
  { ease: (x) => x, hint: "Paste a cubic-bezier from your own curve", id: "custom", label: "Custom…" },
];

export function readEasing(value: unknown): EasingId | undefined {
  return EASINGS.find((item) => item.id === value)?.id;
}

export function applyEasing(id: EasingId, x: number, custom: string = DEFAULT_CUSTOM_EASING): number {
  const t = Math.min(1, Math.max(0, x));
  if (id === "custom") {
    const bezier = parseBezier(custom) ?? parseBezier(DEFAULT_CUSTOM_EASING);
    return bezier ? cubicBezierEase(...bezier)(t) : t;
  }
  return (EASINGS.find((item) => item.id === id) ?? EASINGS[0])?.ease(t) ?? t;
}

// The easing a step runs with: its own, or the plan's.
export function stepEasing(plan: LandingPlan, step: PlanStep): { custom: string; id: EasingId } {
  const own = step.easing && step.easing !== "plan" ? step.easing : null;
  return own ? { custom: step.customEasing ?? plan.customEasing, id: own } : { custom: plan.customEasing, id: plan.easing };
}

export type ScrollState = Readonly<{
  // 0..1 while the loading screen shows, null afterwards.
  loading: number | null;
  // The step being run (or last run).
  step: number;
  y: number;
}>;

export function evaluateScroll(plan: LandingPlan, page: PageInfo, time: number): ScrollState {
  if (plan.loading > 0 && time < plan.loading) return { loading: Math.max(0, time / plan.loading), step: -1, y: 0 };
  const { segments } = buildSegments(plan, maxScroll(page));
  const last = segments[segments.length - 1];
  if (!last) return { loading: null, step: -1, y: 0 };
  const segment = segments.find((item) => time < item.end) ?? last;
  // Where the first scroll has got to at `at`.
  const firstAt = (at: number): number => {
    if (at >= segment.firstEnd) return segment.to;
    const span = Math.max(MIN_TRAVEL, segment.firstEnd - segment.start);
    return segment.from + (segment.to - segment.from) * applyEasing(segment.easing, (at - segment.start) / span, segment.custom);
  };
  let y = segment.final;
  if (!segment.reload) {
    const second = segment.second;
    if (second && time >= second.start) {
      // The second scroll takes over from wherever the first one has got to, so nothing jumps.
      if (time >= second.start + second.travel) y = second.to;
      else {
        const origin = firstAt(second.start);
        y = origin + (second.to - origin) * applyEasing(second.easing, (time - second.start) / Math.max(MIN_TRAVEL, second.travel), second.custom);
      }
    } else {
      y = firstAt(time);
    }
  }
  return { loading: null, step: segment.index, y: Math.min(maxScroll(page), Math.max(0, y)) };
}

// How long the smear is, in page pixels, at `time`: the scroll speed over the shutter. 0 while the page is
// still, during the Start, or when the preview has it switched off (`forPreview`); a render always has it.
export function motionBlurLength(plan: LandingPlan, page: PageInfo, time: number, forPreview: boolean): number {
  if (plan.blur.amount <= 0 || (forPreview && !plan.blur.preview)) return 0;
  const step = 1 / 120;
  const before = evaluateScroll(plan, page, Math.max(0, time - step));
  const after = evaluateScroll(plan, page, time + step);
  if (before.loading !== null || after.loading !== null) return 0;
  const speed = Math.abs(after.y - before.y) / (2 * step);
  return (speed * plan.blur.amount) / 100 / 30;
}

// A typed number or sum: "832", "832+100", "1200/2", "(300+200)*2-50". `+`, `-`, `*` (or x), `/` and
// brackets. A leading `+`, `*` or `/` works on `current` ("+50" adds 50, "*2" doubles it); a leading `-`
// is a negative number. Null when it does not read as a number (or divides by zero).
export function evaluateExpression(text: string, current: number): number | null {
  if (/[\d.]\s+[\d.]/.test(text)) return null;
  let source = text.replace(/\s+/g, "").replace(/[x×]/gi, "*").replace(/÷/g, "/").replace(/,/g, ".");
  if (source === "") return null;
  if (/^[+*/]/.test(source)) source = `(${current})${source}`;
  let at = 0;
  let failed = false;
  const peek = (): string => source[at] ?? "";
  const number = (): number => {
    const found = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(source.slice(at));
    if (!found) {
      failed = true;
      return 0;
    }
    at += found[0].length;
    return Number.parseFloat(found[0]);
  };
  const factor = (): number => {
    if (peek() === "-") {
      at += 1;
      return -factor();
    }
    if (peek() === "+") {
      at += 1;
      return factor();
    }
    if (peek() === "(") {
      at += 1;
      const inner = sum();
      if (peek() === ")") at += 1;
      else failed = true;
      return inner;
    }
    return number();
  };
  const product = (): number => {
    let result = factor();
    while (!failed && (peek() === "*" || peek() === "/")) {
      const operator = source[at++];
      const right = factor();
      if (operator === "/" && right === 0) failed = true;
      result = operator === "*" ? result * right : result / right;
    }
    return result;
  };
  function sum(): number {
    let result = product();
    while (!failed && (peek() === "+" || peek() === "-")) {
      const operator = source[at++];
      const right = product();
      result = operator === "+" ? result + right : result - right;
    }
    return result;
  }
  const value = sum();
  return failed || at < source.length || !Number.isFinite(value) ? null : value;
}

export function withBlur(plan: LandingPlan, patch: Partial<MotionBlur>): LandingPlan {
  return { ...plan, blur: { ...plan.blur, ...patch } };
}

export function planDuration(plan: LandingPlan): number {
  return Math.max(1, Math.ceil(buildSegments(plan).total * 10) / 10);
}

// The section a position falls in.
export function sectionAt(page: PageInfo, y: number): string {
  const found = [...page.sections].reverse().find((section) => y >= section.top - 1);
  return found ? found.name : "";
}

export function replaceStep(plan: LandingPlan, index: number, patch: Partial<PlanStep>): LandingPlan {
  return { ...plan, steps: plan.steps.map((item, at) => (at === index ? { ...item, ...patch } : item)) };
}

export function duplicateStep(plan: LandingPlan, index: number): LandingPlan {
  const step = plan.steps[index];
  if (!step) return plan;
  const copy: PlanStep = { ...step, id: newStepId(), second: step.second ? { ...step.second } : step.second };
  const steps = [...plan.steps];
  steps.splice(index + 1, 0, copy);
  return { ...plan, steps };
}

// Moves a step from one place to another (both are step indexes); the others keep their order.
export function moveStep(plan: LandingPlan, from: number, to: number): LandingPlan {
  if (from === to || from < 0 || to < 0 || from >= plan.steps.length || to >= plan.steps.length) return plan;
  const steps = [...plan.steps];
  const [moved] = steps.splice(from, 1);
  if (!moved) return plan;
  steps.splice(to, 0, moved);
  return { ...plan, steps };
}

function withAbsoluteStepDestinations(plan: LandingPlan, steps: PlanStep[], destinations: number[], limit: number): LandingPlan {
  let previousFinal = 0;
  const ordered = steps.map((step, index) => {
    if (step.kind === "reload") {
      previousFinal = 0;
      return step;
    }
    const target = destinations[index] ?? previousFinal;
    const scroll = Math.round(target - previousFinal);
    previousFinal = Math.min(limit, Math.max(0, target + (step.second?.offset ?? 0)));
    return { ...step, scroll };
  });
  return { ...plan, steps: ordered };
}

// A Section Animation preset moves together with the scroll step that reveals it.
// Scroll distances are relative, so retain every step's absolute destination when
// changing order; otherwise the moved preset could play while its section is offscreen.
export function moveSectionPresetStep(plan: LandingPlan, page: PageInfo, fromKey: string, fromSection: string, toKey: string, toSection: string): LandingPlan {
  if (fromKey === toKey) return plan;
  const limit = maxScroll(page);
  const steps = [...plan.steps];
  const destination = (sectionName: string): number => Math.min(limit, Math.max(0, Math.round(page.sections.find((section) => section.name === sectionName)?.top ?? 0)));
  const ensure = (key: string, sectionName: string): number => {
    const existing = steps.findIndex((step) => step.waitFor === key);
    if (existing >= 0) return existing;
    const last = buildSegments({ ...plan, steps }, limit).segments[steps.length - 1]?.final ?? 0;
    steps.push({ id: newStepId(), kind: "scroll", pause: 0.5, scroll: destination(sectionName) - last, second: null, travel: travelFor(destination(sectionName) - last), waitFor: key });
    return steps.length - 1;
  };
  ensure(fromKey, fromSection);
  ensure(toKey, toSection);
  const before = buildSegments({ ...plan, steps }, limit).segments.slice(0, steps.length).map((segment) => segment.to);
  const from = steps.findIndex((step) => step.waitFor === fromKey);
  const to = steps.findIndex((step) => step.waitFor === toKey);
  if (from < 0 || to < 0 || from === to) return { ...plan, steps };
  const [movedStep] = steps.splice(from, 1);
  const [movedDestination] = before.splice(from, 1);
  if (!movedStep || movedDestination === undefined) return plan;
  steps.splice(to, 0, movedStep);
  before.splice(to, 0, movedDestination);
  return withAbsoluteStepDestinations(plan, steps, before, limit);
}

export function duplicateSectionPresetStep(plan: LandingPlan, page: PageInfo, sourceKey: string, copyKey: string, sectionName: string): LandingPlan {
  const limit = maxScroll(page);
  const steps = [...plan.steps];
  const destinations = buildSegments(plan, limit).segments.slice(0, steps.length).map((segment) => segment.to);
  const source = steps.findIndex((step) => step.waitFor === sourceKey);
  const target = Math.min(limit, Math.max(0, Math.round(page.sections.find((section) => section.name === sectionName)?.top ?? 0)));
  const copy: PlanStep = source >= 0
    ? { ...steps[source]!, id: newStepId(), scroll: 0, second: null, waitFor: copyKey }
    : { id: newStepId(), kind: "scroll", pause: 0.5, scroll: 0, second: null, travel: 0.8, waitFor: copyKey };
  const insertAt = source >= 0 ? source + 1 : steps.length;
  steps.splice(insertAt, 0, copy);
  destinations.splice(insertAt, 0, target);
  return withAbsoluteStepDestinations(plan, steps, destinations, limit);
}

// Takes a step out. Steps scroll relative to the one before, so the step after takes over the removed
// distance: every step that is left keeps landing exactly where it did.
export function removeStep(plan: LandingPlan, index: number, limit: number = Number.POSITIVE_INFINITY): LandingPlan {
  if (!plan.steps[index]) return plan;
  const steps = plan.steps.filter((_, at) => at !== index);
  const next = plan.steps[index + 1];
  if (next && next.kind === "scroll") {
    const { segments } = buildSegments(plan, limit);
    const before = index > 0 ? (segments[index - 1]?.final ?? 0) : 0;
    const landing = segments[index + 1]?.to ?? 0;
    steps[index] = { ...next, scroll: Math.round(landing - before) };
  }
  return { ...plan, steps };
}

// Adds a step at the end. "scroll" and "back" are a screenful down or up; "top" is however far it
// takes to get back to the top from where the plan has got to; "reload" cuts to the top.
export function addStep(plan: LandingPlan, page: PageInfo, kind: "back" | "forward" | "reload" | "scroll" | "top"): LandingPlan {
  const { segments } = buildSegments(plan, maxScroll(page));
  const from = segments[plan.steps.length - 1]?.final ?? 0;
  const stride = Math.round(page.viewport.height * 0.85);
  if (kind === "reload") return { ...plan, steps: [...plan.steps, { id: newStepId(), kind: "reload", pause: 0.7, scroll: 0, second: null, travel: 0 }] };
  const scroll = kind === "top" ? -from : kind === "back" ? -stride : stride;
  return { ...plan, steps: [...plan.steps, { id: newStepId(), kind: "scroll", pause: 0.7, scroll, second: null, travel: travelFor(scroll) }] };
}
