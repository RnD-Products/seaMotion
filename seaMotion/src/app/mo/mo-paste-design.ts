import type { ToolcraftState } from "@/toolcraft/runtime";

import {
  ANIMATION_LIBRARY_TARGET,
  ANIMATION_PARAMS_TARGET,
  ANIMATION_TYPE_TARGET,
  getActiveAnimation,
  getLayerStack,
  getRenderSize,
  readAnimationLibrary,
  resolveParams,
  type AnimationSpec,
} from "../animation/animation-spec";
import { getProbeSandbox } from "../animation/layer-texts";
import type { DesignBounds } from "../animation/animation-sandbox";
import {
  addPastedBlock,
  backdropValues,
  buildProjectFromFigmaPaste,
  fitDesignToBackdrop,
  nextBlockPrefix,
  parseFigmaPaste,
  placeBlock,
  readFigmaDesign,
  removeFigmaItems,
} from "./figma-paste-import";
import { compressPictures, formatSize } from "./mo-compress";
import { resolveDesignFonts } from "./mo-fonts";
import { dataUrlToBlob } from "../media/media-clip";
import { makeMediaPoster, readMediaFile, withAnimatedPicture } from "../media/media-layer";
import type { ProjectFileLayer } from "./mo-projects";

// Pasting a Figma design into the open project, in place: a project without a drawing takes the design as its
// drawing (and its size); otherwise the design is added on top of what is there, or (Paste to replace) put where a
// layer was, filling that layer's box, and the layer goes.

type PasteCommand =
  | { label: string; type: "controls.apply"; values: Record<string, unknown> }
  | { label: string; mode: "finite"; size: { height: number; unit: "px"; width: number }; type: "canvas.applySettings" }
  | { layerId: string; type: "layers.delete" }
  | { insertIndex: number; layer: ProjectFileLayer; type: "layers.add" };

export type PastePlan = Readonly<{ commands: readonly PasteCommand[]; frameName: string; note?: string; resized: boolean }>;

export type ReplaceTarget = Readonly<{ box: DesignBounds | null; layerId: string }>;

type PasteState = Pick<ToolcraftState, "layers" | "values"> & Readonly<{ canvasSize: Readonly<{ height: number; width: number }> }>;

function libraryWith(values: Readonly<Record<string, unknown>>, spec: AnimationSpec): Record<string, unknown> {
  const library = readAnimationLibrary(values[ANIMATION_LIBRARY_TARGET]);
  return { items: { ...library.items, [spec.id]: spec } };
}

// The layer and everything inside it, as Layers lists them.
function blockIds(layers: ToolcraftState["layers"], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const layer of layers) {
      if (layer.parentGroupId && ids.has(layer.parentGroupId) && !ids.has(layer.id)) {
        ids.add(layer.id);
        grew = true;
      }
    }
  }
  return ids;
}

// Picture fills that are GIFs play: each becomes an animated picture (its first frame is the still).
async function animateGifPictures(spec: AnimationSpec): Promise<AnimationSpec> {
  let next = spec;
  for (const block of readFigmaDesign(spec)?.blocks ?? []) {
    for (const item of block.items) {
      const key = item.pic?.asset;
      const source = key ? spec.assets[key] : undefined;
      if (!key || !source?.startsWith("data:image/gif") || next.assetMedia?.[key]) continue;
      try {
        const info = await readMediaFile(new File([await dataUrlToBlob(source)], `${key}.gif`, { type: "image/gif" }));
        next = withAnimatedPicture(next, key, info, await makeMediaPoster(info));
      } catch {
        // A GIF that cannot be decoded stays a still picture.
      }
    }
  }
  return next;
}

// The same paste with the plugin's "Artboard" marks taken off (so the frame is not read as the artboard).
function withoutArtboardMark(text: string): string {
  try {
    const clean = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(clean);
      if (typeof node !== "object" || node === null) return node;
      const record = node as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (key === "mark" && value === "bg") continue;
        next[key] = clean(value);
      }
      return next;
    };
    return JSON.stringify(clean(JSON.parse(text)));
  } catch {
    return text;
  }
}

export async function planDesignPaste(text: string, state: PasteState, replace?: ReplaceTarget): Promise<PastePlan> {
  const spec = getActiveAnimation(state.values);
  if (!spec) {
    // No drawing yet: the design becomes the project's drawing, at the design's size.
    const file = buildProjectFromFigmaPaste(text);
    const loaded = file.animation ? await animateGifPictures(await resolveDesignFonts(file.animation)) : null;
    if (!loaded) throw new Error("Could not read that design.");
    // The pictures the plugin exported are recompressed without visible loss.
    const packed = await compressPictures(loaded.assets, Object.keys(loaded.assets));
    const animation = { ...loaded, assets: packed.assets };
    const size = file.canvas?.size ?? { height: 1080, width: 1920 };
    return {
      commands: [
        {
          label: "Paste design",
          type: "controls.apply",
          values: { ...(file.values ?? {}), [ANIMATION_LIBRARY_TARGET]: libraryWith(state.values, animation), [ANIMATION_PARAMS_TARGET]: {}, [ANIMATION_TYPE_TARGET]: animation.id },
        },
        { label: "Paste design", mode: "finite", size: { ...size, unit: "px" }, type: "canvas.applySettings" },
        ...state.layers.map((layer) => ({ layerId: layer.id, type: "layers.delete" as const })),
        ...(file.layers ?? []).map((layer, index) => ({ insertIndex: index, layer, type: "layers.add" as const })),
      ],
      frameName: file.name,
      ...(packed.before > packed.after ? { note: `Pictures compressed without visible loss: ${formatSize(packed.before)} → ${formatSize(packed.after)}.` } : {}),
      resized: true,
    };
  }
  if (spec.lottie) throw new Error("A Lottie Animation project cannot take a pasted design. Paste it into another project.");

  const design = readFigmaDesign(spec);
  // A canvas holds one artboard: when it already has one, whatever is pasted goes into it. A frame marked "Artboard" is then an ordinary
  // frame inside it (it keeps its fill) and does not change the artboard's name, size or colour.
  const hasArtboard = (design?.blocks.length ?? 0) > 0;
  const mainLayer = hasArtboard && !replace ? state.layers.find((layer) => layer.kind === "group" && !layer.parentGroupId) : undefined;
  const parsed = parseFigmaPaste(hasArtboard ? withoutArtboardMark(text) : text, nextBlockPrefix(spec));
  const renderSize = getRenderSize(spec, state.canvasSize);
  const area = design ? { height: design.height, width: design.width } : renderSize;
  const target = replace ? state.layers.find((layer) => layer.id === replace.layerId) : undefined;
  // The layer's box is measured on the drawing; the design sits centered in it.
  const ox = (renderSize.width - area.width) / 2;
  const oy = (renderSize.height - area.height) / 2;
  const box = target && replace?.box ? { h: replace.box.height, w: replace.box.width, x: replace.box.x - ox, y: replace.box.y - oy } : null;
  // A pasted design never changes the artboard's size or settings. It keeps its own width and height (a design bigger than the artboard is
  // not scaled down) and runs past the artboard's edges where it is bigger.
  const place = placeBlock(parsed.block, area, box);
  let next = addPastedBlock(spec, parsed, area, place);
  // A layer marked "Artboard" in a project with no design yet: the drawing becomes exactly that frame (so the canvas and the
  // drawing agree). A project that already holds a design keeps its drawing size and only takes the background and name.
  const fitsArtboard = Boolean(parsed.backdrop) && !replace && (design?.blocks.length ?? 0) === 0;
  if (fitsArtboard && parsed.backdrop) next = fitDesignToBackdrop(next, parsed.block.id, parsed.backdrop);
  const commands: PasteCommand[] = [];
  let insertAt = 0;
  let parentGroupId: string | undefined;
  if (mainLayer) {
    // Into the artboard: the pasted layers become the first layers of the main layer.
    insertAt = state.layers.findIndex((layer) => layer.id === mainLayer.id) + 1;
    parentGroupId = mainLayer.id;
  }
  if (target) {
    // The replaced layer goes: from the design when it is a pasted layer, and from Layers.
    const gone = blockIds(state.layers, target.id);
    next = removeFigmaItems(next, gone);
    insertAt = Math.max(0, state.layers.findIndex((layer) => layer.id === target.id));
    parentGroupId = target.parentGroupId;
  }
  next = await animateGifPictures(await resolveDesignFonts(next));
  // The pictures this paste brought are recompressed without visible loss (smallest of lossless WebP and PNG).
  const packed = await compressPictures(next.assets, Object.keys(parsed.assets));
  next = { ...next, assets: packed.assets };
  commands.push({
    label: target ? "Paste to replace" : "Paste design",
    type: "controls.apply",
    values: { [ANIMATION_LIBRARY_TARGET]: libraryWith(state.values, next), [ANIMATION_TYPE_TARGET]: next.id },
  });
  if (target) commands.push({ layerId: target.id, type: "layers.delete" });
  parsed.layers.forEach((layer, index) => {
    const placed = !layer.parentGroupId && parentGroupId ? { ...layer, parentGroupId } : layer;
    commands.push({ insertIndex: insertAt + index, layer: placed, type: "layers.add" });
  });
  // A layer marked "Artboard": its fill, name and size become the artboard's.
  if (parsed.backdrop && !target) {
    commands.push({ label: "Artboard background", type: "controls.apply", values: backdropValues(parsed.backdrop) });
    if (fitsArtboard) {
      commands.push({ label: "Artboard size", mode: "finite", size: { height: parsed.backdrop.height, unit: "px", width: parsed.backdrop.width }, type: "canvas.applySettings" });
    }
  }
  return {
    commands,
    frameName: parsed.name,
    ...(packed.before > packed.after ? { note: `Pictures compressed without visible loss: ${formatSize(packed.before)} → ${formatSize(packed.after)}.` } : {}),
    resized: fitsArtboard,
  };
}

// Where the layer (with everything inside it) is drawn now, in the drawing's pixels; null when it draws nothing or
// the drawing is not ready.
export async function measureLayerBox(
  state: PasteState & Readonly<{ durationSeconds: number; timeSeconds: number }>,
  layerId: string,
): Promise<DesignBounds | null> {
  const spec = getActiveAnimation(state.values);
  const sandbox = getProbeSandbox();
  if (!spec || !sandbox) return null;
  const ids = blockIds(state.layers, layerId);
  const stack = getLayerStack(spec, state.layers).filter((id) => ids.has(id));
  if (stack.length === 0) return null;
  const size = getRenderSize(spec, state.canvasSize);
  const scale = Math.min(1, 1600 / Math.max(size.width, size.height));
  try {
    return await sandbox.measureBounds({
      durationSeconds: state.durationSeconds,
      height: size.height,
      layerStack: stack,
      params: resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]),
      pixelHeight: Math.max(1, Math.ceil(size.height * scale)),
      pixelScale: scale,
      pixelWidth: Math.max(1, Math.ceil(size.width * scale)),
      timeSeconds: state.timeSeconds,
      width: size.width,
    });
  } catch {
    return null;
  }
}
