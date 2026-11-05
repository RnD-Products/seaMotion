import { describe, expect, it } from "vitest";

import type { AnimationSpec } from "../animation/animation-spec";
import {
  blurMembers,
  addPastedBlock,
  buildProjectFromFigmaPaste,
  designFonts,
  findFigmaItem,
  frameDefaultStyle,
  frameIds,
  nextBlockPrefix,
  parseFigmaPaste,
  placeBlock,
  withDesignArea,
  pruneFigmaDesign,
  readFigmaDesign,
  removeFigmaItems,
  withMissingFonts,
} from "./figma-paste-import";
import { isDefaultProjectName } from "./mo-projects";

const paste = (name: string): string =>
  JSON.stringify({
    nodes: [
      {
        abs: { height: 300, width: 400, x: 0, y: 0 },
        children: [
          {
            abs: { height: 120, width: 200, x: 20, y: 20 },
            fills: [{ opacity: 1, scaleMode: "FILL", type: "IMAGE" }],
            height: 120,
            image: { opacity: 1, scaleMode: "FIT", src: "data:image/png;base64,AAAA" },
            name: "Photo",
            type: "RECTANGLE",
            width: 200,
            x: 20,
            y: 20,
          },
          {
            abs: { height: 64, width: 360, x: 20, y: 220 },
            characters: "Hello",
            height: 64,
            name: "Title",
            text: { fontFamily: "Mo Missing", fontSize: 48, fontStyle: "Medium", fontWeight: 500, fonts: [{ family: "Mo Missing", size: 48, style: "Medium", weight: 500 }] },
            textPng: "data:image/png;base64,BBBB",
            textPngBox: { height: 64, width: 360, x: 20, y: 220 },
            type: "TEXT",
            width: 360,
            x: 20,
            y: 220,
          },
        ],
        fills: [{ color: "#f4f4f4", opacity: 1, type: "SOLID" }],
        height: 300,
        name,
        type: "FRAME",
        width: 400,
        x: 0,
        y: 0,
      },
    ],
    type: "mo-figma-layers",
    version: 7,
  });

describe("pasted Figma designs", () => {
  it("names the main layer after the frame and keeps picture files and text pictures", () => {
    const parsed = parseFigmaPaste(paste("Card A"));
    expect(parsed.layers[0]).toMatchObject({ kind: "group", name: "Card A" });
    const photo = parsed.block.items.find((item) => item.pic);
    expect(photo?.pic).toMatchObject({ mode: "FIT", only: true });
    const title = parsed.block.items.find((item) => item.kind === "text");
    expect(title?.text).toMatchObject({ family: "Mo Missing", ib: { h: 64, w: 360, x: 20, y: 220 }, img: expect.any(String), weight: 500 });
  });

  it("adds a second paste to the same design with its own layer ids, and removes a replaced layer", () => {
    const first = buildProjectFromFigmaPaste(paste("Card A")).animation as AnimationSpec;
    const prefix = nextBlockPrefix(first);
    const parsed = parseFigmaPaste(paste("Card B"), prefix);
    const box = { h: 120, w: 200, x: 20, y: 20 };
    const place = placeBlock(parsed.block, { height: 300, width: 400 }, box);
    expect(place.s).toBeCloseTo(0.4);
    const merged = addPastedBlock(first, parsed, { height: 300, width: 400 }, place);
    expect(readFigmaDesign(merged)?.blocks).toHaveLength(2);
    expect(merged.layers.every((layer, index, all) => all.findIndex((other) => other.id === layer.id) === index)).toBe(true);
    const photoId = readFigmaDesign(first)?.blocks[0]?.items.find((item) => item.pic)?.id ?? "";
    const without = removeFigmaItems(merged, new Set([photoId]));
    expect(findFigmaItem(without, photoId)).toBeNull();
    expect(Object.keys(without.assets).some((key) => key === `pic-${photoId}`)).toBe(false);
  });

  it("marks texts whose font is missing until the design carries it", () => {
    const spec = buildProjectFromFigmaPaste(paste("Card A")).animation as AnimationSpec;
    expect(designFonts(spec)).toEqual([{ family: "Mo Missing", style: "Medium", weight: 500 }]);
    const missing = withMissingFonts(spec, () => false);
    const textId = readFigmaDesign(missing)?.blocks[0]?.items.find((item) => item.kind === "text")?.id ?? "";
    expect(findFigmaItem(missing, textId)?.text?.missing).toEqual(["mo missing|medium"]);
    const carried = withMissingFonts({ ...missing, fonts: [{ asset: "font-x", family: "Mo Missing", style: "normal", weight: "500" }] }, () => false);
    expect(findFigmaItem(carried, textId)?.text?.missing).toBeUndefined();
  });

  it("centers a blurred vector's picture on the shape's own box, at the picture's real size", () => {
    // A 2x PNG of 392 x 310 px (196 x 155 design px); its render box and page box are stale (far from the shape).
    const header = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 136, 0, 0, 1, 54, 8, 6, 0, 0, 0, 0, 0, 0, 0];
    const png = `data:image/png;base64,${btoa(String.fromCharCode(...header))}`;
    const text = JSON.stringify({
      nodes: [
        {
          abs: { height: 344, width: 320, x: 0, y: 0 },
          children: [{ abs: { height: 147, width: 188, x: 24, y: 127 }, height: 147, name: "Ring", type: "VECTOR", vectorPng: png, vectorPngBox: { height: 155, width: 196, x: 20, y: 123 }, width: 188, x: 48, y: 253 }],
          height: 344,
          name: "Card",
          type: "FRAME",
          width: 320,
          x: 0,
          y: 0,
        },
      ],
      type: "mo-figma-layers",
    });
    const ring = parseFigmaPaste(text).block.items.find((item) => item.kind === "png");
    expect(ring).toMatchObject({ h: 155, w: 196, x: 44, y: 249 });
  });

  it("places a group's children in the group's parent space (a group adds no offset of its own)", () => {
    const text = JSON.stringify({
      nodes: [
        {
          abs: { height: 344, width: 320, x: 0, y: 0 },
          children: [
            {
              children: [{ fills: [{ color: "#e7e7e7", opacity: 1, type: "SOLID" }], height: 147, name: "Track", type: "RECTANGLE", width: 266, x: 24, y: 127 }],
              height: 147,
              name: "Group",
              type: "GROUP",
              width: 266,
              x: 24,
              y: 127,
            },
          ],
          height: 344,
          name: "Card",
          type: "FRAME",
          width: 320,
          x: 0,
          y: 0,
        },
      ],
      type: "mo-figma-layers",
    });
    const track = parseFigmaPaste(text).block.items.find((item) => item.w === 266);
    expect(track).toMatchObject({ x: 24, y: 127 });
  });

  it("keeps one copy of a picture shown from its own file", () => {
    const withRender = JSON.parse(paste("Card A")) as { nodes: { children: Record<string, unknown>[] }[] };
    const photo = withRender.nodes[0]?.children[0];
    if (photo) photo.fillImage = "data:image/png;base64,RENDER";
    const parsed = parseFigmaPaste(JSON.stringify(withRender));
    const item = parsed.block.items.find((own) => own.pic);
    expect(item?.fillAsset).toBeUndefined();
    expect(Object.keys(parsed.assets).some((key) => key.startsWith("fill-"))).toBe(false);
  });

  it("saves a pasted design without the data of deleted layers", () => {
    const spec = buildProjectFromFigmaPaste(paste("Card A")).animation as AnimationSpec;
    const design = readFigmaDesign(spec);
    const items = design?.blocks[0]?.items ?? [];
    const photo = items.find((item) => item.pic);
    const kept = items.filter((item) => item !== photo).map((item) => ({ id: item.id }));
    const saved = pruneFigmaDesign(spec, [...kept, { id: "motion-cursor" }]);
    expect(findFigmaItem(saved, photo?.id ?? "")).toBeNull();
    expect(Object.keys(saved.assets).some((key) => key === `pic-${photo?.id}`)).toBe(false);
    expect(saved.layers.some((layer) => layer.id === photo?.id)).toBe(false);
    // Everything still in Layers stays.
    expect(readFigmaDesign(saved)?.blocks[0]?.items.length).toBe(kept.length);
    // Nothing in Layers: the paste goes entirely.
    expect(readFigmaDesign(pruneFigmaDesign(spec, []))?.blocks).toEqual([]);
  });

  it("only treats app-given names as default project names", () => {
    expect(isDefaultProjectName("Untitled 3")).toBe(true);
    expect(isDefaultProjectName("PropVera")).toBe(false);
  });
});

describe("frame settings are switched off", () => {
  it("writes no frame settings to a project file", async () => {
    const { createProjectFile } = await import("./mo-projects");
    const file = createProjectFile({
      canvas: null,
      durationSeconds: 5,
      layers: [],
      name: "Test",
      values: {
        "animation.frame": { scale: 150, fill: true },
        "animation.params": { __frame: { layer: "x" }, __text: { a: { chars: "b" } } },
      },
    }) as { params: Record<string, unknown>; values: Record<string, unknown> };
    expect(file.values["animation.frame"]).toBeUndefined();
    expect(file.params.__frame).toBeUndefined();
    expect(file.params.__text).toEqual({ a: { chars: "b" } });
  });

  it("reads the same neutral frame whatever a project stored", async () => {
    const { readFrameStyle, readFrameTransform } = await import("../animation/frame-transform");
    const stored = { "animation.frame": { clip: true, fill: true, radius: 40, rotation: 12, scale: 150, x: 80 } };
    expect(readFrameTransform(stored)).toMatchObject({ opacity: 100, rotation: 0, scale: 100, x: 0, y: 0 });
    expect(readFrameStyle(stored)).toMatchObject({ clip: false, fill: false, radius: 0, stroke: false });
  });
});

describe("placing a pasted design", () => {
  it("keeps a design bigger than the artboard at its own size, centered", () => {
    expect(placeBlock({ height: 600, width: 800 }, { height: 300, width: 400 })).toEqual({ s: 1, x: -200, y: -150 });
  });

  it("centers across a direction where the design is smaller", () => {
    expect(placeBlock({ height: 100, width: 800 }, { height: 300, width: 400 })).toEqual({ s: 1, x: -200, y: 100 });
  });

  it("centers a smaller design at its own size", () => {
    expect(placeBlock({ height: 100, width: 200 }, { height: 300, width: 400 })).toEqual({ s: 1, x: 100, y: 100 });
  });
});

describe("changing the drawing area", () => {
  it("moves every design by half of the change, so what was centered stays centered", () => {
    const first = buildProjectFromFigmaPaste(paste("Card A")).animation as AnimationSpec;
    const before = readFigmaDesign(first);
    const bigger = withDesignArea(first, { height: (before?.height ?? 0) + 200, width: (before?.width ?? 0) + 100 });
    const after = readFigmaDesign(bigger);
    expect(after?.blocks[0]?.x).toBeCloseTo((before?.blocks[0]?.x ?? 0) + 50);
    expect(after?.blocks[0]?.y).toBeCloseTo((before?.blocks[0]?.y ?? 0) + 100);
    expect(bigger.size).toEqual({ height: (before?.height ?? 0) + 200, width: (before?.width ?? 0) + 100 });
  });
});

describe("plugin marks", () => {
  const marked = (mark: string, fills: unknown[], children: unknown[] = []): string =>
    JSON.stringify({
      nodes: [
        {
          abs: { height: 300, width: 400, x: 0, y: 0 },
          children,
          fills,
          height: 300,
          mark,
          name: "Home",
          type: "FRAME",
          width: 400,
          x: 0,
          y: 0,
        },
      ],
      type: "mo-figma-layers",
      version: 9,
    });

  it("takes the artboard's name, size and solid fill from a layer marked Artboard", async () => {
    const { backdropValues, readBackdrop } = await import("./figma-paste-import");
    const text = marked("bg", [{ color: "#112233", opacity: 1, type: "SOLID" }]);
    const backdrop = readBackdrop((JSON.parse(text) as { nodes: Record<string, unknown>[] }).nodes);
    expect(backdrop).toMatchObject({ from: "#112233", height: 300, name: "Home", to: null, width: 400 });
    expect(backdropValues(backdrop!)).toMatchObject({ "appearance.background": "#112233", "artboard.name": "Home", "bg.fillType": "solid", "bg.mode": "fill" });
    const file = buildProjectFromFigmaPaste(text);
    expect(file.canvas?.size).toEqual({ height: 300, width: 400 });
    expect(file.values["bg.fillType"]).toBe("solid");
  });

  it("does not paint the artboard frame's fill again as a layer", () => {
    const parsed = parseFigmaPaste(marked("bg", [{ color: "#112233", opacity: 1, type: "SOLID" }]));
    const frame = parsed.block.items.find((item) => item.id === parsed.layers[0]?.id) ?? parsed.block.items[0];
    expect(frame?.fills).toEqual([]);
    expect(parsed.backdrop?.from).toBe("#112233");
  });

  it("keeps the fill of a frame that is not marked as the artboard", () => {
    const parsed = parseFigmaPaste(marked("", [{ color: "#112233", opacity: 1, type: "SOLID" }]));
    const frame = parsed.block.items.find((item) => item.id === parsed.layers[0]?.id) ?? parsed.block.items[0];
    expect(frame?.fills).toHaveLength(1);
  });

  it("makes a gradient artboard from a gradient fill, top to bottom", async () => {
    const { readBackdrop } = await import("./figma-paste-import");
    const fill = { opacity: 1, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }], transform: [[0, 1, 0], [-1, 0, 1]], type: "GRADIENT_LINEAR" };
    const backdrop = readBackdrop((JSON.parse(marked("bg", [fill])) as { nodes: Record<string, unknown>[] }).nodes);
    expect(backdrop).toMatchObject({ angle: 180, from: "#ff0000", to: "#0000ff" });
  });

  it("has no backdrop without the mark", async () => {
    const { readBackdrop } = await import("./figma-paste-import");
    expect(readBackdrop((JSON.parse(marked("", [])) as { nodes: Record<string, unknown>[] }).nodes)).toBeNull();
  });
});

describe("masks", () => {
  const box = (name: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    abs: { height: 100, width: 100, x: 0, y: 0 },
    fills: [{ color: "#ff0000", opacity: 1, type: "SOLID" }],
    height: 100,
    name,
    type: "RECTANGLE",
    width: 100,
    x: 0,
    y: 0,
    ...extra,
  });
  const text = JSON.stringify({
    nodes: [
      {
        abs: { height: 200, width: 200, x: 0, y: 0 },
        children: [box("Shape", { idx: 0, isMask: true }), box("Photo", { idx: 1, maskBy: 0 }), box("Free", { idx: 2 })],
        height: 200,
        name: "Card",
        type: "FRAME",
        width: 200,
        x: 0,
        y: 0,
      },
    ],
    type: "mo-figma-layers",
    version: 10,
  });

  it("links a masked layer to its mask layer and hides the mask's own drawing", () => {
    const parsed = parseFigmaPaste(text);
    const items = parsed.block.items;
    const layerId = (name: string): string => parsed.layers.find((layer) => layer.name === name)?.id ?? "";
    const photo = items.find((item) => item.id === layerId("Photo"));
    const shape = items.find((item) => item.id === layerId("Shape"));
    const free = items.find((item) => item.id === layerId("Free"));
    expect(shape?.isMask).toBe(true);
    expect(photo?.mask).toBe(layerId("Shape"));
    expect(free?.mask).toBeUndefined();
    expect(parsed.block.masks?.[layerId("Shape")]).toMatchObject({ items: [layerId("Shape")], name: "Shape" });
  });
});

describe("file-like layer names", () => {
  it("drops the hash, the %20 codes and the extension", async () => {
    const { fileLayerName } = await import("./figma-paste-import");
    expect(fileLayerName("69d256de7d74a6529b29daf1_Polygon%201.svg 2")).toBe("Polygon 1 2");
    expect(fileLayerName("Frame 12")).toBe("Frame 12");
    expect(fileLayerName("Hero image.png")).toBe("Hero image");
  });
});

describe("clear caches", () => {
  it("drops the design's picture and the fallback pictures of texts whose fonts are there, keeping the design", async () => {
    const { clearDesignCaches, findFigmaItem, withMissingFonts } = await import("./figma-paste-import");
    const data = JSON.parse(paste("Card A")) as { nodes: Record<string, unknown>[] };
    (data.nodes[0] as Record<string, unknown>).png = "data:image/png;base64,CCCC";
    const spec = buildProjectFromFigmaPaste(JSON.stringify(data)).animation as AnimationSpec;
    const withFonts = withMissingFonts(spec, () => true);
    const sweep = clearDesignCaches(withFonts);
    expect(sweep.count).toBeGreaterThan(0);
    expect("designPng" in sweep.spec.assets).toBe(false);
    const textId = readFigmaDesign(withFonts)?.blocks[0]?.items.find((item) => item.kind === "text")?.id ?? "";
    expect(findFigmaItem(sweep.spec, textId)?.text?.img).toBeUndefined();
    expect(findFigmaItem(sweep.spec, textId)?.text?.chars).toBe("Hello");
    // A text whose font is missing keeps its picture.
    const missing = withMissingFonts(spec, () => false);
    const kept = clearDesignCaches(missing);
    const keptText = readFigmaDesign(missing)?.blocks[0]?.items.find((item) => item.kind === "text")?.id ?? "";
    expect(findFigmaItem(kept.spec, keptText)?.text?.img).toBeTruthy();
  });
});

describe("artboard mark sizes the drawing too", () => {
  it("makes the drawing exactly the marked frame, so the canvas and the drawing agree", () => {
    const text = JSON.stringify({
      nodes: [
        {
          abs: { height: 800, width: 1000, x: 0, y: 0 },
          children: [
            {
              abs: { height: 300, width: 400, x: 100, y: 50 },
              fills: [{ color: "#ffffff", opacity: 1, type: "SOLID" }],
              height: 300,
              mark: "bg",
              name: "Frame",
              type: "FRAME",
              width: 400,
              x: 100,
              y: 50,
            },
          ],
          height: 800,
          name: "Page",
          type: "FRAME",
          width: 1000,
          x: 0,
          y: 0,
        },
      ],
      type: "mo-figma-layers",
      version: 10,
    });
    const file = buildProjectFromFigmaPaste(text);
    const spec = file.animation as AnimationSpec;
    const design = readFigmaDesign(spec);
    expect(file.canvas?.size).toEqual({ height: 300, width: 400 });
    expect(spec.size).toEqual({ height: 300, width: 400 });
    expect(design).toMatchObject({ height: 300, width: 400 });
    expect(design?.blocks[0]).toMatchObject({ s: 1, x: -100, y: -50 });
  });
});

describe("frames from Figma", () => {
  // A page frame holding a card frame (clips, rounded, filled) with a picture and a text inside, and a plain group.
  const framePaste = JSON.stringify({
    nodes: [
      {
        abs: { height: 400, width: 600, x: 0, y: 0 },
        children: [
          {
            abs: { height: 200, width: 300, x: 20, y: 20 },
            children: [
              { abs: { height: 40, width: 100, x: 30, y: 30 }, fills: [{ color: "#ff0000", opacity: 1, type: "SOLID" }], height: 40, name: "Dot", type: "RECTANGLE", width: 100, x: 10, y: 10 },
            ],
            clipsContent: true,
            cornerRadius: 16,
            fills: [{ color: "#101018", opacity: 1, type: "SOLID" }],
            height: 200,
            name: "Card",
            strokes: [{ color: "#ffffff", opacity: 0.2, type: "SOLID" }],
            strokeWeight: 1,
            type: "FRAME",
            width: 300,
            x: 20,
            y: 20,
          },
          {
            abs: { height: 80, width: 120, x: 340, y: 20 },
            children: [{ abs: { height: 20, width: 20, x: 350, y: 30 }, fills: [{ color: "#00ff00", opacity: 1, type: "SOLID" }], height: 20, name: "Chip", type: "RECTANGLE", width: 20, x: 10, y: 10 }],
            fills: [{ color: "#222222", opacity: 1, type: "SOLID" }],
            height: 80,
            name: "Row",
            type: "GROUP",
            width: 120,
            x: 340,
            y: 20,
          },
          {
            abs: { height: 60, width: 160, x: 20, y: 300 },
            autoLayout: { direction: "HORIZONTAL", flattened: true },
            children: [{ abs: { height: 20, width: 20, x: 30, y: 310 }, fills: [{ color: "#0000ff", opacity: 1, type: "SOLID" }], height: 20, name: "Item", type: "RECTANGLE", width: 20, x: 10, y: 10 }],
            cornerRadius: [4, 8, 12, 16],
            frame: true,
            height: 60,
            name: "Bar",
            type: "FRAME",
            width: 160,
            x: 20,
            y: 300,
          },
        ],
        fills: [{ color: "#f4f4f4", opacity: 1, type: "SOLID" }],
        height: 400,
        name: "Page",
        type: "FRAME",
        width: 600,
        x: 0,
        y: 0,
      },
    ],
    type: "mo-figma-layers",
    version: 7,
  });

  const parsed = parseFigmaPaste(framePaste);
  const byName = (name: string) => parsed.layers.find((layer) => layer.name === name);

  it("makes a frame one group layer, with no separate background row", () => {
    expect(byName("Card")?.kind).toBe("group");
    expect(parsed.layers.some((layer) => /background$/.test(layer.name) && layer.name.startsWith("Card"))).toBe(false);
    expect(byName("Dot")?.parentGroupId).toBe(byName("Card")?.id);
  });

  it("gives the frame's own fill the same id as the group, so it is drawn under what the frame holds", () => {
    const card = byName("Card");
    const own = parsed.block.items.find((item) => item.id === card?.id);
    expect(own?.frame).toEqual({ clip: true });
    expect(own?.fills).toHaveLength(1);
    expect(own?.radius).toBe(16);
    expect(parsed.specLayers.some((layer) => layer.id === card?.id)).toBe(true);
  });

  it("tags the clip a frame makes with the frame, and keeps its corner radius", () => {
    const card = byName("Card");
    const dot = parsed.block.items.find((item) => item.id === byName("Dot")?.id);
    expect(dot?.clips.find((clip) => clip.f === card?.id)).toMatchObject({ h: 200, r: 16, w: 300 });
  });

  it("treats an auto layout (marked frame) as a frame, with per-corner radii", () => {
    const bar = byName("Bar");
    const own = parsed.block.items.find((item) => item.id === bar?.id);
    expect(own?.frame).toEqual({ auto: true, clip: false });
    expect(own?.radius).toEqual([4, 8, 12, 16]);
  });

  it("keeps a plain group as it was: a group, with its fill as a background row", () => {
    expect(byName("Row")?.kind).toBe("group");
    expect(parsed.layers.some((layer) => layer.name === "Row background")).toBe(true);
    expect(parsed.block.items.find((item) => item.id === byName("Row")?.id)).toBeUndefined();
  });

  it("lists a frame's own fill and its default style for the Layers editor", () => {
    const { animation } = buildProjectFromFigmaPaste(framePaste);
    if (!animation) throw new Error("no animation");
    const cardId = buildProjectFromFigmaPaste(framePaste).layers?.find((layer) => layer.name === "Card")?.id as string;
    expect(frameIds(animation).has(cardId)).toBe(true);
    expect(frameDefaultStyle(animation, cardId)).toEqual({ clip: true, radius: [16, 16, 16, 16] });
    expect(frameDefaultStyle(animation, "nothing")).toBeNull();
  });
});

describe("drawn shapes and side strokes from Figma", () => {
  const gradient = { stops: [{ alpha: 1, color: "#ff0000", position: 0 }, { alpha: 1, color: "#0000ff", position: 1 }], transform: [[1, 0, 0], [0, 1, 0]], type: "GRADIENT_LINEAR" };
  const paste = JSON.stringify({
    nodes: [
      {
        abs: { height: 300, width: 500, x: 0, y: 0 },
        children: [
          { abs: { height: 40, width: 60, x: 20, y: 20 }, fills: [gradient], height: 40, name: "Blob", paths: [{ d: "M0 0L60 0L30 40Z", r: "NONZERO" }], strokeAlign: "INSIDE", strokeCap: "ROUND", strokes: [{ color: "#ffffff", opacity: 1, type: "SOLID" }], strokeWeight: 3, type: "VECTOR", width: 60, x: 20, y: 20 },
          {
            abs: { height: 80, width: 200, x: 100, y: 100 },
            children: [{ abs: { height: 20, width: 20, x: 110, y: 110 }, fills: [{ color: "#00ff00", opacity: 1, type: "SOLID" }], height: 20, name: "Dot", type: "RECTANGLE", width: 20, x: 10, y: 10 }],
            fills: [{ color: "#222222", opacity: 1, type: "SOLID" }],
            frame: true,
            height: 80,
            name: "Row",
            sideStrokes: { paints: [gradient], sides: [{ side: "BOTTOM", weight: 2 }] },
            type: "FRAME",
            width: 200,
            x: 100,
            y: 100,
          },
          { abs: { height: 1, width: 200, x: 100, y: 250 }, frame: true, height: 1, name: "Rule", sideStrokes: { paints: [{ color: "#888888", opacity: 1, type: "SOLID" }], sides: [{ side: "TOP", weight: 1 }] }, type: "FRAME", width: 200, x: 100, y: 250 },
        ],
        fills: [{ color: "#f4f4f4", opacity: 1, type: "SOLID" }],
        height: 300,
        name: "Page",
        type: "FRAME",
        width: 500,
        x: 0,
        y: 0,
      },
    ],
    type: "mo-figma-layers",
    version: 7,
  });
  const parsed = parseFigmaPaste(paste);
  const itemOf = (name: string) => parsed.block.items.find((item) => item.id === parsed.layers.find((layer) => layer.name === name)?.id);

  it("keeps a drawn shape's outline with its fill (a gradient too) and stroke", () => {
    const blob = itemOf("Blob");
    expect(blob?.kind).toBe("shape");
    expect(blob?.paths).toEqual([{ d: "M0 0L60 0L30 40Z", r: "NONZERO" }]);
    expect(blob?.fills).toHaveLength(1);
    expect((blob?.fills[0] as { type: string }).type).toBe("GRADIENT_LINEAR");
    expect(blob).toMatchObject({ cap: "ROUND", sa: "INSIDE", sw: 3 });
  });

  it("turns a one-sided stroke of a frame into a line inside the frame, with the stroke's paint", () => {
    const row = parsed.layers.find((layer) => layer.name === "Row");
    const line = parsed.layers.find((layer) => layer.name === "Row bottom line");
    expect(line?.parentGroupId).toBe(row?.id);
    const item = itemOf("Row bottom line");
    expect(item).toMatchObject({ h: 2, line: "bottom", sw: 0, w: 200, x: 100, y: 178 });
    expect((item?.fills[0] as { type: string }).type).toBe("GRADIENT_LINEAR");
    expect(itemOf("Row")?.strokes).toHaveLength(0);
  });

  it("makes a box with only a side stroke the line itself, with its own name", () => {
    expect(itemOf("Rule")).toMatchObject({ h: 1, line: "top", w: 200 });
    expect(parsed.layers.filter((layer) => layer.name.startsWith("Rule"))).toHaveLength(1);
  });
});

describe("layer blur on a group", () => {
  const blur = { blurType: "PROGRESSIVE", radius: 4, startOffset: { x: 0.5, y: 0.5 }, endOffset: { x: 0.5, y: 1 }, startRadius: 0, type: "LAYER_BLUR" };
  const paste = JSON.stringify({
    nodes: [
      {
        abs: { height: 200, width: 300, x: 0, y: 0 },
        children: [
          {
            abs: { height: 100, width: 100, x: 10, y: 10 },
            children: [
              { abs: { height: 80, width: 4, x: 20, y: 20 }, fills: [{ color: "#ffffff", opacity: 1, type: "SOLID" }], height: 80, name: "Bar", type: "RECTANGLE", width: 4, x: 10, y: 10 },
            ],
            effects: [blur],
            height: 100,
            name: "Bars",
            type: "GROUP",
            width: 100,
            x: 10,
            y: 10,
          },
        ],
        fills: [{ color: "#000000", opacity: 1, type: "SOLID" }],
        height: 200,
        name: "Page",
        type: "FRAME",
        width: 300,
        x: 0,
        y: 0,
      },
    ],
    type: "mo-figma-layers",
    version: 7,
  });

  it("keeps a progressive blur's start and end, and lists what a group's blur covers", () => {
    const { animation: built, layers: builtLayers } = buildProjectFromFigmaPaste(paste);
    const animation = built!;
    const layers = builtLayers!;
    const background = animation.design && (animation.design as { blocks: { items: { effects: { startOffset?: unknown }[]; id: string }[] }[] }).blocks[0]?.items.find((item) => item.effects.length > 0);
    expect(background?.effects[0]?.startOffset).toEqual({ x: 0.5, y: 0.5 });
    const covered = blurMembers(animation, layers as never);
    const bar = layers.find((layer) => layer.name === "Bar");
    expect(Object.values(covered).flat()).toContain(bar?.id);
  });
});

describe("pictures that reach past their box", () => {
  const svg = '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><circle cx="21" cy="21" r="3.5" fill="white"/></svg>';
  const paste = JSON.stringify({
    nodes: [
      {
        abs: { height: 100, width: 100, x: 0, y: 0 },
        children: [{ abs: { height: 13, width: 13, x: 20, y: 20 }, height: 13, name: "Dot", svg, svgBleed: { bottom: 14.5, left: 14.5, right: 14.5, top: 14.5 }, type: "ELLIPSE", width: 13, x: 20, y: 20 }],
        fills: [{ color: "#000000", opacity: 1, type: "SOLID" }],
        height: 100,
        name: "Page",
        type: "FRAME",
        width: 100,
        x: 0,
        y: 0,
      },
    ],
    type: "mo-figma-layers",
    version: 7,
  });

  it("keeps how far the picture reaches past the layer's box, as sent by the plugin", () => {
    const parsed = parseFigmaPaste(paste);
    const dot = parsed.block.items.find((item) => item.kind === "svg");
    expect(dot?.bleed).toEqual({ b: 14.5, l: 14.5, r: 14.5, t: 14.5 });
  });
});
