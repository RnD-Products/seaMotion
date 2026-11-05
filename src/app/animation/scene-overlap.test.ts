import { describe, expect, it } from "vitest";

import { mergeOverlapPlans } from "./scene-overlap";

const animation = (id: string, over: Record<string, unknown> = {}) => ({ delay: 0, duration: 1, effect: "fade", enabled: true, id, layer: "A", name: id, segmentId: null, ...over });

describe("mergeOverlapPlans", () => {
  it("moves the earlier scene's effects onto the later scene's clock, ahead of its own", () => {
    // Scene one starts at 0, scene two at 1.5: an effect of scene one at 1 - 2 s is at -0.5 - 0.5 s on scene two's clock.
    const merged = mergeOverlapPlans({ animations: [animation("own")], segments: [] }, 1.5, [{ params: { plan: { animations: [animation("old", { delay: 1, duration: 1 })], segments: [] } }, end: 5, start: 0 }]);
    expect(merged.animations.map((item) => item.id)).toEqual(["old@0", "own"]);
    expect(merged.animations[0]?.delay).toBeCloseTo(-0.5);
    expect(merged.animations[0]?.duration).toBeCloseTo(1);
    expect(merged.animations[0]?.segmentId).toBeNull();
  });

  it("keeps a loop in step with its own scene and leaves out switched-off effects", () => {
    const merged = mergeOverlapPlans(undefined, 2, [{ params: { plan: { animations: [animation("spin", { effect: "spin", period: 3, phase: 1 }), animation("off", { enabled: false })], segments: [] } }, end: 5, start: 0 }]);
    expect(merged.animations.map((item) => item.id)).toEqual(["spin@0"]);
    expect(merged.animations[0]?.phase).toBeCloseTo(3);
  });

  it("ends the earlier scene's hides where the later scene starts and starts the later scene's hides where the earlier one ends", () => {
    // Scene one: 0 - 2 s, scene two starts at 1.5 s (0.5 s overlap). Scene one hides "bg" for its whole length; scene two hides "logo" for its.
    const merged = mergeOverlapPlans(
      { animations: [animation("hideLogo", { duration: 4, effect: "hide", layer: "logo" }), animation("come", { delay: 0.1 })], segments: [] },
      1.5,
      [{ end: 2, params: { plan: { animations: [animation("hideBg", { duration: 2, effect: "hide", layer: "bg" })], segments: [] } }, start: 0 }],
    );
    const hideBg = merged.animations.find((item) => item.id === "hideBg@0");
    expect(hideBg?.delay).toBeCloseTo(-1.5);
    expect((hideBg?.delay ?? 0) + (hideBg?.duration ?? 0)).toBeCloseTo(0); // stops where scene two starts
    const hideLogo = merged.animations.find((item) => item.id === "hideLogo");
    expect(hideLogo?.delay).toBeCloseTo(0.5); // waits for scene one to end (0.5 s on scene two's clock)
    expect((hideLogo?.delay ?? 0) + (hideLogo?.duration ?? 0)).toBeCloseTo(4);
    expect(merged.animations.find((item) => item.id === "come")?.delay).toBe(0.1);
  });
});
