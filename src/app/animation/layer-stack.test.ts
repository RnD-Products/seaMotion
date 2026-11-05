import { describe, expect, it } from "vitest";

import { getLayerStack, underFrameContents, type AnimationSpec } from "./animation-spec";

const spec = {
  assets: {},
  code: "",
  controls: [],
  fonts: [],
  id: "figma-design-test",
  imageAssets: [],
  layers: ["a-text", "b-text", "photo", "bg"].map((id) => ({ id, name: id })),
  name: "t",
  version: 1,
} as unknown as AnimationSpec;

describe("getLayerStack", () => {
  it("draws a group's sub-layers with their group even when the list has them lower down", () => {
    // Tree: Group 1 holds Frame A, Frame B, a photo and a background (top first); the frames' texts sit further down the
    // flat list, below the photo, as left by grouping.
    const layers = [
      { id: "g", kind: "group", visible: true },
      { id: "frameA", kind: "group", parentGroupId: "g", visible: true },
      { id: "frameB", kind: "group", parentGroupId: "g", visible: true },
      { id: "photo", parentGroupId: "g", visible: true },
      { id: "bg", parentGroupId: "g", visible: true },
      { id: "a-text", parentGroupId: "frameA", visible: true },
      { id: "b-text", parentGroupId: "frameB", visible: true },
    ];
    // Bottom to top: background, photo, then the frames' texts above the photo.
    expect(getLayerStack(spec, layers)).toEqual(["bg", "photo", "b-text", "a-text"]);
  });

  it("keeps the usual order for a normal list and hides what a hidden group holds", () => {
    const layers = [
      { id: "g", kind: "group", visible: false },
      { id: "a-text", parentGroupId: "g", visible: true },
      { id: "photo", visible: true },
      { id: "bg", visible: true },
    ];
    expect(getLayerStack(spec, layers)).toEqual(["bg", "photo"]);
  });
});

describe("underFrameContents", () => {
  const byId = new Map([
    ["card", {}],
    ["inner", { parentGroupId: "card" }],
    ["dot", { parentGroupId: "inner" }],
    ["text", { parentGroupId: "card" }],
    ["bg", {}],
  ]);

  it("puts a frame's own fill just under the lowest layer it holds", () => {
    // A frame is listed above what it holds (its group row comes first), so it would draw over it.
    expect(underFrameContents(["bg", "dot", "text", "card"], new Set(["card"]), byId)).toEqual(["bg", "card", "dot", "text"]);
  });

  it("keeps a frame inside a frame in order: the outer first, then the inner, then what the inner holds", () => {
    expect(underFrameContents(["bg", "dot", "inner", "text", "card"], new Set(["card", "inner"]), byId)).toEqual(["bg", "card", "inner", "dot", "text"]);
  });

  it("leaves the stack alone without frames", () => {
    expect(underFrameContents(["bg", "dot", "text"], new Set(), byId)).toEqual(["bg", "dot", "text"]);
  });

  it("leaves an empty frame where it is", () => {
    expect(underFrameContents(["bg", "card"], new Set(["card"]), byId)).toEqual(["bg", "card"]);
  });
});
