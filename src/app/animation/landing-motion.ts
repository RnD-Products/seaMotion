import type { PageInfo } from "./animation-spec";
import { applyEasing, buildSegments, EASINGS, evaluateScroll, type EasingId, type LandingPlan, type PlanSegment } from "./landing-plan";

// Section animation of a Landing Page: when a section comes into view its layers move in one after another
// (fade, blur, scale, slide) and some keep a loop going (float, rotate, pulse). The settings are saved per
// project, under the name of the section ("Hero").

export const LANDING_SECTIONS_TARGET = "landing.sections";

export type MotionSlide = "none" | "bottom" | "top" | "left" | "right";
export type MotionLoop = "none" | "float" | "rotate" | "floatRotate" | "pulse";
export type MotionTrigger = "start" | "view";
export type MotionEasing = Exclude<EasingId, "custom">;
export const MOTION_EASINGS = EASINGS.filter((entry): entry is (typeof EASINGS)[number] & { id: MotionEasing } => entry.id !== "custom");

export type MotionItem = Readonly<{
  // Blur (px) the layer starts with and loses while it moves in; 0 is none.
  blur: number;
  // Extra seconds before this layer starts.
  delay: number;
  // How far (px) the layer slides in from `slide`.
  distance: number;
  // Seconds the entry takes.
  duration: number;
  // Preset curve used by this layer's fade, blur, scale, and slide entry.
  easing: MotionEasing;
  // The layer fades in.
  fade: boolean;
  id: string;
  // The id of the layer (a leaf of the section) that moves.
  layer: string;
  loop: MotionLoop;
  // The card's own name; missing means the name of its layer.
  name?: string;
  // Percent the layer starts at (100 is no scale).
  scale: number;
  slide: MotionSlide;
  // Starts together with the layer before it instead of one stagger later.
  withPrevious: boolean;
}>;

export type SectionMotion = Readonly<{
  // Set on a copy: the page section whose layers it moves. A section's own animation has none (its key is the section's name).
  section?: string;
  // The name shown for the section in the picker; missing means the section's own name.
  label?: string;
  // Master delay: seconds the whole section waits before its first layer starts.
  delay: number;
  enabled: boolean;
  // Items start this many seconds after each other.
  stagger: number;
  // "start": right after the Start (preloader) ends. "view": when the section scrolls into view.
  trigger: MotionTrigger;
  items: readonly MotionItem[];
}>;

export type SectionMotions = Readonly<Record<string, SectionMotion>>;

export const DEFAULT_STAGGER = 0.05;
export const DEFAULT_ITEM: Omit<MotionItem, "id" | "layer"> = Object.freeze({
  blur: 0,
  delay: 0,
  distance: 40,
  duration: 0.8,
  easing: "out" as MotionEasing,
  fade: true,
  loop: "none" as MotionLoop,
  scale: 100,
  slide: "none" as MotionSlide,
  withPrevious: false,
});

const SLIDES: readonly MotionSlide[] = ["none", "bottom", "top", "left", "right"];
const LOOPS: readonly MotionLoop[] = ["none", "float", "rotate", "floatRotate", "pulse"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readItem(raw: unknown, index: number): MotionItem | null {
  if (!isRecord(raw) || typeof raw.layer !== "string" || raw.layer === "") return null;
  return {
    blur: num(raw.blur, 0, 0, 100),
    delay: num(raw.delay, 0, 0, 20),
    distance: num(raw.distance, DEFAULT_ITEM.distance, 0, 1000),
    duration: num(raw.duration, DEFAULT_ITEM.duration, 0.05, 20),
    easing: MOTION_EASINGS.find((entry) => entry.id === raw.easing)?.id ?? "out",
    fade: typeof raw.fade === "boolean" ? raw.fade : true,
    id: typeof raw.id === "string" ? raw.id : `motion-${index + 1}`,
    layer: raw.layer,
    loop: LOOPS.find((item) => item === raw.loop) ?? "none",
    ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim().slice(0, 60) } : {}),
    scale: num(raw.scale, 100, 10, 300),
    slide: SLIDES.find((item) => item === raw.slide) ?? "none",
    withPrevious: raw.withPrevious === true,
  };
}

export function readSectionMotions(value: unknown): SectionMotions {
  if (!isRecord(value)) return {};
  const result: Record<string, SectionMotion> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const items = (Array.isArray(raw.items) ? raw.items : []).map(readItem).filter((item): item is MotionItem => item !== null);
    result[name] = {
      ...(typeof raw.section === "string" && raw.section ? { section: raw.section } : {}),
      ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim().slice(0, 60) } : {}),
      delay: num(raw.delay, 0, 0, 60),
      enabled: raw.enabled === true,
      items,
      stagger: num(raw.stagger, DEFAULT_STAGGER, 0, 5),
      trigger: raw.trigger === "view" ? "view" : "start",
    };
  }
  return result;
}

export const EMPTY_MOTION: SectionMotion = Object.freeze({ delay: 0, enabled: false, items: Object.freeze([]), stagger: DEFAULT_STAGGER, trigger: "start" as MotionTrigger });

let counter = 0;
export function newMotionItem(layer: string, patch: Partial<MotionItem> = {}): MotionItem {
  counter += 1;
  return { ...DEFAULT_ITEM, id: `motion-${Date.now().toString(36)}-${counter}`, layer, ...patch };
}

// Seconds after the section starts that each item starts: one stagger per item, except an item that goes
// with the one before it.
export function itemOffsets(motion: SectionMotion): number[] {
  let step = -1;
  return motion.items.map((item, index) => {
    if (!(item.withPrevious && index > 0)) step += 1;
    return step * motion.stagger + item.delay;
  });
}

export function moveMotionItem(motion: SectionMotion, from: number, to: number): SectionMotion {
  if (from === to || !motion.items[from] || !motion.items[to]) return motion;
  const items = [...motion.items];
  const [moved] = items.splice(from, 1);
  if (!moved) return motion;
  items.splice(to, 0, moved);
  return { ...motion, items };
}

export type LayerFx = Readonly<{ blur: number; dx: number; dy: number; opacity: number; rotate: number; scale: number }>;

// How one item looks `since` seconds after its section started.
export function itemFx(item: MotionItem, offset: number, since: number): LayerFx {
  const local = since - offset;
  if (local < 0) return { blur: item.blur, dx: 0, dy: 0, opacity: 0, rotate: 0, scale: item.scale / 100 };
  const progress = Math.min(1, local / item.duration);
  const e = applyEasing(item.easing, progress);
  const settled = Math.min(1, Math.max(0, e));
  const away = (1 - e) * item.distance;
  const dx = item.slide === "left" ? -away : item.slide === "right" ? away : 0;
  let dy = item.slide === "top" ? -away : item.slide === "bottom" ? away : 0;
  let rotate = 0;
  let scale = item.scale / 100 + (1 - item.scale / 100) * e;
  let opacity = item.fade ? settled : 1;
  // Loops start from nothing as the entry finishes, so nothing jumps.
  const settle = settled * settled;
  const turn = (local * Math.PI * 2);
  if (item.loop === "float" || item.loop === "floatRotate") dy += Math.sin(turn / 3.2) * 7 * settle;
  if (item.loop === "rotate" || item.loop === "floatRotate") rotate += Math.sin(turn / 4.5) * 9 * settle;
  if (item.loop === "pulse") {
    const wave = 0.5 + 0.5 * Math.sin(turn / 1.6);
    scale *= 1 + 0.22 * wave * settle;
    opacity *= 1 - 0.45 * (1 - wave) * settle;
  }
  return { blur: item.blur * (1 - settled), dx, dy, opacity, rotate, scale };
}

// The first moment the scroll has brought the section's top into the lower part of the page window; null when
// it never gets there.
function firstReach(plan: LandingPlan, page: PageInfo, sectionTop: number, total: number): number | null {
  const line = page.viewport.height * 0.85;
  const step = 0.05;
  for (let time = plan.loading; time <= total + step; time += step) {
    if (evaluateScroll(plan, page, time).y + line >= sectionTop) return time;
  }
  return null;
}

// When the section's motion starts, in timeline seconds: right after the Start, or when the section's top has
// come into the lower part of the page window (the first moment the scroll gets it there).
const startMemo = new WeakMap<LandingPlan, Map<string, number>>();
export function sectionStart(trigger: MotionTrigger, plan: LandingPlan, page: PageInfo, sectionTop: number, total: number): number {
  const afterStart = plan.loading;
  if (trigger === "start") return afterStart;
  const key = `${page.height}|${page.viewport.height}|${sectionTop}|${total}`;
  const memo = startMemo.get(plan) ?? new Map<string, number>();
  startMemo.set(plan, memo);
  const known = memo.get(key);
  if (known !== undefined) return known;
  const found = firstReach(plan, page, sectionTop, total) ?? afterStart;
  memo.set(key, found);
  return found;
}

// How long a section's own animation runs from its start: the master delay plus the last entry finishing.
export function motionLength(motion: SectionMotion): number {
  const offsets = itemOffsets(motion);
  return motion.delay + motion.items.reduce((most, item, at) => Math.max(most, (offsets[at] ?? 0) + item.duration), 0);
}

// The preset's actual time on the shared timeline. A Scroll Plan reveal wins over its
// fallback Start/in-view trigger, exactly as it does for the rendered layer effects.
export function motionRange(key: string, motion: SectionMotion, plan: LandingPlan, page: PageInfo, total: number, segments?: readonly PlanSegment[]): readonly [number, number] | null {
  const section = page.sections.find((item) => item.name === (motion.section ?? key));
  if (!section || !motion.enabled || motion.items.length === 0) return null;
  const revealing = plan.steps.findIndex((step) => step.waitFor === key);
  const revealAt = revealing >= 0 ? (segments ?? buildSegments(plan).segments)[revealing]?.start : undefined;
  const start = (revealAt ?? sectionStart(motion.trigger, plan, page, section.top, total)) + motion.delay;
  return [start, start + motionLength(motion) - motion.delay];
}

// A layer card's actual interval on the shared plan, including its preset delay,
// stagger, own delay, and Same time relationship to the preceding layer.
export function layerMotionRange(key: string, motion: SectionMotion, itemId: string, plan: LandingPlan, page: PageInfo, total: number, segments?: readonly PlanSegment[]): readonly [number, number] | null {
  const preset = motionRange(key, motion, plan, page, total, segments);
  const index = motion.items.findIndex((item) => item.id === itemId);
  if (!preset || index < 0) return null;
  const item = motion.items[index]!;
  const start = preset[0] + (itemOffsets(motion)[index] ?? 0);
  return [start, start + item.duration];
}

// The plan with every step's "wait for a section animation" turned into extra Hold: the Hold of such a step starts
// once the named section's animation is over. Steps are settled in order, since a longer Hold moves everything after it.
const waitMemo = new WeakMap<LandingPlan, WeakMap<object, Map<string, LandingPlan>>>();
export function withWaits(plan: LandingPlan, page: PageInfo, motions: SectionMotions): LandingPlan {
  if (!plan.steps.some((step) => step.waitFor)) return plan;
  const byMotions = waitMemo.get(plan) ?? new WeakMap<object, Map<string, LandingPlan>>();
  waitMemo.set(plan, byMotions);
  const byPage = byMotions.get(motions) ?? new Map<string, LandingPlan>();
  byMotions.set(motions, byPage);
  const pageKey = `${page.height}|${page.viewport.height}`;
  const hit = byPage.get(pageKey);
  if (hit) return hit;
  const steps = [...plan.steps];
  steps.forEach((step, index) => {
    if (!step.waitFor) return;
    const motion = motions[step.waitFor];
    const section = page.sections.find((item) => item.name === (motion?.section ?? step.waitFor));
    if (!motion || !motion.enabled || motion.items.length === 0 || !section) return;
    const partial: LandingPlan = { ...plan, steps: steps.slice(0, index + 1) };
    const { segments } = buildSegments(partial);
    const travelEnd = segments[index]?.travelEnd ?? 0;
    // A revealed section starts together with this step's scroll.
    const began = segments[index]?.start ?? plan.loading;
    // The saved pause is the Hold itself. Keep the step open until both its scroll and
    // its section animation finish, then let that full Hold run before the next step.
    const holdStart = Math.max(travelEnd, began + motionLength(motion));
    const animationWait = holdStart - travelEnd;
    if (animationWait > 0) steps[index] = { ...step, pause: step.pause + animationWait };
  });
  const result: LandingPlan = { ...plan, steps };
  byPage.set(pageKey, result);
  return result;
}

// The look of every moving layer at `time`, keyed by layer id; null when nothing moves.
export function allFx(motions: SectionMotions, plan: LandingPlan, page: PageInfo, time: number, total: number): Record<string, LayerFx> | null {
  let result: Record<string, LayerFx> | null = null;
  const segments = buildSegments(plan).segments;
  const scheduled = Object.entries(motions).map(([key, motion]) => ({ key, motion, range: motionRange(key, motion, plan, page, total, segments) }))
    .filter((entry): entry is { key: string; motion: SectionMotion; range: readonly [number, number] } => entry.range !== null)
    .sort((a, b) => a.range[0] - b.range[0]);
  for (const { motion, range } of scheduled) {
    const start = range[0];
    const offsets = itemOffsets(motion);
    // The Start's thumbnail is a still of the finished page, so the layers sit in place while it shows.
    const first = plan.start[0];
    const thumbnail = motion.trigger === "start" && first?.preset === "thumbnail" && time < first.duration;
    motion.items.forEach((item, index) => {
      result ??= {};
      // A future copy must not hide an earlier preset's currently visible layer.
      if (time < start + (offsets[index] ?? 0) && result[item.layer]) return;
      result[item.layer] = thumbnail ? { blur: 0, dx: 0, dy: 0, opacity: 1, rotate: 0, scale: 1 } : itemFx(item, offsets[index] ?? 0, time - start);
    });
  }
  return result;
}

// The layers under every group that has a motion card, keyed by the group's id: the page script moves them as one.
export function motionGroups(motions: SectionMotions, layers: readonly Readonly<{ id: string; kind?: string; parentGroupId?: string }>[], frames: ReadonlySet<string> = new Set()): Record<string, string[]> | null {
  const wanted = new Set<string>();
  for (const motion of Object.values(motions)) {
    if (!motion.enabled) continue;
    for (const item of motion.items) if (layers.some((layer) => layer.id === item.layer && layer.kind === "group")) wanted.add(item.layer);
  }
  if (wanted.size === 0) return null;
  const children = new Map<string, typeof layers[number][]>();
  for (const layer of layers) if (layer.parentGroupId) children.set(layer.parentGroupId, [...(children.get(layer.parentGroupId) ?? []), layer]);
  const result: Record<string, string[]> = {};
  for (const id of wanted) {
    const members: string[] = [];
    const walk = (parent: string): void => {
      for (const child of children.get(parent) ?? []) {
        if (child.kind === "group") {
          if (frames.has(child.id)) members.push(child.id);
          walk(child.id);
        } else members.push(child.id);
      }
    };
    if (frames.has(id)) members.push(id);
    walk(id);
    result[id] = members;
  }
  return result;
}
