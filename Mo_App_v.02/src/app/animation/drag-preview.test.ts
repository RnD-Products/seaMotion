import { describe, expect, it } from "vitest";

import { splitStack } from "./drag-preview";

describe("splitStack", () => {
  const stack = ["a", "b", "c", "d", "e"];

  it("puts everything under the moved layer below and everything over it above", () => {
    expect(splitStack(stack, new Set(["c"]))).toEqual({ above: ["d", "e"], below: ["a", "b"], selected: ["c"] });
  });

  it("counts layers between moved ones as below, so they stay under the moved layers", () => {
    expect(splitStack(stack, new Set(["b", "d"]))).toEqual({ above: ["e"], below: ["a", "c"], selected: ["b", "d"] });
  });

  it("has nothing above for the top layer and nothing below for the bottom one", () => {
    expect(splitStack(stack, new Set(["e"]))).toEqual({ above: [], below: ["a", "b", "c", "d"], selected: ["e"] });
    expect(splitStack(stack, new Set(["a"]))).toEqual({ above: ["b", "c", "d", "e"], below: [], selected: ["a"] });
  });

  it("is null when none of the moved layers is drawn", () => {
    expect(splitStack(stack, new Set(["x"]))).toBeNull();
  });
});
