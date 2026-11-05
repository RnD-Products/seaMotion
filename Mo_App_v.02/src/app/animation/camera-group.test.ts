import { describe, expect, it } from "vitest";

import type { AnimationSpec } from "./animation-spec";
import { cameraGroupArea, cameraOnGroup, findCameraGroup } from "./camera-group";
import { readCamera, type SceneCamera } from "./camera";

const design = {
  blocks: [
    {
      height: 1200,
      id: "fg",
      items: [{ h: 1040, id: "bg", kind: "shape", w: 1440, x: 80, y: 80 }],
      name: "t",
      s: 1,
      width: 1600,
      x: 0,
      y: 0,
    },
  ],
  height: 1200,
  width: 1600,
};
const spec = { assets: {}, code: "", controls: [], design, fonts: [], id: "figma-design-x", imageAssets: [], layers: [{ id: "bg", name: "bg" }], name: "t", version: 1 } as unknown as AnimationSpec;
const layers = [
  { id: "cam", kind: "group", name: "Camera" },
  { id: "bg", name: "Container background", parentGroupId: "cam" },
];

describe("camera on the Camera group", () => {
  it("takes its frame from the group's box in percent of the picture", () => {
    expect(findCameraGroup(layers)?.id).toBe("cam");
    expect(cameraGroupArea(spec, layers, {}, { height: 1200, width: 1600 })).toEqual({ height: (1040 / 1200) * 100, radii: [0, 0, 0, 0], radius: 0, radiusGroup: null, width: 90, x: 5, y: (80 / 1200) * 100 });
  });

  it("gives the camera window the corner radius of the group, or of the group that clips around it", () => {
    const nested = [
      { id: "container", kind: "group", name: "Container" },
      { id: "cam", kind: "group", name: "Camera", parentGroupId: "container" },
      { id: "bg", name: "Container background", parentGroupId: "cam" },
    ];
    const params = { __groupStyle: { container: { clip: true, radius: [8, 8, 8, 8] } } };
    expect(cameraGroupArea(spec, nested, params, { height: 1200, width: 1600 })).toMatchObject({ radius: 8, radiusGroup: "container" });
    const camera: SceneCamera = { delay: 0, duration: 1, focusX: 50, focusY: 50, from: { pitch: 0, yaw: 0, zoom: 1 }, to: { pitch: 0, yaw: 0, zoom: 2 } };
    expect(cameraOnGroup(camera, cameraGroupArea(spec, nested, params, { height: 1200, width: 1600 }))?.area?.radius).toBe(8);
  });

  it("keeps the dark edges unless the camera turns them off", () => {
    expect(readCamera({ focusX: 50, focusY: 50 })?.vignette).toBeUndefined();
    expect(readCamera({ focusX: 50, focusY: 50, vignette: false })?.vignette).toBe(false);
  });

  it("follows the group when it is moved or scaled, and has no area without a Camera group", () => {
    const moved = cameraGroupArea(spec, layers, { __layerSize: { cam: { lock: true, rot: 0, sx: 50, sy: 50, x: 100, y: 0 } } }, { height: 1200, width: 1600 });
    expect(moved).toMatchObject({ width: 45, x: 11.25 });
    expect(cameraGroupArea(spec, [{ id: "bg", name: "Container background" }], {}, { height: 1200, width: 1600 })).toBeNull();
  });

  it("measures focus points inside the group", () => {
    const area = cameraGroupArea(spec, layers, {}, { height: 1200, width: 1600 });
    const camera: SceneCamera = { delay: 0, duration: 1, focusX: 50, focusY: 50, from: { pitch: 0, yaw: 0, zoom: 1 }, to: { focusX: 100, focusY: 0, pitch: 0, yaw: 0, zoom: 2 } };
    const placed = cameraOnGroup(camera, area);
    expect(placed?.focusX).toBeCloseTo(50);
    expect(placed?.to.focusX).toBeCloseTo(95);
    expect(placed?.to.focusY).toBeCloseTo(80 / 12);
    expect(placed?.area).toMatchObject({ width: 90, x: 5 });
  });
});
