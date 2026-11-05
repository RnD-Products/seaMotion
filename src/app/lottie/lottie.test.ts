import { describe, expect, it } from "vitest";

import { ANIMATION_LIBRARY_TARGET, ANIMATION_TYPE_TARGET } from "../animation/animation-spec";
import { parseProjectFile } from "../mo/mo-projects";
import { isLottieData, lottieInfo, lottieLayers, prepareLottie } from "./lottie-data";
import { buildProjectFromLottie } from "./lottie-project";
import { checkLottieData, checkLottieExport } from "./lottie-support";
import { buildLottieExport, toDotLottie } from "./lottie-export";
import type { ToolcraftState } from "@/toolcraft/runtime";

const shapeLayer = (ind: number, nm: string, extra: Record<string, unknown> = {}) => ({
  ddd: 0,
  ind,
  ip: 0,
  ks: { a: { a: 0, k: [0, 0, 0] }, o: { a: 0, k: 100 }, p: { a: 0, k: [50, 50, 0] }, r: { a: 0, k: 0 }, s: { a: 0, k: [100, 100, 100] } },
  nm,
  op: 60,
  shapes: [{ it: [{ d: 1, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] }, ty: "el" }, { c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, ty: "fl" }], ty: "gr" }],
  sr: 1,
  st: 0,
  ty: 4,
  ...extra,
});

const LOTTIE = { fr: 30, h: 100, ip: 0, layers: [shapeLayer(1, "Dot"), shapeLayer(2, "Ring")], nm: "Dots", op: 60, v: "5.12.0", w: 200 };

function projectValues(lottie: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const file = buildProjectFromLottie(lottie as typeof LOTTIE, "dots.json");
  return {
    ...file.values,
    [ANIMATION_LIBRARY_TARGET]: { items: { [file.animation!.id]: file.animation } },
    [ANIMATION_TYPE_TARGET]: file.animation!.id,
    ...extra,
  };
}

describe("Lottie Animation", () => {
  it("recognises a Lottie file and reads its size, rate and length", () => {
    expect(isLottieData(LOTTIE)).toBe(true);
    expect(isLottieData({ values: {} })).toBe(false);
    expect(lottieInfo(LOTTIE)).toMatchObject({ durationSeconds: 2, fps: 30, height: 100, width: 200 });
    expect(lottieLayers(LOTTIE)).toEqual([{ id: "lottie-1", name: "Dot" }, { id: "lottie-2", name: "Ring" }]);
  });

  it("opens a Lottie .json as a Lottie Animation project at its own size and length", () => {
    const file = parseProjectFile(JSON.stringify(LOTTIE), "dots.json");
    expect(file.values["motion.type"]).toBe("lottie");
    expect(file.canvas?.size).toEqual({ height: 100, width: 200 });
    expect(file.durationSeconds).toBe(2);
    expect(file.animation?.lottie).toEqual(LOTTIE);
    expect(file.layers?.map((layer) => layer.name)).toEqual(["Dot", "Ring"]);
  });

  it("prepares the file: hidden layers off, layer opacity and blend written in, optional background", () => {
    const data = prepareLottie(LOTTIE, { background: "#112233", hidden: ["lottie-2"], styles: { "lottie-1": { blend: "multiply", opacity: 50 } } });
    const layers = data.layers as Record<string, unknown>[];
    expect(layers[1]?.hd).toBe(true);
    expect(layers[0]?.bm).toBe(1);
    expect((layers[0]?.ks as { o: { k: number } }).o.k).toBe(50);
    expect(layers[2]).toMatchObject({ nm: "Background", sc: "#112233", sh: 100, sw: 200, ty: 1 });
    expect(LOTTIE.layers).toHaveLength(2);
  });

  it("lists unsupported Lottie features with the layers they are in", () => {
    const issues = checkLottieData({
      ...LOTTIE,
      layers: [
        shapeLayer(1, "Glow", { ef: [{ ty: 25 }] }),
        shapeLayer(2, "Wobble", { ks: { o: { a: 0, k: 100, x: "wiggle(2, 10)" } } }),
        { ddd: 0, ind: 3, ip: 0, nm: "Title", op: 60, t: { d: { k: [{ s: { f: "Inter", t: "Hi" }, t: 0 }] } }, ty: 5 },
        shapeLayer(4, "Blob", { shapes: [{ ty: "mm" }] }),
      ],
    });
    expect(issues.map((issue) => issue.id).sort()).toEqual(["effects", "expressions", "font-text", "merge-paths"]);
    expect(issues.find((issue) => issue.id === "effects")?.where).toEqual(["Glow"]);
    for (const issue of issues) {
      expect(issue.why.length).toBeGreaterThan(10);
      expect(issue.fix.length).toBeGreaterThan(10);
    }
  });

  it("passes a clean Lottie project and flags what the app adds on top", () => {
    expect(checkLottieExport(projectValues(LOTTIE), 2)).toEqual([]);
    const issues = checkLottieExport(projectValues(LOTTIE, { "interactions.enabled": true }), 3);
    expect(issues.map((issue) => issue.id)).toEqual(["timeline-length", "reactor"]);
  });

  it("blocks a project whose motion is a drawing script", () => {
    const issues = checkLottieExport({ "motion.type": "lottie" }, 5);
    expect(issues).toEqual([expect.objectContaining({ blocking: true, id: "no-lottie-data" })]);
  });

  it("exports what the Layers panel shows, with the Background layer when asked", () => {
    const state = {
      layers: [
        { id: "lottie-1", kind: "layer", name: "Dot", visible: true },
        { id: "lottie-2", kind: "layer", name: "Ring", visible: false },
      ],
      timeline: { durationSeconds: 2 },
      values: projectValues(LOTTIE, { "appearance.background": "#ABCDEF", "lottie.background": true }),
    } as unknown as ToolcraftState;
    const { data, leftOut } = buildLottieExport(state);
    const layers = data.layers as Record<string, unknown>[];
    expect(leftOut).toBe(0);
    expect(layers.map((layer) => [layer.nm, layer.hd ?? false])).toEqual([["Dot", false], ["Ring", true], ["Background", false]]);
    expect(layers[2]?.sc).toBe("#abcdef");
  });

  it("refuses to export a project without Lottie data, saying why", () => {
    const state = { layers: [], timeline: { durationSeconds: 5 }, values: { "motion.type": "lottie" } } as unknown as ToolcraftState;
    expect(() => buildLottieExport(state)).toThrow(/No animation yet/);
  });

  it("packs a dotLottie file", () => {
    const bytes = toDotLottie(LOTTIE, "dots");
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});
