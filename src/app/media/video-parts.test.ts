import { describe, expect, it } from "vitest";

import { planBlend, planGainAt, planPartAt, removeVideoPart, resizeVideoPart, retimeVideoPart, setVideoPartDuration, splitVideoParts, videoParts } from "./media-layer";

const media = { duration: 10 };

describe("video parts", () => {
  it("turns a clip into one part, then splits it where the playhead is", () => {
    const one = videoParts(media, { fit: true, sound: true }, 11);
    expect(one).toEqual([{ end: 10, from: 0, sound: true, start: 0, to: 11 }]);
    const two = splitVideoParts(one, 5.5);
    expect(two?.map((part) => [part.from, part.to, part.start, part.end])).toEqual([[0, 5.5, 0, 5], [5.5, 11, 5, 10]]);
    expect(splitVideoParts(one, 0.05)).toBeNull();
  });

  it("removes a part and lets the neighbour take its time", () => {
    const two = splitVideoParts(videoParts(media, {}, 11), 4) ?? [];
    expect(removeVideoPart(two, 1)?.map((part) => [part.from, part.to])).toEqual([[0, 10]]);
    expect(removeVideoPart(two, 0)?.map((part) => [part.from, part.to])).toEqual([[0, 10]]);
    expect(removeVideoPart(removeVideoPart(two, 1) ?? [], 0)).toBeNull();
  });

  it("fit stretches the whole plan over the project and a part can be muted on its own", () => {
    const plan = [{ end: 10, from: 0, sound: true, start: 0, to: 5 }, { end: 0, from: 5, sound: false, start: 10, to: 10 }];
    expect(planBlend(media, plan, 5.5).at).toBeCloseTo(10 - 0.5 * 2);
    expect(planBlend(media, plan, 11, 20).at).toBeCloseTo(10 - ((11 / 20) * 10 - 5) * 2);
    expect(planPartAt(plan, 7)?.sound).toBe(false);
    expect(planPartAt(plan, 2)?.sound).toBe(true);
  });

  it("has transitions: dissolve, dip to black, fade in and fade out", () => {
    const base = { end: 10, from: 0, start: 0, to: 5 };
    const dissolve = [base, { end: 10, fade: 1, from: 5, start: 0, to: 10 }];
    expect(planBlend(media, dissolve, 5.5).mix).toBeCloseTo(0.5);
    const dip = [base, { end: 10, fade: 1, from: 5, start: 0, style: "dip" as const, to: 10 }];
    const early = planBlend(media, dip, 5.3);
    expect(early.black).toBeGreaterThan(0.5);
    expect(early.at).toBeCloseTo(10, 1); // the part before, held on its last picture
    expect(planBlend(media, dip, 5.5).black).toBeCloseTo(1);
    expect(planBlend(media, dip, 5.9).black).toBeLessThan(0.2);
    const fadeIn = [{ ...base, fade: 1, style: "fade" as const }];
    expect(planBlend(media, fadeIn, 0.5).alpha).toBeCloseTo(0.5);
    expect(planBlend(media, fadeIn, 2).alpha).toBe(1);
    const fadeOut = [{ ...base, fadeOut: 1 }];
    expect(planBlend(media, fadeOut, 4.5).alpha).toBeCloseTo(0.5);
    expect(planGainAt(fadeOut, 4.5)).toBeCloseTo(0.5);
    expect(planGainAt(dissolve, 5.5)).toBeCloseTo(0.5);
  });

  it("resizing a part moves the cut and keeps both speeds", () => {
    const two = splitVideoParts(videoParts(media, {}, 10), 5) ?? [];
    const moved = resizeVideoPart(two, 0, 7);
    expect(moved.map((part) => [part.from, part.to])).toEqual([[0, 7], [7, 10]]);
    expect(moved[0]?.end).toBeCloseTo(7);
    expect(moved[1]?.start).toBeCloseTo(7);
    expect(resizeVideoPart(two, 0, 20)[0]?.to).toBe(9.9);
  });

  it("auto links Start, Duration and End at normal speed; manual keeps them apart", () => {
    // Part 2 lasts 5 – 11 s and plays the whole clip (0 – 10 s) fast.
    const parts = [{ end: 5, from: 0, start: 0, to: 5 }, { end: 10, from: 5, start: 0, to: 6.3 }];
    // Start 0 and the End is counted: Start + Duration.
    const sliding = retimeVideoPart(parts, 1, { start: 0 }, true, 11, 10);
    expect([sliding[1]?.start, sliding[1]?.end, sliding[1]?.to]).toEqual([0, 1.3, 6.3]);
    // Start moves along the clip, the duration stays; it stops where the clip ends.
    const later = retimeVideoPart(sliding, 1, { start: 9.5 }, true, 11, 10);
    expect([later[1]?.start, later[1]?.end, later[1]?.to]).toEqual([9.5, 10, 5.5]);
    // End sets the duration.
    const longer = retimeVideoPart(sliding, 1, { end: 4 }, true, 11, 10);
    expect([longer[1]?.end, longer[1]?.to]).toEqual([4, 9]);
    // Duration sets End.
    const dur = setVideoPartDuration(sliding, 1, 2, true, 11, 10);
    expect([dur[1]?.end, dur[1]?.to]).toEqual([2, 7]);
    // Manual: the clip times and the time stay apart.
    const manual = retimeVideoPart(parts, 1, { start: 2 }, false, 11, 10);
    expect([manual[1]?.start, manual[1]?.end, manual[1]?.to]).toEqual([2, 10, 6.3]);
    expect(setVideoPartDuration(parts, 1, 3, false, 11, 10)[1]?.end).toBe(10);
  });
});
