import { describe, expect, it } from "vitest";

import { readInteractionPlan } from "./interaction-plan";

describe("interaction plan", () => {
  const plan = {
    animations: [
      { blur: 5, delay: 0.7, distance: 75, duration: 0.8, effect: "in", id: "a", layer: "Top bar", name: "Top bar in", scale: 280, segmentId: "s", slide: "top" },
      { angle: 90, delay: 0, duration: 0.9, effect: "flip", id: "b", layer: "Logo mark", name: "Turn", segmentId: "s" },
      { delay: 0.55, duration: 0.45, effect: "letters", id: "c", layer: "Logo text", name: "Letters", segmentId: "s", slide: "right", stagger: 0.06 },
      { delay: 0, duration: 2.5, effect: "hide", id: "d", layer: "Design", name: "Hidden", segmentId: "s" },
      { delay: 0, duration: 1, effect: "not-an-effect", id: "e", layer: "x", name: "Old", segmentId: "s", slide: "diagonal" },
    ],
    segments: [{ hold: 0, id: "s", name: "Logo", travel: 2.5 }],
  };

  it("keeps the settings of Come in, Turn 3D and Letters in", () => {
    const read = readInteractionPlan({ plan });
    expect(read.animations[0]).toMatchObject({ blur: 5, distance: 75, effect: "in", scale: 280, slide: "top" });
    expect(read.animations[1]).toMatchObject({ angle: 90, effect: "flip" });
    expect(read.animations[2]).toMatchObject({ effect: "letters", slide: "right", stagger: 0.06 });
    expect(read.animations[3]?.effect).toBe("hide");
  });

  it("falls back to Fade and no slide for something it does not know", () => {
    const old = readInteractionPlan({ plan }).animations[4];
    expect(old?.effect).toBe("fade");
    expect(old?.slide).toBeUndefined();
  });
});

describe("swap text and count to", () => {
  it("keeps the words of a Swap text animation and the number a Count counts to", () => {
    const plan = readInteractionPlan({
      plan: {
        animations: [
          { delay: 1, duration: 0.7, effect: "swap", enabled: true, id: "a", layer: "Label", name: "Wed", segmentId: null, text: "CO2 Wed" },
          { delay: 1, duration: 0.5, effect: "count", enabled: true, from: 412, id: "b", layer: "Number", name: "Count", segmentId: null, to: 292 },
        ],
        segments: [],
      },
    });
    expect(plan.animations[0]).toMatchObject({ effect: "swap", text: "CO2 Wed" });
    expect(plan.animations[1]).toMatchObject({ effect: "count", from: 412, to: 292 });
  });

  it("keeps the needle base and length of a Sweep reveal", () => {
    const plan = readInteractionPlan({ plan: { animations: [{ angle: 45.4, bx: 1165.36, by: 747.39, delay: 1, duration: 1.5, effect: "sweep", enabled: true, id: "s", layer: "Ellipse 7", name: "Sweep", px: 1158.1, py: 753, reach: 87, segmentId: null }], segments: [] } });
    expect(plan.animations[0]).toMatchObject({ bx: 1165.36, by: 747.39, px: 1158.1, py: 753, reach: 87 });
  });

  it("keeps the settings of Float loop", () => {
    const float = { delay: 0, distance: 6, duration: 8, effect: "float", enabled: true, id: "f", layer: "Photos", name: "Floating", period: 8, phase: 0, segmentId: null };
    expect(readInteractionPlan({ plan: { animations: [float], segments: [] } }).animations[0]).toMatchObject({ distance: 6, effect: "float", layer: "Photos", period: 8, segmentId: null });
  });
});
