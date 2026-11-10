import { expect, it } from "vitest";

import { getRenderedPreviewSignature } from "./rendered-preview";
import { resolveRenderedPreviewRange } from "./rendered-preview";
import { clearLoopSegments, pickLoopSegment, START_KEY } from "./landing-loop";

const animation = {
  assets: { image: "data:image/png;base64,abc" },
  code: "return { render() {} };",
  controls: [],
  fonts: [],
  id: "demo",
  imageAssets: ["image"],
  layers: [],
  name: "Demo",
  page: { height: 1200, sections: [{ height: 600, id: "hero", name: "Hero", top: 0 }], viewport: { height: 600, width: 800 } },
  version: 1,
};

function state(values: Record<string, unknown>) {
  return {
    canvas: { size: { height: 600, width: 800 } },
    layers: [],
    timeline: { durationSeconds: 8 },
    values: {
      "animation.library": { items: { demo: animation } },
      "animation.type": "demo",
      ...values,
    },
  } as Parameters<typeof getRenderedPreviewSignature>[0];
}

it("invalidates rendered previews for content edits but not preview or export settings", () => {
  const original = getRenderedPreviewSignature(state({ "animation.params": { color: "blue" } }));
  expect(getRenderedPreviewSignature(state({ "animation.params": { color: "red" } }))).not.toBe(original);
  expect(getRenderedPreviewSignature(state({ "animation.params": { color: "blue" }, "preview.quality": "2", "render.resolution": "4k" }))).toBe(original);
});

it("resolves a selected continuous timeline segment for rendered preview", () => {
  pickLoopSegment(START_KEY, false);
  try {
    expect(resolveRenderedPreviewRange({
      ...state({}),
      timeline: { currentTimeSeconds: 0, durationSeconds: 8, isPlaying: false },
    } as never, "selected")).toEqual([0, 1.2]);
  } finally {
    clearLoopSegments();
  }
});
