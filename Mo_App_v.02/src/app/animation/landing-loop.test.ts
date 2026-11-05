import { beforeEach, describe, expect, it } from "vitest";

import { clearLoopSegments, END_KEY, getEditingSectionLoop, layerMotionLoopKey, loopRanges, motionLoopKey, nextLoopTime, getLoopSelection, pickLoopSegment, sectionWorkLoopKey, sectionWorkRange, segmentRange, setEditingSectionLoop, START_KEY } from "./landing-loop";
import { readLandingPlan } from "./landing-plan";
import { readSectionMotions, withWaits } from "./landing-motion";
import type { PageInfo } from "./animation-spec";

// Start 0-1, step a 1-4 (scroll 2, hold 1), step b 4-6 (scroll 1, hold 1), step c 6-8 (scroll 1, hold 1), End 8-9.
const plan = readLandingPlan({
  end: { hold: 1, mode: "hold" },
  loading: 1,
  steps: [
    { id: "a", kind: "scroll", pause: 1, travel: 2, y: 1000 },
    { id: "b", kind: "scroll", pause: 1, travel: 1, y: 2000 },
    { id: "c", kind: "scroll", pause: 1, travel: 1, y: 3000 },
  ],
});

describe("looping picked segments", () => {
  beforeEach(() => {
    clearLoopSegments();
    setEditingSectionLoop(null);
  });

  it("finds each segment's time range, and none for an empty one", () => {
    expect(segmentRange(plan, START_KEY)).toEqual([0, 1]);
    expect(segmentRange(plan, "a")).toEqual([1, 4]);
    expect(segmentRange(plan, "c")).toEqual([6, 8]);
    expect(segmentRange(plan, END_KEY)).toEqual([8, 9]);
    expect(segmentRange(plan, "missing")).toBeNull();
    expect(segmentRange(readLandingPlan({ loading: 0, steps: plan.steps }), START_KEY)).toBeNull();
    expect(segmentRange(readLandingPlan({ steps: plan.steps }), END_KEY)).toBeNull();
  });

  it("joins touching segments and keeps the gaps between others", () => {
    expect(loopRanges(plan, ["b", "a"])).toEqual([[1, 6]]);
    expect(loopRanges(plan, ["c", "a"])).toEqual([
      [1, 4],
      [6, 8],
    ]);
    expect(loopRanges(plan, [])).toEqual([]);
  });

  it("loops a section preset over the time its layers actually animate", () => {
    const page = { height: 3000, sections: [{ height: 800, id: "a", name: "Hero", top: 0 }], viewport: { height: 800, width: 1280 } } as PageInfo;
    const linked = readLandingPlan({ loading: 1, steps: [{ id: "a", scroll: 0, travel: 1, waitFor: "Hero" }] });
    const motions = readSectionMotions({ Hero: { delay: 0.2, enabled: true, items: [{ duration: 0.8, layer: "heading" }], trigger: "view" } });
    expect(loopRanges(linked, [motionLoopKey("Hero")], motions, page, 5)).toEqual([[1.2, 2]]);
  });

  it("loops one layer card over its own entry interval", () => {
    const page = { height: 3000, sections: [{ height: 800, id: "a", name: "Hero", top: 0 }], viewport: { height: 800, width: 1280 } } as PageInfo;
    const linked = readLandingPlan({ loading: 1, steps: [{ id: "a", scroll: 0, travel: 1, waitFor: "Hero" }] });
    const motions = readSectionMotions({ Hero: { delay: 0.2, enabled: true, items: [{ id: "first", duration: 0.8, layer: "heading" }, { id: "second", duration: 0.5, layer: "button" }], stagger: 0.1, trigger: "view" } });
    const ranges = loopRanges(linked, [layerMotionLoopKey("Hero", "second")], motions, page, 5);
    expect(ranges[0]?.[0]).toBeCloseTo(1.3);
    expect(ranges[0]?.[1]).toBeCloseTo(1.8);
    expect(loopRanges(linked, [layerMotionLoopKey("Hero", "missing")], motions, page, 5)).toEqual([]);
  });

  it("loops a selected section from its scroll-in through its Hold", () => {
    const page = { height: 3000, sections: [{ height: 800, id: "a", name: "Hero", top: 0 }], viewport: { height: 800, width: 1280 } } as PageInfo;
    const linked = readLandingPlan({ loading: 1, steps: [{ id: "a", scroll: 0, travel: 1, waitFor: "Hero" }] });
    const motions = readSectionMotions({ Hero: { delay: 0.2, enabled: true, items: [{ duration: 0.8, layer: "heading" }], trigger: "view" } });
    expect(sectionWorkRange("Hero", linked, motions, page, 5)).toEqual([1, 2.7]);
    expect(loopRanges(linked, [sectionWorkLoopKey("Hero")], motions, page, 5)).toEqual([[1, 2.7]]);
    const delayed = readSectionMotions({ Hero: { delay: 0.5, enabled: true, items: [{ duration: 2, layer: "heading" }], trigger: "view" } });
    const played = withWaits(linked, page, delayed);
    expect(sectionWorkRange("Hero", played, delayed, page, 5)).toEqual([1, 4.2]);
    expect(sectionWorkRange("missing", linked, motions, page, 5)).toBeNull();
    setEditingSectionLoop("Hero");
    expect(getEditingSectionLoop()).toBe("Hero");
    pickLoopSegment("a", false);
    expect(getEditingSectionLoop()).toBeNull();
  });

  it("keeps the playhead inside the picked ranges while playing", () => {
    const ranges = loopRanges(plan, ["a", "c"]);
    expect(nextLoopTime(ranges, 2)).toBeNull();
    expect(nextLoopTime(ranges, 4.0)).toBe(6);
    expect(nextLoopTime(ranges, 5)).toBe(6);
    expect(nextLoopTime(ranges, 8.2)).toBe(1);
    expect(nextLoopTime(ranges, 0.3)).toBe(1);
    expect(nextLoopTime([], 3)).toBeNull();
  });

  it("picks one segment with a click and adds more with Shift-click", () => {
    pickLoopSegment("a", false);
    expect(getLoopSelection()).toEqual(["a"]);
    // another plain click replaces the pick
    pickLoopSegment("c", false);
    expect(getLoopSelection()).toEqual(["c"]);
    // Shift-click adds
    pickLoopSegment("a", true);
    expect(getLoopSelection()).toEqual(["c", "a"]);
    // a plain click on one of several keeps just that one
    pickLoopSegment("a", false);
    expect(getLoopSelection()).toEqual(["a"]);
    // a plain click on the only picked segment drops it
    pickLoopSegment("a", false);
    expect(getLoopSelection()).toEqual([]);
    // Shift-click on a picked one takes it away
    pickLoopSegment("a", true);
    pickLoopSegment("a", true);
    expect(getLoopSelection()).toEqual([]);
  });
});
