import { describe, expect, it } from "vitest";

import { cameraWindow, coveringShift, NO_POSE, poseAt, readCamera, type SceneCamera } from "./camera";

const camera: SceneCamera = { delay: 0.2, duration: 1, focusX: 88.4, focusY: 59.8, from: NO_POSE, to: { pitch: 4, yaw: -10, zoom: 2.2 } };

describe("a scene's camera", () => {
  it("looks straight at the whole picture before it moves and settles on the end pose after", () => {
    expect(poseAt(camera, 0)).toBeNull();
    expect(poseAt(camera, 0.2)).toBeNull();
    expect(poseAt(camera, 5)).toEqual({ focusX: 88.4, focusY: 59.8, pitch: 4, yaw: -10, zoom: 2.2 });
  });

  it("moves with an ease in and out, half way in the middle of the move", () => {
    const middle = poseAt(camera, 0.7);
    expect(middle?.zoom).toBeCloseTo(Math.sqrt(2.2), 5);
    expect(middle?.yaw).toBeCloseTo(-5, 5);
    const early = poseAt(camera, 0.4);
    expect(early?.zoom).toBeLessThan(1.1);
  });

  it("can pull back out to the whole picture", () => {
    const back: SceneCamera = { ...camera, delay: 0, from: camera.to, to: NO_POSE };
    expect(poseAt(back, 0)?.zoom).toBe(2.2);
    expect(poseAt(back, 1)).toBeNull();
  });

  it("reads a saved camera safely", () => {
    expect(readCamera(undefined)).toBeUndefined();
    expect(readCamera(null)).toBeUndefined();
    const read = readCamera({ delay: -3, duration: 0, focusX: 400, from: { zoom: 0.2, yaw: 90 }, to: { zoom: 9 } });
    expect(read?.delay).toBe(0);
    expect(read?.duration).toBe(0.05);
    expect(read?.focusX).toBe(100);
    expect(read?.from).toEqual({ pitch: 0, yaw: 45, zoom: 1 });
    expect(read?.to.zoom).toBe(6);
  });
});

describe("the camera stays inside the frame", () => {
  it("does not move the picture when it already covers the frame", () => {
    expect(coveringShift(1600, 1200, 50, 50, { pitch: 2, yaw: -4, zoom: 1.9 })).toEqual([0, 0]);
    expect(coveringShift(1600, 1200, 50, 50, NO_POSE)).toEqual([0, 0]);
  });

  it("keeps all the angle and moves the picture a little when looking at a corner would let an edge in", () => {
    const [dx, dy] = coveringShift(1600, 1200, 0, 0, { pitch: 2, yaw: -4, zoom: 2.05 });
    expect(Math.hypot(dx, dy)).toBeGreaterThan(0);
    // A few pixels on a 1600-wide picture, not a different framing.
    expect(Math.hypot(dx, dy)).toBeLessThan(80);
  });
});

describe("a camera that pans", () => {
  it("moves its focus point from one place to another with the zoom", () => {
    const pan: SceneCamera = {
      delay: 0,
      duration: 1,
      focusX: 50,
      focusY: 50,
      from: { focusX: 88, focusY: 60, pitch: 4, yaw: -10, zoom: 2.2 },
      to: { focusX: 27, focusY: 37, pitch: 3, yaw: 6, zoom: 2 },
    };
    const middle = poseAt(pan, 0.5);
    expect(middle?.focusX).toBeCloseTo(57.5, 5);
    expect(middle?.focusY).toBeCloseTo(48.5, 5);
    expect(poseAt(pan, 1)?.focusX).toBe(27);
  });

  it("uses the camera's own focus for a pose that names none", () => {
    expect(poseAt({ ...camera, delay: 0 }, 5)?.focusX).toBe(88.4);
  });
});

describe("the frame the camera zooms inside", () => {
  const container = { height: 86.667, radius: 0, width: 90, x: 5, y: 6.667 };

  it("is a part of the picture given in percent", () => {
    const window = cameraWindow({ ...camera, area: container }, null, { height: 1200, width: 1600 }, 1);
    expect(window?.x).toBeCloseTo(80, 0);
    expect(window?.y).toBeCloseTo(80, 0);
    expect(window?.width).toBeCloseTo(1440, 0);
    expect(window?.height).toBeCloseTo(1040, 0);
  });

  it("is the part of the picture (not of the canvas) when the picture sits inside the canvas", () => {
    const window = cameraWindow({ ...camera, area: container }, { height: 600, radius: 0, width: 800, x: 400, y: 300 }, { height: 1200, width: 1600 }, 1);
    expect(window?.x).toBeCloseTo(440, 0);
    expect(window?.width).toBeCloseTo(720, 0);
  });

  it("is the picture itself when no frame is set, and the area survives saving", () => {
    expect(cameraWindow(camera, null, { height: 1200, width: 1600 }, 1)).toBeNull();
    expect(readCamera({ area: container })?.area?.width).toBeCloseTo(90);
  });
});

describe("the speed of a camera move", () => {
  const base = { delay: 0, duration: 2, focusX: 50, focusY: 50, from: { pitch: 0, yaw: 0, zoom: 1 }, to: { pitch: 0, yaw: 10, zoom: 1 } } as const;

  it("is smooth by default and the same all the way when linear", () => {
    expect(poseAt(base, 0.5)?.yaw ?? 0).toBeLessThan(2.5 * 0.5);
    expect(poseAt({ ...base, ease: "linear" }, 0.5)?.yaw).toBeCloseTo(2.5);
    expect(readCamera({ ...base, ease: "linear" })?.ease).toBe("linear");
    expect(readCamera({ ...base, ease: "weird" })?.ease).toBeUndefined();
  });
});
