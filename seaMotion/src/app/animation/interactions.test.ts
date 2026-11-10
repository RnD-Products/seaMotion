import { describe, expect, it } from "vitest";

import { createInteraction, drawInteractions, gatherTogether, interactionEnd, isPointerShownAt, patchInteraction, readInteractionsValue, removeInteraction } from "./interactions";

const row = () => [
  createInteraction("cursor", { duration: 1, id: "a", start: 0 }),
  createInteraction("drag", { duration: 2, id: "b", start: 1 }),
  createInteraction("tap", { duration: 0.5, id: "c", start: 3 }),
];

describe("Reactor timing", () => {
  it("moves the items after one whose duration grows", () => {
    const next = patchInteraction(row(), "b", { duration: 2.5 });
    expect(next.map((item) => item.start)).toEqual([0, 1, 3.5]);
  });

  it("moves the items after one whose hold changes, and back again", () => {
    const held = patchInteraction(row(), "a", { hold: 0.8 });
    expect(held.map((item) => item.start)).toEqual([0, 1.8, 3.8]);
    expect(interactionEnd(held[0]!)).toBeCloseTo(1.8);
    const back = patchInteraction(held, "a", { hold: 0 });
    expect(back.map((item) => item.start)).toEqual([0, 1, 3]);
  });

  it("leaves the others alone for other changes", () => {
    const next = patchInteraction(row(), "b", { size: 60 });
    expect(next.map((item) => item.start)).toEqual([0, 1, 3]);
  });

  it("reads items saved before Hold existed with no hold", () => {
    const value = readInteractionsValue({ items: [{ duration: 1, id: "x", start: 0, type: "cursor" }] });
    expect(value.items[0]?.hold).toBe(0);
  });

  it("stops at an unlinked item: it and everything after it stay", () => {
    const list = row().map((item) => (item.id === "c" ? { ...item, linked: false } : item));
    const next = patchInteraction(list, "a", { duration: 2 });
    expect(next.map((item) => item.start)).toEqual([0, 2, 3]);
  });

  it("removing an item pulls the linked ones up into its place, not the unlinked ones", () => {
    expect(removeInteraction(row(), "b").map((item) => [item.id, item.start])).toEqual([["a", 0], ["c", 1]]);
    const list = row().map((item) => (item.id === "c" ? { ...item, linked: false } : item));
    expect(removeInteraction(list, "b").map((item) => [item.id, item.start])).toEqual([["a", 0], ["c", 3]]);
  });

  it("reads items saved before links existed as linked", () => {
    expect(readInteractionsValue({ items: [{ duration: 1, id: "x", start: 0, type: "cursor" }] }).items[0]?.linked).toBe(true);
  });

  it("an item set to the same timing as an earlier one moves up beside it", () => {
    const list = [...row(), createInteraction("tap", { duration: 2, id: "d", start: 5 })];
    const next = patchInteraction(list, "d", { start: 1 });
    expect(next.map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
    expect(gatherTogether(next).map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("editing a row of two edits both and moves the linked rows below once", () => {
    const list = [
      createInteraction("cursor", { duration: 1, id: "a", start: 0 }),
      createInteraction("tap", { duration: 1, id: "b", start: 0 }),
      createInteraction("drag", { duration: 1, id: "c", start: 1 }),
    ];
    const next = patchInteraction(list, ["a", "b"], { duration: 1.5 });
    expect(next.map((item) => [item.id, item.start, item.duration])).toEqual([["a", 0, 1.5], ["b", 0, 1.5], ["c", 1.5, 1]]);
  });
});

// The opacity a pointer is painted with at `time` (the arrow's fill is the last thing drawn with it).
function alphaAt(items: Parameters<typeof drawInteractions>[1], time: number, options?: Parameters<typeof drawInteractions>[7]): number | null {
  let alpha: number | null = null;
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === "fill") return () => { alpha = target.globalAlpha as number; };
      return key in target ? target[key as string] : () => undefined;
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  drawInteractions(ctx, items, time, 1000, 800, 1, null, options);
  return alpha;
}

describe("a pointer across scenes", () => {
  const cursor = [createInteraction("cursor", { duration: 0.5, hold: 0.5, id: "a", start: 0, x: 50, y: 50, toX: 50, toY: 50 })];

  it("fades in at the start of a scene unless the scene before ended with a pointer", () => {
    expect(alphaAt(cursor, 0.02)).toBeLessThan(0.5);
    expect(alphaAt(cursor, 0.02, { carriesOn: true })).toBe(1);
  });

  it("fades out at its end unless the next scene starts with a pointer", () => {
    expect(alphaAt(cursor, 0.99)).toBeLessThan(0.5);
    expect(alphaAt(cursor, 0.99, { leadsOnAt: 1 })).toBe(1);
  });

  it("leaves slowly when it was carried over from the scene before", () => {
    const leaving = [createInteraction("cursor", { duration: 0.5, hold: 0, id: "b", start: 0, x: 50, y: 50, toX: 50, toY: 50 })];
    // It fades out smoothly over its whole time, not in the last tenth of it.
    expect(alphaAt(leaving, 0.02, { carriesOn: true })).toBeGreaterThan(0.95);
    expect(alphaAt(leaving, 0.25, { carriesOn: true })).toBeCloseTo(0.5, 1);
    expect(alphaAt(leaving, 0.48, { carriesOn: true })).toBeLessThan(0.05);
  });

  it("knows whether a pointer is on screen at a time", () => {
    expect(isPointerShownAt(cursor, 0.9)).toBe(true);
    expect(isPointerShownAt(cursor, 1.2)).toBe(false);
    expect(isPointerShownAt([createInteraction("loading", { duration: 2, start: 0 })], 1)).toBe(false);
  });
});
