import { describe, expect, it } from "vitest";

import type { AnimationSpec } from "./animation-spec";
import { GROW_KEY, POSITION_KEY } from "../mo/figma-paste-import";
import {
  currentBox,
  currentBoxes,
  distances,
  drawsSomething,
  hitTest,
  layersInRect,
  leavesOf,
  readPlaced,
  resizedBox,
  scaleBoxes,
  snapLines,
  snapMove,
  snapResize,
  union,
  withBoxes,
  type Box,
} from "./layer-geometry";

const item = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  fills: [{ color: "#fff", opacity: 1, type: "SOLID" }],
  h,
  id,
  kind: "shape",
  strokes: [],
  sw: 0,
  w,
  x,
  y,
  ...extra,
});

// A 200 x 100 design: a background, a card at (20, 10) and a label inside a second block pasted later at 2x.
const spec = {
  assets: {},
  code: "",
  controls: [],
  design: {
    blocks: [
      { height: 100, id: "a", items: [item("bg", 0, 0, 200, 100), item("card", 20, 10, 60, 40), item("mask", 0, 0, 10, 10, { isMask: true })], name: "a", s: 1, width: 200, x: 0, y: 0 },
      { height: 20, id: "b", items: [item("label", 5, 5, 30, 10)], name: "b", s: 2, width: 40, x: 100, y: 50 },
    ],
    height: 100,
    width: 200,
  },
  fonts: [],
  id: "figma-design-test",
  imageAssets: [],
  layers: [],
  name: "t",
  version: 1,
} as unknown as AnimationSpec;

const render = { height: 100, width: 200 };

describe("readPlaced", () => {
  it("gives every drawn layer its pasted box, leaving out masks", () => {
    const placed = readPlaced(spec, render);
    expect([...placed.keys()]).toEqual(["bg", "card", "label"]);
    expect(placed.get("card")?.nat).toEqual({ h: 40, w: 60, x: 20, y: 10 });
  });

  it("applies the block's offset and scale", () => {
    expect(readPlaced(spec, render).get("label")).toMatchObject({ k: 2, nat: { h: 20, w: 60, x: 110, y: 60 } });
  });

  it("centres the design in a larger picture", () => {
    expect(readPlaced(spec, { height: 120, width: 240 }).get("card")?.nat).toMatchObject({ x: 40, y: 20 });
  });
});

describe("drawsSomething", () => {
  const base = { fills: [], kind: "shape", strokes: [], sw: 0 };
  it("is false for an empty container", () => {
    expect(drawsSomething(base)).toBe(false);
    expect(drawsSomething({ ...base, fills: [{ opacity: 0, type: "SOLID" }] })).toBe(false);
    expect(drawsSomething({ ...base, strokes: [{ opacity: 1, type: "SOLID" }], sw: 0 })).toBe(false);
  });
  it("is true for a fill, a stroke, text, an icon or a picture", () => {
    expect(drawsSomething({ ...base, fills: [{ opacity: 1, type: "SOLID" }] })).toBe(true);
    expect(drawsSomething({ ...base, strokes: [{ type: "SOLID" }], sw: 1 })).toBe(true);
    expect(drawsSomething({ ...base, kind: "text" })).toBe(true);
    expect(drawsSomething({ ...base, kind: "svg" })).toBe(true);
    expect(drawsSomething({ ...base, fillAsset: "x" })).toBe(true);
  });
});

describe("currentBox", () => {
  it("moves in block units and stretches from the top-left corner", () => {
    const label = readPlaced(spec, render).get("label")!;
    const box = currentBox(label, { label: { x: 10, y: -5 } }, { label: { sx: 2, sy: 0.5 } });
    expect(box).toEqual({ h: 10, w: 120, x: 130, y: 50 });
  });
});

describe("hitTest", () => {
  const boxes = currentBoxes(readPlaced(spec, render), {});
  it("returns the topmost layer under the point", () => {
    expect(hitTest(["card", "bg"], boxes, { x: 30, y: 20 })).toBe("card");
    expect(hitTest(["bg", "card"], boxes, { x: 30, y: 20 })).toBe("bg");
  });

  it("returns null outside every layer", () => {
    expect(hitTest(["card"], boxes, { x: 150, y: 90 })).toBeNull();
  });
});

describe("layersInRect", () => {
  const boxes = currentBoxes(readPlaced(spec, render), {});
  it("lists the layers a marquee rectangle touches, top first", () => {
    expect(layersInRect(["card", "bg"], boxes, { h: 10, w: 10, x: 25, y: 15 })).toEqual(["card", "bg"]);
  });

  it("leaves out layers the rectangle does not reach", () => {
    expect(layersInRect(["card"], boxes, { h: 5, w: 5, x: 150, y: 90 })).toEqual([]);
  });
});

describe("leavesOf", () => {
  const layers = [
    { id: "g", kind: "group" },
    { id: "inner", kind: "group", parentGroupId: "g" },
    { id: "card", parentGroupId: "inner" },
    { id: "label", parentGroupId: "g" },
    { id: "bg" },
  ];
  const drawn = new Set(["card", "label", "bg"]);
  it("stands a group for everything inside it", () => {
    expect(leavesOf(layers, ["g"], drawn).sort()).toEqual(["card", "label"]);
  });
  it("keeps a plain layer as it is and does not repeat one", () => {
    expect(leavesOf(layers, ["bg", "g", "card"], drawn).sort()).toEqual(["bg", "card", "label"]);
  });
});

describe("withBoxes", () => {
  const placed = readPlaced(spec, render);
  it("writes the move in block units and the stretch", () => {
    const next = withBoxes({ keep: 1 }, placed, new Map([["label", { h: 40, w: 60, x: 130, y: 60 }]]));
    expect(next).toMatchObject({ keep: 1, [POSITION_KEY]: { label: { x: 10, y: 0 } } });
    expect(next[GROW_KEY]).toEqual({ label: { sx: 1, sy: 2 } });
  });

  it("leaves no entry for a layer back at its pasted box", () => {
    const moved = withBoxes({}, placed, new Map([["card", { h: 40, w: 60, x: 50, y: 10 }]]));
    const back = withBoxes(moved, placed, new Map([["card", { h: 40, w: 60, x: 20, y: 10 }]]));
    expect(back[POSITION_KEY]).toBeUndefined();
    expect(back[GROW_KEY]).toBeUndefined();
  });

  it("keeps the entries of layers it was not asked about", () => {
    const first = withBoxes({}, placed, new Map([["card", { h: 40, w: 60, x: 50, y: 10 }]]));
    const second = withBoxes(first, placed, new Map([["bg", { h: 100, w: 200, x: 5, y: 0 }]]));
    expect(second[POSITION_KEY]).toEqual({ bg: { x: 5, y: 0 }, card: { x: 30, y: 0 } });
  });

  it("round-trips: the box read back is the box asked for", () => {
    const target: Box = { h: 15, w: 90, x: 140, y: 70 };
    const params = withBoxes({}, placed, new Map([["label", target]]));
    expect(currentBoxes(placed, params).get("label")).toEqual(target);
  });
});

describe("resizedBox", () => {
  const start: Box = { h: 40, w: 60, x: 20, y: 10 };
  it("keeps the opposite corner still", () => {
    expect(resizedBox(start, "se", { x: 100, y: 70 }, false)).toEqual({ h: 60, w: 80, x: 20, y: 10 });
    expect(resizedBox(start, "nw", { x: 0, y: 0 }, false)).toEqual({ h: 50, w: 80, x: 0, y: 0 });
  });

  it("keeps the proportions when locked", () => {
    const box = resizedBox(start, "se", { x: 140, y: 40 }, true);
    expect(box.w / box.h).toBeCloseTo(60 / 40);
    expect(box.x).toBe(20);
    expect(box.y).toBe(10);
  });

  it("never goes below the smallest size or flips", () => {
    const box = resizedBox(start, "se", { x: -50, y: -50 }, false);
    expect(box.w).toBe(4);
    expect(box.h).toBe(4);
    expect(box.x).toBe(20);
  });
});

describe("scaleBoxes", () => {
  it("keeps each box's place inside the outline", () => {
    const boxes = new Map<string, Box>([["a", { h: 10, w: 20, x: 10, y: 10 }]]);
    const next = scaleBoxes(boxes, { h: 20, w: 40, x: 0, y: 0 }, { h: 40, w: 80, x: 100, y: 100 });
    expect(next.get("a")).toEqual({ h: 20, w: 40, x: 120, y: 120 });
  });
});

describe("snapping", () => {
  const artboard: Box = { h: 100, w: 200, x: 0, y: 0 };
  const lines = snapLines([{ h: 20, w: 20, x: 100, y: 40 }], artboard);

  it("lands an edge on a line within the threshold", () => {
    const result = snapMove({ h: 10, w: 30, x: 72, y: 3 }, lines, 5);
    expect(result.dx).toBe(-2);
    expect(result.guides.x).toEqual([100]);
    expect(result.dy).toBe(-3);
    expect(result.guides.y).toEqual([0]);
  });

  it("snaps a middle too", () => {
    const result = snapMove({ h: 10, w: 24, x: 89, y: 70 }, lines, 5);
    expect(result.guides.x).toEqual([100]);
    expect(result.dx).toBe(-1);
  });

  it("does nothing beyond the threshold", () => {
    const result = snapMove({ h: 10, w: 30, x: 50, y: 20 }, lines, 5);
    expect(result.guides.x).toEqual([]);
    expect(result.dx).toBe(0);
  });

  it("snaps only the edges a corner moves", () => {
    const result = snapResize({ h: 40, w: 77, x: 20, y: 10 }, "se", lines, 5, false);
    expect(result.box.w).toBe(80);
    expect(result.box.x).toBe(20);
    expect(result.guides.x).toEqual([100]);
  });

  it("keeps the proportions when locked", () => {
    const result = snapResize({ h: 40, w: 77, x: 20, y: 10 }, "se", lines, 5, true);
    expect(result.box.w / result.box.h).toBeCloseTo(77 / 40);
  });
});

describe("distances", () => {
  it("measures the gap to the nearest layer on each side that faces it", () => {
    const found = distances({ h: 10, w: 10, x: 50, y: 50 }, [
      { h: 10, w: 10, x: 20, y: 50 },
      { h: 10, w: 10, x: 80, y: 50 },
      { h: 10, w: 10, x: 50, y: 10 },
      { h: 10, w: 10, x: 0, y: 0 },
    ]);
    expect(found.map((item) => item.label).sort()).toEqual(["20", "20", "30"]);
  });

  it("ignores layers that do not face the selection", () => {
    expect(distances({ h: 10, w: 10, x: 50, y: 50 }, [{ h: 10, w: 10, x: 80, y: 0 }])).toEqual([]);
  });
});

describe("union", () => {
  it("is the box around all boxes", () => {
    expect(union([{ h: 10, w: 10, x: 0, y: 0 }, { h: 10, w: 10, x: 20, y: 30 }])).toEqual({ h: 40, w: 30, x: 0, y: 0 });
    expect(union([])).toBeNull();
  });
});
