import { describe, expect, it } from "vitest";

import { dragPathsKey, fastestSpeed, pathAt } from "./drag-motion";

const path = { dir: [0, -1, -1, 0, 1, 1], speed: [0, 300, 600, 0, 500, 1000], start: 2, step: 0.1 };

describe("Drag motion", () => {
  it("reads speed (0..1 of the fastest) and direction inside a path", () => {
    const fastest = fastestSpeed({ a: path });
    expect(fastest).toBeCloseTo(850);
    expect(pathAt(path, 2.2, fastest).speed).toBeCloseTo(600 / 850);
    expect(pathAt(path, 2.2, fastest).dir).toBe(-1);
    expect(pathAt(path, 2.3, fastest).speed).toBeCloseTo(0);
    expect(pathAt(path, 2.5, fastest)).toEqual({ dir: 1, speed: 1 });
    expect(pathAt(path, 2.15, fastest).speed).toBeCloseTo(450 / 850);
  });

  it("has no key without a drag", () => {
    expect(dragPathsKey(null, {}, [], 10)).toBe("");
  });
});
