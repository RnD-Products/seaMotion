import { describe, expect, it } from "vitest";

import { FULL_PREVIEW_QUALITY, nextPreviewPlaybackQuality, shouldSubmitPreviewFrame } from "./preview-playback-quality";

describe("preview playback quality", () => {
  it("steps down after sustained slow frames and returns to full quality only when paused", () => {
    let quality = FULL_PREVIEW_QUALITY;
    for (let index = 0; index < 6; index += 1) {
      quality = nextPreviewPlaybackQuality(quality, true, { renderMs: 40, skipped: false, timeSeconds: index / 60 });
    }
    expect(quality).toEqual({ factor: 0.75, slowSamples: 0, targetFps: 30 });

    for (let index = 0; index < 6; index += 1) {
      quality = nextPreviewPlaybackQuality(quality, true, { renderMs: 10, skipped: false, timeSeconds: index / 30 });
    }
    expect(quality.factor).toBe(0.75);
    expect(nextPreviewPlaybackQuality(quality, false)).toEqual(FULL_PREVIEW_QUALITY);
  });

  it("treats replaced renders as pressure and gates 30 FPS submissions", () => {
    let quality = FULL_PREVIEW_QUALITY;
    for (let index = 0; index < 6; index += 1) {
      quality = nextPreviewPlaybackQuality(quality, true, { renderMs: 12, skipped: true, timeSeconds: index / 60 });
    }
    expect(quality.targetFps).toBe(30);
    expect(shouldSubmitPreviewFrame(100, 120, quality.targetFps)).toBe(false);
    expect(shouldSubmitPreviewFrame(100, 134, quality.targetFps)).toBe(true);
  });
});
