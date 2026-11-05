import { describe, expect, it } from "vitest";

import { ANIMATION_LIBRARY_TARGET, ANIMATION_TYPE_TARGET, getLayerStack } from "../animation/animation-spec";
import { checkLottieExport } from "../lottie/lottie-support";
import { buildProjectFromMedia, clipTime, planBlend, mediaKindOf, withAnimatedPicture, withMediaLayer, withoutAnimatedPicture, type MediaFileInfo } from "./media-layer";

const VIDEO: MediaFileInfo = { dataUrl: "data:video/webm;base64,AAAA", duration: 2.5, height: 240, kind: "video", name: "Clip", width: 320 };
const GIF: MediaFileInfo = { dataUrl: "data:image/gif;base64,R0lG", duration: 1, height: 100, kind: "gif", name: "Dot", width: 100 };

describe("Video and GIF layers", () => {
  it("knows MP4, WebM and GIF files", () => {
    expect(mediaKindOf({ name: "a.mp4", type: "" })).toBe("video");
    expect(mediaKindOf({ name: "a.WEBM", type: "" })).toBe("video");
    expect(mediaKindOf({ name: "a", type: "image/gif" })).toBe("gif");
    expect(mediaKindOf({ name: "a.json", type: "application/json" })).toBeNull();
  });

  it("opens a video as a new Animation project at its size and length", () => {
    const file = buildProjectFromMedia(VIDEO);
    const spec = file.animation!;
    const id = spec.layers[0]!.id;
    expect(file.canvas?.size).toEqual({ height: 240, width: 320 });
    expect(file.durationSeconds).toBe(2.5);
    expect(file.values["motion.type"]).toBe("animation");
    expect(spec.media?.[id]).toMatchObject({ asset: id, fit: "cover", kind: "video" });
    expect(spec.assets[id]).toBe(VIDEO.dataUrl);
    expect(file.layers).toEqual([{ id, kind: "layer", name: "Clip", visible: true }]);
  });

  it("adds a GIF layer on top of an existing animation and bumps its version", () => {
    const base = buildProjectFromMedia(VIDEO).animation!;
    const { layer, spec } = withMediaLayer(base, GIF, { height: 240, width: 320 });
    expect(spec.version).toBe(base.version + 1);
    expect(spec.layers.map((item) => item.name)).toEqual(["Dot", "Clip"]);
    expect(spec.media?.[layer.id]?.kind).toBe("gif");
    expect(getLayerStack(spec, [{ id: layer.id, visible: true }, { id: base.layers[0]!.id, visible: true }])).toEqual([base.layers[0]!.id, layer.id]);
  });

  it("gives a project with no animation one that draws only the video", () => {
    const { spec } = withMediaLayer(null, VIDEO, { height: 1080, width: 1920 });
    expect(spec.size).toEqual({ height: 1080, width: 1920 });
    expect(spec.layers).toHaveLength(1);
  });

  it("lists video layers in red for a Lottie export", () => {
    const lottie = { fr: 30, h: 100, ip: 0, layers: [], op: 30, w: 100 };
    const { spec } = withMediaLayer({ ...buildProjectFromMedia(GIF).animation!, lottie }, VIDEO, { height: 100, width: 100 });
    const issues = checkLottieExport({ [ANIMATION_LIBRARY_TARGET]: { items: { [spec.id]: spec } }, [ANIMATION_TYPE_TARGET]: spec.id, "animation.frame": { fill: false }, "motion.type": "lottie" }, 1);
    expect(issues.find((issue) => issue.id === "media-layers")?.where).toEqual(["Clip", "Dot"]);
  });

  it("lets a layer picture play a video: the still first frame stays the picture, the clip is kept beside it", () => {
    const base = { ...buildProjectFromMedia(VIDEO).animation!, assets: { photo: "data:image/png;base64,OLD" }, imageAssets: ["photo"] };
    const spec = withAnimatedPicture(base, "photo", GIF, "data:image/png;base64,POSTER");
    expect(spec.assets.photo).toBe("data:image/png;base64,POSTER");
    expect(spec.assets["photo.media"]).toBe(GIF.dataUrl);
    expect(spec.assetMedia?.photo).toMatchObject({ asset: "photo.media", kind: "gif" });
    expect(spec.version).toBe(base.version + 1);
    const still = withoutAnimatedPicture(spec, "photo");
    expect(still.assetMedia?.photo).toBeUndefined();
    expect(still.assets["photo.media"]).toBeUndefined();
    expect(still.assets.photo).toBe("data:image/png;base64,POSTER");
  });
});

describe("A clip played by a plan of parts", () => {
  const clip = { duration: 10 };
  const settings = {
    segments: [
      { end: 6.5, from: 0, start: 0, to: 6.5 },
      { end: 10, from: 6.5, start: 6.5, to: 15.5 },
      { end: 0, from: 15.5, start: 10, to: 24 },
    ],
  };

  it("plays forward at its own speed, slows down, then runs back to its first frame", () => {
    expect(clipTime(clip, settings, 0)).toBe(0);
    expect(clipTime(clip, settings, 3)).toBeCloseTo(3);
    expect(clipTime(clip, settings, 6.5)).toBeCloseTo(6.5);
    expect(clipTime(clip, settings, 11)).toBeCloseTo(8.25);
    expect(clipTime(clip, settings, 15.5)).toBeCloseTo(9.999, 2);
    expect(clipTime(clip, settings, 19.75)).toBeCloseTo(5, 1);
    expect(clipTime(clip, settings, 23.99)).toBeLessThan(0.02);
  });

  it("starts the loop again where it began", () => {
    expect(clipTime(clip, settings, 24)).toBe(0);
    expect(clipTime(clip, settings, 27)).toBeCloseTo(3);
  });
});

describe("A part that dissolves in over the one before it", () => {
  const clip = { duration: 10 };
  const plan = [
    { end: 6.5, from: 0, start: 0, to: 6.5 },
    { end: 10, fade: 1.2, from: 6.5, start: 6.5, to: 15.5 },
    { end: 0, fade: 1.2, from: 15.5, start: 10, to: 24 },
  ];

  it("shows the part before underneath while the new part comes in, and only the new part after", () => {
    expect(planBlend(clip, plan, 3).mix).toBe(1);
    const start = planBlend(clip, plan, 6.5);
    expect(start.mix).toBe(0);
    expect(start.under).toBeCloseTo(6.5);
    const middle = planBlend(clip, plan, 7.1);
    expect(middle.mix).toBeCloseTo(0.5, 1);
    expect(middle.under).toBeCloseTo(6.5);
    expect(middle.at).toBeCloseTo(6.5 + 0.6 * (3.5 / 9), 2);
    expect(planBlend(clip, plan, 7.8).under).toBeUndefined();
    expect(planBlend(clip, plan, 16.1).under).toBeCloseTo(9.999, 2);
    expect(planBlend(clip, plan, 16.1).reverse).toBe(true);
  });
});
