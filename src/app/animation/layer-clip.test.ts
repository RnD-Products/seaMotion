import { describe, expect, it } from "vitest";

import type { AnimationSpec } from "./animation-spec";
import { layerEffects } from "./layer-perspective";

const spec = {
  assets: {},
  code: "",
  controls: [],
  design: {
    blocks: [
      {
        height: 1200,
        id: "fg",
        items: [
          { h: 1040, id: "bg", kind: "shape", w: 1440, x: 80, y: 80 },
          { h: 1120, id: "photo", kind: "shape", w: 1520, x: 40, y: 40 },
        ],
        name: "t",
        s: 1,
        width: 1600,
        x: 0,
        y: 0,
      },
    ],
    height: 1200,
    width: 1600,
  },
  fonts: [],
  id: "figma-design-x",
  imageAssets: [],
  layers: [],
  name: "t",
  size: { height: 1200, width: 1600 },
  version: 1,
} as unknown as AnimationSpec;

const layers = [
  { id: "container", kind: "group", name: "Container" },
  { id: "photo", name: "Imge-154", parentGroupId: "container" },
  { id: "bg", name: "Container background", parentGroupId: "container" },
];

describe("a group that clips", () => {
  it("clips to the box of its own background layer, not to what overhangs it", () => {
    const [effect] = layerEffects(layers, { __groupStyle: { container: { clip: true, radius: [8, 8, 8, 8] } } }, spec);
    expect(effect?.clip).toEqual({ box: { h: 1040, w: 1440, x: 80, y: 80 }, radius: [8, 8, 8, 8] });
    expect(effect?.ids.sort()).toEqual(["bg", "photo"]);
  });

  it("clips to the box around what it draws when it has no background layer", () => {
    const [effect] = layerEffects(
      [{ id: "container", kind: "group", name: "Container" }, { id: "photo", name: "Imge-154", parentGroupId: "container" }],
      { __groupStyle: { container: { clip: true, radius: [0, 0, 0, 0] } } },
      spec,
    );
    expect(effect?.clip).toEqual({ radius: [0, 0, 0, 0] });
  });
});
