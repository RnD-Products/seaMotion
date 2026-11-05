import { describe, expect, it } from "vitest";

import { ANIMATION_FRAME_TARGET } from "./animation-spec";
import {
  DEFAULT_FRAME_PERSPECTIVE,
  DEFAULT_FRAME_TRANSFORM,
  getPerspectiveClipRect,
  getPerspectiveDestinationCorners,
  readFramePerspective,
} from "./frame-transform";

describe("frame perspective pins", () => {
  it("defaults to a disabled rectangular fit", () => {
    expect(readFramePerspective({})).toEqual(DEFAULT_FRAME_PERSPECTIVE);

    expect(
      getPerspectiveDestinationCorners(
        { height: 50, topBleed: 2, width: 100, x: 10, y: 20 },
        DEFAULT_FRAME_TRANSFORM,
        DEFAULT_FRAME_PERSPECTIVE,
        1,
      ),
    ).toEqual({
      bottomLeft: { x: 10, y: 70 },
      bottomRight: { x: 110, y: 70 },
      topLeft: { x: 10, y: 20 },
      topRight: { x: 110, y: 20 },
    });
  });

  it("lets the perspective frame cover the mockup's top separator without exposing the bezel", () => {
    expect(getPerspectiveClipRect({ height: 50, topBleed: 2, width: 100, x: 10, y: 20 })).toEqual({
      height: 52,
      width: 100,
      x: 10,
      y: 18,
    });
  });

  it("clamps saved pin offsets and moves each corner independently", () => {
    const perspective = readFramePerspective({
      [ANIMATION_FRAME_TARGET]: {
        perspective: {
          enabled: true,
          points: {
            bottomLeft: { x: 0, y: 0 },
            bottomRight: { x: 0, y: 0 },
            topLeft: { x: 2, y: -2 },
            topRight: { x: 0.1, y: 0.2 },
          },
        },
      },
    });

    // Frame settings are switched off (FRAME_SETTINGS_ACTIVE): stored pins are ignored and the frame stays flat.
    expect(perspective.enabled).toBe(false);
    expect(perspective.points.topLeft).toEqual({ x: 0, y: 0 });
    expect(
      getPerspectiveDestinationCorners(
        { height: 50, topBleed: 2, width: 100, x: 10, y: 20 },
        DEFAULT_FRAME_TRANSFORM,
        // The pins as they would be read when frame settings are on (clamped to half the box).
        {
          enabled: true,
          points: { bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 0, y: 0 }, topLeft: { x: 0.5, y: -0.5 }, topRight: { x: 0.1, y: 0.2 } },
        },
        1,
      ),
    ).toMatchObject({
      topLeft: { x: 60, y: -5 },
      topRight: { x: 120, y: 30 },
    });
  });
});
