import { describe, expect, it } from "vitest";

import { resolveParams, type AnimationSpec } from "./animation-spec";

describe("resolveParams", () => {
  it("keeps the scene's Interaction plan, so a Layer section edit that writes the params back does not wipe the motion", () => {
    const plan = { animations: [{ id: "a" }], segments: [] };
    const spec = { controls: [] } as unknown as AnimationSpec;
    const resolved = resolveParams(spec, { __video: { x: { fit: true } }, plan });
    expect(resolved.plan).toBe(plan);
    expect(resolved.__video).toEqual({ x: { fit: true } });
    expect(resolveParams(spec, {}).plan).toBeUndefined();
  });
});
