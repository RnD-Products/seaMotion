import { describe, expect, it } from "vitest";

import type { PageInfo } from "./animation-spec";
import {
  addStep,
  applyEasing,
  autoSteps,
  buildSegments,
  cubicBezierEase,
  duplicateSectionPresetStep,
  EASINGS,
  effectivePlan,
  evaluateScroll,
  lenisEase,
  maxScroll,
  moveSectionPresetStep,
  parseBezier,
  planDuration,
  readLandingPlan,
  removeStep,
  replaceStep,
  sectionAt,
  startAt,
  newStartPart,
  withStart,
} from "./landing-plan";

const PAGE: PageInfo = {
  height: 8825,
  sections: [
    { height: 832, id: "hero", name: "Hero", top: 0 },
    { height: 1002, id: "how", name: "How it Works", top: 832 },
    { height: 745, id: "testimonial", name: "Testimonial", top: 1834 },
    { height: 1952, id: "service", name: "Service", top: 2579 },
    { height: 684, id: "benefits", name: "Benefits", top: 4531 },
    { height: 976, id: "footer", name: "Footer", top: 7849 },
  ],
  viewport: { height: 832, width: 1280 },
};
const MAX = 8825 - 832;

// Where each step lands, worked out by adding the steps up.
const landings = (plan: ReturnType<typeof readLandingPlan>): number[] => buildSegments(plan, MAX).segments.slice(0, plan.steps.length).map((segment) => segment.final);

describe("relative scroll steps", () => {
  it("moves a preset's scroll step while preserving every section destination", () => {
    const plan = readLandingPlan({ loading: 0, steps: [
      { id: "hero", scroll: 0, waitFor: "Hero" },
      { id: "how", scroll: 832, second: { delay: 0.3, easing: "plan", offset: 100, travel: 1 }, waitFor: "How it Works" },
      { id: "testimonial", scroll: 902, waitFor: "Testimonial" },
    ] });
    const moved = moveSectionPresetStep(plan, PAGE, "Testimonial", "Testimonial", "Hero", "Hero");
    expect(moved.steps.map((step) => step.waitFor)).toEqual(["Testimonial", "Hero", "How it Works"]);
    expect(buildSegments(moved, MAX).segments.slice(0, 3).map((segment) => segment.to)).toEqual([1834, 0, 832]);
    expect(buildSegments(moved, MAX).segments[2]?.final).toBe(932);
  });

  it("links a previously unlinked preset to a new scroll step when reordered", () => {
    const plan = readLandingPlan({ loading: 0, steps: [{ id: "hero", scroll: 0, waitFor: "Hero" }, { id: "footer", scroll: 7849, waitFor: "Footer" }] });
    const moved = moveSectionPresetStep(plan, PAGE, "Benefits", "Benefits", "Footer", "Footer");
    expect(moved.steps.map((step) => step.waitFor)).toEqual(["Hero", "Benefits", "Footer"]);
    expect(buildSegments(moved, MAX).segments.slice(0, 3).map((segment) => segment.to)).toEqual([0, 4531, 7849]);
  });

  it("duplicates a preset into a real scroll step without moving later destinations", () => {
    const plan = readLandingPlan({ loading: 0, steps: [{ id: "hero", scroll: 0, waitFor: "Hero" }, { id: "how", scroll: 832, waitFor: "How it Works" }] });
    const next = duplicateSectionPresetStep(plan, PAGE, "Hero", "Hero copy", "Hero");
    expect(next.steps.map((step) => step.waitFor)).toEqual(["Hero", "Hero copy", "How it Works"]);
    expect(buildSegments(next, MAX).segments.slice(0, 3).map((segment) => segment.to)).toEqual([0, 0, 832]);
  });

  it("lands each step by adding its scroll to where the page already is", () => {
    const plan = readLandingPlan({
      loading: 0,
      steps: [
        { id: "a", kind: "scroll", pause: 0, scroll: 400, travel: 1 },
        { id: "b", kind: "scroll", pause: 0, scroll: 400, travel: 1 },
        { id: "c", kind: "scroll", pause: 0, scroll: -450, travel: 1 },
      ],
    });
    expect(landings(plan)).toEqual([400, 800, 350]);
  });

  it("scrolls forward for a positive value and backward for a negative one, in real time", () => {
    const plan = readLandingPlan({
      easing: "linear",
      loading: 0,
      steps: [
        { id: "a", kind: "scroll", pause: 0, scroll: 1000, travel: 2 },
        { id: "b", kind: "scroll", pause: 0, scroll: -450, travel: 1 },
      ],
    });
    expect(evaluateScroll(plan, PAGE, 1).y).toBeCloseTo(500, 0);
    expect(evaluateScroll(plan, PAGE, 2).y).toBeCloseTo(1000, 0);
    expect(evaluateScroll(plan, PAGE, 2.5).y).toBeCloseTo(775, 0);
    expect(evaluateScroll(plan, PAGE, 3).y).toBeCloseTo(550, 0);
  });

  it("changing one step moves every step after it, since they follow from it", () => {
    const base = readLandingPlan({ loading: 0, steps: [{ id: "a", scroll: 400 }, { id: "b", scroll: 300 }, { id: "c", scroll: 200 }] });
    expect(landings(base)).toEqual([400, 700, 900]);
    expect(landings(replaceStep(base, 0, { scroll: 600 }))).toEqual([600, 900, 1100]);
  });

  it("keeps the page inside its limits, and later steps carry on from where it stopped", () => {
    const plan = readLandingPlan({ loading: 0, steps: [{ id: "a", scroll: 9000 }, { id: "b", scroll: -100 }, { id: "c", scroll: -20000 }, { id: "d", scroll: 50 }] });
    expect(landings(plan)).toEqual([MAX, MAX - 100, 0, 50]);
  });

  it("starts from a Reload at the top", () => {
    const plan = readLandingPlan({ loading: 0, steps: [{ id: "a", scroll: 900 }, { id: "r", kind: "reload" }, { id: "b", scroll: 300 }] });
    expect(landings(plan)).toEqual([900, 0, 300]);
  });

  it("turns a plan saved with page positions into steps", () => {
    const old = readLandingPlan({ loading: 0, steps: [{ id: "a", kind: "scroll", y: 832 }, { id: "b", kind: "scroll", y: 1834 }, { id: "c", kind: "scroll", y: 1500 }] });
    expect(old.steps.map((step) => step.scroll)).toEqual([832, 1002, -334]);
    expect(landings(old)).toEqual([832, 1834, 1500]);
    // a second scroll saved with the old plan counts towards where the step really landed
    const withSecond = readLandingPlan({ loading: 0, steps: [{ id: "a", y: 500, second: { delay: 0.2, offset: 100, travel: 1 } }, { id: "b", y: 1000 }] });
    expect(withSecond.steps.map((step) => step.scroll)).toEqual([500, 400]);
    // new data wins over old
    expect(readLandingPlan({ steps: [{ id: "a", scroll: 120, y: 999 }] }).steps[0]?.scroll).toBe(120);
  });

  it("makes automatic steps from the top to the very bottom", () => {
    const steps = autoSteps(PAGE);
    const plan = readLandingPlan({ loading: 0, steps });
    const stops = landings(plan);
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBe(MAX);
    for (let index = 1; index < stops.length; index += 1) expect(stops[index]!).toBeGreaterThan(stops[index - 1]!);
    expect(stops).toEqual(expect.arrayContaining([832, 1834, 2579, 4531]));
    expect(steps.every((step) => step.kind === "scroll" && step.scroll >= 0)).toBe(true);
    expect(stops.filter((stop) => stop > 2579 && stop < 4531).length).toBeGreaterThan(0);
  });

  it("uses the automatic steps while the project has none", () => {
    expect(effectivePlan(readLandingPlan({}), PAGE).steps.length).toBeGreaterThan(5);
    expect(readLandingPlan(undefined).steps).toEqual([]);
  });

  it("names the section a step lands in", () => {
    expect(sectionAt(PAGE, 0)).toBe("Hero");
    expect(sectionAt(PAGE, 1900)).toBe("Testimonial");
  });

  it("adds a step down, a step back, a scroll to the top and a reload", () => {
    let plan = readLandingPlan({ loading: 0, steps: [{ id: "a", scroll: 2000 }] });
    plan = addStep(plan, PAGE, "scroll");
    expect(plan.steps[1]?.scroll).toBe(707);
    plan = addStep(plan, PAGE, "back");
    expect(plan.steps[2]?.scroll).toBe(-707);
    plan = addStep(plan, PAGE, "top");
    expect(landings(plan)[3]).toBe(0);
    expect(plan.steps[3]?.scroll).toBe(-2000);
    plan = addStep(plan, PAGE, "reload");
    expect(plan.steps[4]?.kind).toBe("reload");
    expect(removeStep(plan, 4).steps).toHaveLength(4);
    expect(evaluateScroll(plan, PAGE, planDuration(plan)).y).toBe(0);
  });
});

describe("timing, easing and the Start / End", () => {
  it("shows the Start first, then scrolls exactly to each step", () => {
    const plan = effectivePlan(readLandingPlan({ loading: 1 }), PAGE);
    expect(evaluateScroll(plan, PAGE, 0.5)).toMatchObject({ loading: 0.5, y: 0 });
    const { segments, total } = buildSegments(plan, MAX);
    for (const segment of segments) expect(evaluateScroll(plan, PAGE, segment.end - 0.001).y).toBeCloseTo(segment.final, 0);
    expect(evaluateScroll(plan, PAGE, total + 5).y).toBe(MAX);
    expect(planDuration(plan)).toBeGreaterThanOrEqual(total);
  });

  it("has easing presets that start at 0 and end at 1, and a step can override the plan's", () => {
    for (const item of EASINGS) {
      expect(applyEasing(item.id, 0)).toBeCloseTo(0, 6);
      expect(applyEasing(item.id, 1)).toBeCloseTo(1, 6);
    }
    expect(lenisEase(0.1)).toBeGreaterThan(0.5);
    expect(applyEasing("overshoot", 0.8)).toBeGreaterThan(1);
    const plan = readLandingPlan({ easing: "linear", loading: 0, steps: [{ easing: "in", id: "a", pause: 1, scroll: 1000, travel: 2 }, { id: "b", pause: 1, scroll: 1000, travel: 2 }] });
    expect(evaluateScroll(plan, PAGE, 1).y).toBeCloseTo(125, 0);
    expect(evaluateScroll(plan, PAGE, 4).y).toBeCloseTo(1500, 0);
    const reset = readLandingPlan({ easing: "linear", loading: 0, steps: [{ easing: "plan", id: "a", pause: 1, scroll: 1000, travel: 2 }] });
    expect(evaluateScroll(reset, PAGE, 1).y).toBeCloseTo(500, 0);
  });

  it("reads a pasted cubic-bezier in the usual forms and rejects nonsense", () => {
    expect(parseBezier("cubic-bezier(0.22, 1, 0.36, 1)")).toEqual([0.22, 1, 0.36, 1]);
    expect(parseBezier(" 0.4 0 0.2 1 ")).toEqual([0.4, 0, 0.2, 1]);
    expect(parseBezier("ease-in-out")).toEqual([0.42, 0, 0.58, 1]);
    expect(parseBezier("cubic-bezier(1.5, 0, 0.2, 1)")).toBeNull();
    expect(parseBezier("fast")).toBeNull();
    const ease = cubicBezierEase(0.42, 0, 0.58, 1);
    expect(ease(0.5)).toBeCloseTo(0.5, 3);
    expect(applyEasing("custom", 0.5, "nope")).toBeGreaterThan(0.5);
  });

  it("ends by holding, scrolling back to the top, or cutting to the top", () => {
    const steps = [{ id: "a", kind: "scroll", pause: 1, scroll: 2000, travel: 1 }];
    const hold = readLandingPlan({ end: { hold: 2, mode: "hold" }, loading: 0, steps });
    expect(buildSegments(hold).total).toBe(4);
    const top = readLandingPlan({ easing: "linear", end: { hold: 1, mode: "top", travel: 2 }, loading: 0, steps });
    expect(buildSegments(top).total).toBe(5);
    expect(evaluateScroll(top, PAGE, 3).y).toBeCloseTo(1000, 0);
    expect(evaluateScroll(top, PAGE, 4.5).y).toBe(0);
    const reload = readLandingPlan({ end: { hold: 1, mode: "reload" }, loading: 0, steps });
    expect(evaluateScroll(reload, PAGE, 2.5).y).toBe(0);
  });

  it("runs a nested second scroll that starts after its Delay and takes over where the page is", () => {
    const plan = readLandingPlan({
      easing: "linear",
      loading: 0,
      steps: [{ id: "a", kind: "scroll", pause: 1, scroll: 1000, second: { delay: 1, easing: "linear", offset: 500, travel: 2 }, travel: 2 }],
    });
    const { segments, total } = buildSegments(plan, MAX);
    expect(segments[0]).toMatchObject({ final: 1500, travelEnd: 3 });
    expect(total).toBe(4);
    expect(evaluateScroll(plan, PAGE, 1).y).toBeCloseTo(500, 0);
    expect(evaluateScroll(plan, PAGE, 1.001).y).toBeCloseTo(500, -1);
    expect(evaluateScroll(plan, PAGE, 3).y).toBeCloseTo(1500, 0);
    expect(evaluateScroll(plan, PAGE, 3.5).y).toBe(1500);
  });

  it("starts the next step from where the second scroll landed, and the second follows its step", () => {
    const plan = readLandingPlan({
      easing: "linear",
      loading: 0,
      steps: [{ id: "a", pause: 0, scroll: 1000, second: { delay: 0.5, easing: "linear", offset: 200, travel: 1 }, travel: 1 }, { id: "b", pause: 0, scroll: 300, travel: 1 }],
    });
    expect(landings(plan)).toEqual([1200, 1500]);
    const moved = replaceStep(plan, 0, { scroll: 1400 });
    expect(buildSegments(moved, MAX).segments[0]?.second?.to).toBe(1600);
    expect(buildSegments(plan, 1100).segments[0]?.second?.to).toBe(1100);
  });

  it("gives the second scroll its own easing, falling back to the plan's", () => {
    const own = readLandingPlan({ easing: "linear", loading: 0, steps: [{ id: "a", pause: 0, scroll: 0, second: { delay: 0, easing: "in", offset: 1000, travel: 2 }, travel: 2 }] });
    expect(buildSegments(own).segments[0]?.second?.easing).toBe("in");
    const plain = readLandingPlan({ easing: "linear", loading: 0, steps: [{ id: "a", pause: 0, scroll: 0, second: { delay: 0, easing: "plan", offset: 1000, travel: 2 }, travel: 2 }] });
    expect(buildSegments(plain).segments[0]?.second?.easing).toBe("linear");
    expect(readLandingPlan({ steps: [{ kind: "scroll", scroll: 5, second: null }] }).steps[0]?.second).toBeNull();
  });

  it("turns a plan saved with one Start into a single part, and keeps the total", () => {
    const old = readLandingPlan({ loading: 1.5, loadingStyle: "wipe", startColor: "#ff8800", steps: [] });
    expect(old.start).toEqual([{ color: "#FF8800", duration: 1.5, id: "start-1", preset: "wipe" }]);
    expect(old.loading).toBe(1.5);
    expect(readLandingPlan({ loading: 0 }).start).toEqual([]);
    expect(readLandingPlan({ loadingStyle: "x", startColor: "orange" }).start[0]).toMatchObject({ color: "#5B5CF6", preset: "spinner" });
    expect(readLandingPlan({}).start).toHaveLength(1);
    expect(readLandingPlan({ loading: 1, steps: [] }).end).toEqual({ hold: 0, mode: "hold", travel: 1.6 });
    expect(maxScroll(PAGE)).toBe(MAX);
  });

  it("plays the Start parts one after another, and the scroll begins after the last", () => {
    const plan = readLandingPlan({
      loading: 99,
      start: [
        { duration: 1, id: "a", preset: "thumbnail" },
        { color: "#112233", duration: 2, id: "b", preset: "bar" },
        { duration: 0, id: "skipped", preset: "fade" },
        { duration: 1.5, id: "c", preset: "zoom" },
      ],
      steps: [{ id: "s", kind: "scroll", pause: 0, scroll: 500, travel: 1 }],
    });
    // the total is worked out from the parts (the stored `loading` is ignored)
    expect(plan.loading).toBe(4.5);
    expect(startAt(plan, 0.5)).toMatchObject({ index: 0, preset: "thumbnail", progress: 0.5 });
    expect(startAt(plan, 1)).toMatchObject({ color: "#112233", index: 1, preset: "bar", progress: 0 });
    expect(startAt(plan, 2)).toMatchObject({ index: 1, progress: 0.5 });
    expect(startAt(plan, 3.5)).toMatchObject({ index: 3, preset: "zoom", progress: expect.closeTo(1 / 3, 5) });
    expect(startAt(plan, 4.5)).toBeNull();
    // the page stays at the top throughout the Start and the first step starts after it
    expect(evaluateScroll(plan, PAGE, 3).y).toBe(0);
    expect(buildSegments(plan, MAX).segments[0]?.start).toBe(4.5);
    expect(planDuration(plan)).toBeCloseTo(5.5, 5);
  });

  it("adds a thumbnail first and then a spinner, and totals them", () => {
    let plan = readLandingPlan({ loading: 0 });
    expect(plan.start).toEqual([]);
    plan = withStart(plan, [newStartPart(plan)]);
    expect(plan.start[0]).toMatchObject({ duration: 1, preset: "thumbnail" });
    plan = withStart(plan, [...plan.start, newStartPart(plan)]);
    expect(plan.start[1]).toMatchObject({ duration: 1.2, preset: "spinner" });
    expect(plan.loading).toBeCloseTo(2.2, 5);
    expect(withStart(plan, []).loading).toBe(0);
  });
});

describe("duplicate and move steps", () => {
  const base = { steps: [{ id: "a" }, { id: "b" }, { id: "c" }] } as never as import("./landing-plan").LandingPlan;
  it("moves a step and ignores bad places", async () => {
    const { moveStep, duplicateStep } = await import("./landing-plan");
    expect(moveStep(base, 0, 2).steps.map((step) => step.id)).toEqual(["b", "c", "a"]);
    expect(moveStep(base, 1, 5)).toBe(base);
    const twice = duplicateStep(base, 1);
    expect(twice.steps).toHaveLength(4);
    expect(twice.steps[2]?.id).not.toBe("b");
  });
});

describe("removing a step", () => {
  it("keeps every other step landing where it did", async () => {
    const { removeStep, buildSegments } = await import("./landing-plan");
    const step = (id: string, scroll: number) => ({ id, kind: "scroll", pause: 0.5, scroll, travel: 0.5, second: null });
    const plan = { customEasing: "", easing: "lenis", end: { hold: 0, mode: "hold", travel: 1 }, loading: 0, start: [], steps: [step("a", 100), step("b", 200), step("c", 300)] } as never as import("./landing-plan").LandingPlan;
    const landings = (p: typeof plan) => buildSegments(p, 5000).segments.slice(0, p.steps.length).map((segment) => segment.final);
    expect(landings(plan)).toEqual([100, 300, 600]);
    expect(landings(removeStep(plan, 1, 5000))).toEqual([100, 600]);
    expect(landings(removeStep(plan, 0, 5000))).toEqual([300, 600]);
    expect(landings(removeStep(plan, 2, 5000))).toEqual([100, 300]);
  });
});

describe("motion blur", () => {
  it("is zero when off or still, and grows with speed", async () => {
    const { motionBlurLength, readLandingPlan, withBlur } = await import("./landing-plan");
    const page = { height: 5000, sections: [], viewport: { height: 800, width: 1280 } } as never as import("./animation-spec").PageInfo;
    const plan = readLandingPlan({ end: { hold: 0, mode: "hold", travel: 1 }, loading: 0, start: [], steps: [{ id: "a", kind: "scroll", pause: 0.5, scroll: 2000, travel: 1 }] });
    const moving = motionBlurLength(plan, page, 0.1, true);
    expect(moving).toBeGreaterThan(0);
    expect(motionBlurLength(plan, page, 1.4, true)).toBe(0);
    expect(motionBlurLength(withBlur(plan, { amount: 0 }), page, 0.1, true)).toBe(0);
    expect(motionBlurLength(withBlur(plan, { preview: false }), page, 0.1, true)).toBe(0);
    expect(motionBlurLength(withBlur(plan, { preview: false }), page, 0.1, false)).toBeCloseTo(moving, 5);
    expect(motionBlurLength(withBlur(plan, { amount: 60 }), page, 0.1, true)).toBeCloseTo(moving * 2, 5);
  });
});

describe("typed sums", () => {
  it("reads numbers and + - * / with brackets", async () => {
    const { evaluateExpression: ev } = await import("./landing-plan");
    expect(ev("832", 0)).toBe(832);
    expect(ev("832+100", 0)).toBe(932);
    expect(ev(" 1200 / 2 ", 0)).toBe(600);
    expect(ev("300*3-50", 0)).toBe(850);
    expect(ev("2+3*4", 0)).toBe(14);
    expect(ev("(2+3)*4", 0)).toBe(20);
    expect(ev("-450", 0)).toBe(-450);
    expect(ev("10-(-5)", 0)).toBe(15);
    expect(ev("0.5*3", 0)).toBe(1.5);
    expect(ev("2x6", 0)).toBe(12);
  });
  it("works on the current value from a leading operator", async () => {
    const { evaluateExpression: ev } = await import("./landing-plan");
    expect(ev("+50", 700)).toBe(750);
    expect(ev("*2", 700)).toBe(1400);
    expect(ev("/4", 700)).toBe(175);
  });
  it("rejects what is not a sum", async () => {
    const { evaluateExpression: ev } = await import("./landing-plan");
    expect(ev("", 5)).toBeNull();
    expect(ev("abc", 5)).toBeNull();
    expect(ev("5/0", 5)).toBeNull();
    expect(ev("(2+3", 5)).toBeNull();
    expect(ev("2++", 5)).toBeNull();
    expect(ev("1 2", 5)).toBeNull();
  });
});

describe("2nd plan default easing", () => {
  it("starts equal to the plan easing and is used by a 2nd At that follows the plan", async () => {
    const { buildSegments, readLandingPlan } = await import("./landing-plan");
    const base = { end: { hold: 0, mode: "hold", travel: 1 }, loading: 0, start: [], steps: [{ id: "a", kind: "scroll", pause: 0.5, scroll: 500, travel: 1, second: { delay: 0.2, easing: "plan", offset: 100, travel: 1 } }] };
    const old = readLandingPlan({ ...base, easing: "out" });
    expect(old.secondEasing).toBe("out");
    const set = readLandingPlan({ ...base, easing: "out", secondEasing: "linear" });
    expect(set.easing).toBe("out");
    expect(set.secondEasing).toBe("linear");
    expect(buildSegments(set).segments[0]?.second?.easing).toBe("linear");
    expect(buildSegments(set).segments[0]?.easing).toBe("out");
  });
});

describe("defaults of a new plan", () => {
  it("uses the two custom curves", async () => {
    const { readLandingPlan } = await import("./landing-plan");
    const plan = readLandingPlan(undefined);
    expect([plan.easing, plan.customEasing]).toEqual(["custom", "0.68, 0, 0.2, 1"]);
    expect([plan.secondEasing, plan.secondCustomEasing]).toEqual(["custom", "0, 0, 0.42, 0.82"]);
  });
});
