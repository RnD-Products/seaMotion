import { describe, expect, it } from "vitest";

import type { PageInfo } from "./animation-spec";
import { allFx, itemFx, itemOffsets, layerMotionRange, moveMotionItem, newMotionItem, readSectionMotions, sectionStart, withWaits, type SectionMotion } from "./landing-motion";
import { buildSegments, readLandingPlan } from "./landing-plan";

const page = { height: 3000, sections: [{ height: 800, id: "a", name: "Hero", top: 0 }, { height: 800, id: "b", name: "Next", top: 1500 }], viewport: { height: 800, width: 1280 } } as never as PageInfo;
const plan = readLandingPlan({ end: { hold: 0, mode: "hold", travel: 1 }, loading: 0, start: [{ color: "#5B5CF6", duration: 1, id: "s", preset: "spinner" }], steps: [{ id: "a", kind: "scroll", pause: 0.5, scroll: 2000, travel: 2 }] });

describe("section motion", () => {
  it("staggers items one after another and lets a grouped item start with the one before", () => {
    const motion: SectionMotion = {
      delay: 0,
      enabled: true,
      items: [newMotionItem("a"), newMotionItem("b"), newMotionItem("c", { withPrevious: true }), newMotionItem("d", { delay: 0.1 })],
      stagger: 0.05,
      trigger: "start",
    };
    const offsets = itemOffsets(motion);
    expect(offsets[0]).toBeCloseTo(0);
    expect(offsets[1]).toBeCloseTo(0.05);
    expect(offsets[2]).toBeCloseTo(0.05);
    expect(offsets[3]).toBeCloseTo(0.1 + 0.1);
  });

  it("uses each layer card's actual time and changes playback when cards move", () => {
    const first = newMotionItem("a", { duration: 0.6 });
    const second = newMotionItem("b", { delay: 0.2, duration: 0.4 });
    const motion: SectionMotion = { delay: 0.3, enabled: true, items: [first, second], stagger: 0.1, trigger: "start" };
    expect(layerMotionRange("Hero", motion, first.id, plan, page, 6)?.[0]).toBeCloseTo(1.3);
    expect(layerMotionRange("Hero", motion, second.id, plan, page, 6)?.[0]).toBeCloseTo(1.6);
    const reordered = moveMotionItem(motion, 1, 0);
    expect(reordered.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(layerMotionRange("Hero", reordered, second.id, plan, page, 6)?.[0]).toBeCloseTo(1.5);
    expect(layerMotionRange("Hero", reordered, first.id, plan, page, 6)?.[0]).toBeCloseTo(1.4);
    expect(moveMotionItem(reordered, 0, 0)).toBe(reordered);
    expect(layerMotionRange("Hero", motion, "missing", plan, page, 6)).toBeNull();
  });

  it("hides an item before its start and settles it in place after the entry", () => {
    const item = newMotionItem("a", { blur: 12, scale: 80, slide: "bottom", distance: 40 });
    const before = itemFx(item, 0.1, 0);
    expect(before.opacity).toBe(0);
    const start = itemFx(item, 0, 0.0001);
    expect(start.blur).toBeCloseTo(12, 0);
    expect(start.dy).toBeCloseTo(40, 0);
    expect(start.scale).toBeCloseTo(0.8, 1);
    const done = itemFx(item, 0, 5);
    expect(done).toEqual({ blur: 0, dx: 0, dy: 0, opacity: 1, rotate: 0, scale: 1 });
  });

  it("slides from the other sides and loops after the entry", () => {
    expect(itemFx(newMotionItem("a", { slide: "top", distance: 50 }), 0, 0.0001).dy).toBeLessThan(-40);
    expect(itemFx(newMotionItem("a", { slide: "left", distance: 50 }), 0, 0.0001).dx).toBeLessThan(-40);
    expect(itemFx(newMotionItem("a", { slide: "right", distance: 50 }), 0, 0.0001).dx).toBeGreaterThan(40);
    const spin = newMotionItem("a", { loop: "floatRotate" });
    const later = [1.2, 2, 3, 4].map((time) => itemFx(spin, 0, time));
    expect(later.some((fx) => Math.abs(fx.rotate) > 1)).toBe(true);
    expect(later.some((fx) => Math.abs(fx.dy) > 1)).toBe(true);
    const pulse = newMotionItem("a", { loop: "pulse" });
    expect([1.2, 1.6, 2, 2.4].some((time) => itemFx(pulse, 0, time).scale > 1.05)).toBe(true);
  });

  it("starts after the Start, or when the section scrolls into view", () => {
    expect(sectionStart("start", plan, page, 1500, 5)).toBe(plan.loading);
    const view = sectionStart("view", plan, page, 1500, 6);
    expect(view).toBeGreaterThan(plan.loading);
    expect(sectionStart("view", plan, page, 1500, 6)).toBe(view);
  });

  it("gives the moving layers by id, and nothing when off", () => {
    const motions = readSectionMotions({ Hero: { enabled: true, items: [{ layer: "x", fade: true }], stagger: 0.05, trigger: "start" }, Next: { enabled: false, items: [{ layer: "y" }] } });
    const fx = allFx(motions, plan, page, 1.5, 6);
    expect(Object.keys(fx ?? {})).toEqual(["x"]);
    expect(allFx({}, plan, page, 1.5, 6)).toBeNull();
  });

  it("reads saved settings safely", () => {
    expect(readSectionMotions(undefined)).toEqual({});
    const read = readSectionMotions({ Hero: { enabled: true, items: [{ layer: "a", slide: "sideways", loop: "spin", blur: -3 }, { nope: true }] } });
    expect(read.Hero?.items).toHaveLength(1);
    expect(read.Hero?.items[0]?.slide).toBe("none");
    expect(read.Hero?.items[0]?.loop).toBe("none");
    expect(read.Hero?.items[0]?.blur).toBe(0);
    expect(read.Hero?.items[0]?.easing).toBe("out");
  });
  it("keeps the previous ease-out default and applies each layer's saved preset", () => {
    const saved = readSectionMotions({ Hero: { enabled: true, items: [{ layer: "a", easing: "linear" }, { layer: "b", easing: "unknown" }] } });
    expect(saved.Hero?.items[0]?.easing).toBe("linear");
    expect(saved.Hero?.items[1]?.easing).toBe("out");
    const linear = newMotionItem("a", { distance: 100, duration: 1, easing: "linear", slide: "right" });
    const out = newMotionItem("a", { ...linear, easing: "out" });
    const incoming = newMotionItem("a", { ...linear, easing: "in" });
    expect(itemFx(linear, 0, 0.5).dx).toBeCloseTo(50);
    expect(itemFx(out, 0, 0.5).dx).toBeCloseTo(12.5);
    expect(itemFx(incoming, 0, 0.5).dx).toBeCloseTo(87.5);
    const overshoot = itemFx(newMotionItem("a", { blur: 10, distance: 100, duration: 1, easing: "overshoot", slide: "right" }), 0, 0.8);
    expect(overshoot.dx).toBeLessThan(0);
    expect(overshoot.opacity).toBe(1);
    expect(overshoot.blur).toBe(0);
  });
});

describe("the Start thumbnail", () => {
  it("shows the layers in place while the thumbnail part plays", () => {
    const withThumb = readLandingPlan({ loading: 0, start: [{ color: "#5B5CF6", duration: 0.4, id: "t", preset: "thumbnail" }, { color: "#5B5CF6", duration: 2, id: "p", preset: "dots" }], steps: [] });
    const motions = readSectionMotions({ Hero: { enabled: true, items: [{ layer: "x", slide: "bottom" }], trigger: "start" } });
    expect(allFx(motions, withThumb, page, 0.2, 6)?.x?.opacity).toBe(1);
    expect(allFx(motions, withThumb, page, 1, 6)?.x?.opacity).toBe(0);
  });
});

describe("master delay", () => {
  it("reads the delay and keeps it within range", () => {
    expect(readSectionMotions({ A: { delay: 1.5, enabled: true, items: [] } }).A?.delay).toBe(1.5);
    expect(readSectionMotions({ A: { delay: -3, items: [] } }).A?.delay).toBe(0);
    expect(readSectionMotions({ A: { items: [] } }).A?.delay).toBe(0);
  });
});

describe("hold after a section animation", () => {
  const motions = readSectionMotions({ Hero: { delay: 0, enabled: true, items: [{ duration: 3, layer: "x" }], stagger: 0.05, trigger: "start" } });
  it("starts the Hold once the section's animation is over", () => {
    const waiting = readLandingPlan({ loading: 0, steps: [{ id: "a", kind: "scroll", pause: 0.5, scroll: 100, travel: 1, waitFor: "Hero" }] });
    const before = buildSegments(waiting).segments[0]!;
    const after = buildSegments(withWaits(waiting, page, motions)).segments[0]!;
    expect(before.end).toBeCloseTo(1.5);
    expect(after.end).toBeCloseTo(3.5);
    // The animation runs from the step's own start (here 0), so a 3 s animation ends at 3 s and the 0.5 s Hold follows.
    expect(buildSegments(withWaits(waiting, page, motions)).segments[0]!.travelEnd).toBeCloseTo(1);
  });
  it("runs the full Hold after master delay and staggered layers finish", () => {
    const waiting = readLandingPlan({ loading: 0, steps: [{ id: "a", kind: "scroll", pause: 0.7, scroll: 100, travel: 1, waitFor: "Hero" }] });
    const staggered = readSectionMotions({ Hero: { delay: 0.4, enabled: true, items: [{ duration: 0.5, layer: "a" }, { duration: 1, layer: "b" }], stagger: 0.3, trigger: "start" } });
    const segment = buildSegments(withWaits(waiting, page, staggered)).segments[0]!;
    // The second layer ends at 0.4 + 0.3 + 1 = 1.7 s; the 0.7 s Hold follows it.
    expect(segment.end - 0.7).toBeCloseTo(1.7);
    expect(segment.end).toBeCloseTo(2.4);
  });
  it("leaves a plan without waits, or a section without motion, as it is", () => {
    const plain = readLandingPlan({ loading: 0, steps: [{ id: "a", kind: "scroll", pause: 0.5, scroll: 100, travel: 1 }] });
    expect(withWaits(plain, page, motions)).toBe(plain);
    const waiting = readLandingPlan({ loading: 0, steps: [{ id: "a", kind: "scroll", pause: 0.5, scroll: 100, travel: 1, waitFor: "Next" }] });
    expect(buildSegments(withWaits(waiting, page, motions)).segments[0]!.end).toBeCloseTo(1.5);
  });
});

describe("a copy of a section's animation", () => {
  it("moves the same section's layers from its own entry", () => {
    const motions = readSectionMotions({
      "Hero copy": { enabled: true, items: [{ duration: 1, layer: "z" }], section: "Hero", stagger: 0.05, trigger: "start" },
    });
    expect(motions["Hero copy"]?.section).toBe("Hero");
    const fx = allFx(motions, plan, page, 0.1, 10);
    expect(fx && Object.hasOwn(fx, "z")).toBe(true);
  });
  it("does not let a later preset hide a layer before that preset starts", () => {
    const timed = readLandingPlan({ loading: 0, steps: [
      { id: "first", scroll: 0, travel: 1, waitFor: "Hero" },
      { id: "later", scroll: 0, travel: 1, waitFor: "Hero copy" },
    ] });
    const motions = readSectionMotions({
      Hero: { enabled: true, items: [{ duration: 0.5, layer: "same" }], trigger: "start" },
      "Hero copy": { enabled: true, items: [{ duration: 0.5, layer: "same" }], section: "Hero", trigger: "start" },
    });
    expect(allFx(motions, timed, page, 0.75, 5)?.same?.opacity).toBe(1);
    const secondStart = buildSegments(timed).segments[1]!.start;
    expect(allFx(motions, timed, page, secondStart, 5)?.same?.opacity).toBe(0);
  });
});
