import { describe, expect, it } from "vitest";

import { DEFAULT_FRAME_TRANSFORM } from "./frame-transform";
import { layoutFrame } from "./design-bounds";

describe("frame size presets", () => {
  it("keeps the preset as the base size when frame scale changes", () => {
    const canvas = { width: 1280, height: 832 };
    const full = layoutFrame(null, null, canvas, { ...DEFAULT_FRAME_TRANSFORM, sizePreset: "macbook-air" });
    const reduced = layoutFrame(null, null, canvas, { ...DEFAULT_FRAME_TRANSFORM, scale: 50, sizePreset: "macbook-air" });

    expect(reduced.boxW).toBe(full.boxW);
    expect(reduced.boxH).toBe(full.boxH);
    expect(reduced.transform.scale).toBe(50);
  });
});
