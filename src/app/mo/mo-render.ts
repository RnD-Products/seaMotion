import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { ToolcraftState } from "@/toolcraft/runtime";

import { AnimationSandbox } from "../animation/animation-sandbox";
import { MO_PROJECTS_TARGET, readMoProjects } from "./mo-projects";
import { drawInteractions, getCursorLayerId, isInteractionsOn, mapDesignPoint, readInteractions } from "../animation/interactions";
import { areStickiesShown, drawMockup, drawStickies, getBackdropSources, getMockupViewport, loadBackdropImages, readBackdrop, readDesignBackground } from "../animation/backdrop";
import { layoutFrame, measureFrameBounds } from "../animation/design-bounds";
import { allFx, LANDING_SECTIONS_TARGET, motionGroups, readSectionMotions, withWaits, type LayerFx } from "../animation/landing-motion";
import { effectivePlan, evaluateScroll, LANDING_PLAN_TARGET, motionBlurLength, readLandingPlan, startAt } from "../animation/landing-plan";
import { MOTION_TYPE_TARGET, readMotionType } from "../animation/motion-type";
import { cameraWindow, drawCameraView, poseAt } from "../animation/camera";
import { cameraGroupArea, cameraOnGroup } from "../animation/camera-group";
import { resolveProjectScenes, sceneFrame as frameOfScene, sceneParams, sceneValuesList } from "../animation/scenes";
import { drawFramedBitmap, frameWindow, readFramePerspective, readFrameStyle, readFrameTransform } from "../animation/frame-transform";
import {
  ANIMATION_PARAMS_TARGET,
  getActiveAnimation,
  getLayerStack,
  getRenderSize,
  readTextOverrides,
  resolveParams,
  type AnimationSpec,
} from "../animation/animation-spec";
import { getSceneRect } from "../animation/scene-rect";
import { createMoVideoEncoder, type MoVideoCodec } from "./mo-video-encoder";
import { getSoundtrack, needsDragPaths, soundtrackRequest } from "../animation/sound";
import { buildClipSound, mixSound, soundingClips } from "../media/media-sound";
import { sampleDragPaths } from "../animation/drag-motion";
import { getScenesSoundtrack } from "../animation/scene-sound";

export type MoRenderFormat = "gif" | "mp4" | "webm";
export type MoRenderResolution = "0.25k" | "0.5k" | "original" | "2k" | "4k";

const LONG_EDGE: Record<Exclude<MoRenderResolution, "original">, number> = {
  "0.25k": 640,
  "0.5k": 1280,
  "2k": 2560,
  "4k": 3840,
};
const VIDEO_FPS_OPTIONS = [30, 60] as const;
const GIF_ALPHA_CUTOFF = 128;
const GIF_FPS_OPTIONS = [12, 18, 24, 30, 60] as const;
const RESOLUTIONS: readonly MoRenderResolution[] = ["0.5k", "original", "2k", "4k"];
const GIF_RESOLUTIONS: readonly MoRenderResolution[] = ["0.25k", "0.5k", "original"];

function readResolution(
  value: unknown,
  allowed: readonly MoRenderResolution[],
  fallback: MoRenderResolution,
): MoRenderResolution {
  return allowed.find((option) => option === value) ?? fallback;
}

function readMaxBytes(value: unknown): number {
  const mb = typeof value === "number" && Number.isFinite(value) ? Math.min(200, Math.max(1, value)) : 10;
  return mb * 1024 * 1024;
}

// The video bitrate that fits `maxBytes` over `duration`, after the sound, with 12% to spare (encoders overshoot).
export function bitrateForSize(maxBytes: number, durationSeconds: number, audio: AudioBuffer | null): number {
  const audioBits = audio ? 160_000 * durationSeconds : 0;
  return Math.max(0, (maxBytes * 8 * 0.88 - audioBits) / Math.max(0.1, durationSeconds));
}

// Below this a video turns to mush; the size is then too small for the length and resolution.
const MIN_VIDEO_BITRATE = 150_000;
const SIZE_ATTEMPTS = 4;

function readFps(value: unknown, allowed: readonly number[], fallback: number): number {
  const fps = Number(value);
  return allowed.includes(fps) ? fps : fallback;
}

// GIF frame delays are whole centiseconds and browsers play anything under
// 2 cs at a much slower rate, so frames are sampled at the rate the file can
// actually play (12 -> 12.5, 18 -> 16.7, 60 -> 50 fps).
function getGifDelayCentiseconds(fps: number): number {
  return Math.max(2, Math.round(100 / fps));
}

export type MoRenderRequest = Readonly<{
  reportProgress: (progress: number) => void;
  signal: AbortSignal;
  state: ToolcraftState;
}>;

export type MoRenderResult = Readonly<{
  byteLength: number;
  // Video codec actually used; null for GIF.
  codec: MoVideoCodec | null;
  fileName: string;
  frames: number;
  height: number;
  width: number;
}>;

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function getMoRenderSize(
  size: Readonly<{ height: number; width: number }>,
  resolution: MoRenderResolution,
): Readonly<{ height: number; width: number }> {
  // Original keeps the canvas size as it is.
  if (resolution === "original") return { height: even(size.height), width: even(size.width) };
  const longEdge = LONG_EDGE[resolution];
  const ratio = size.width / size.height;
  return ratio >= 1
    ? { height: even(longEdge / ratio), width: longEdge }
    : { height: longEdge, width: even(longEdge * ratio) };
}

export function readMoRenderSettings(values: Readonly<Record<string, unknown>>): Readonly<{
  fps: number;
  format: MoRenderFormat;
  // The largest the video file may be, in bytes; null for any size (and for GIF).
  maxBytes: number | null;
  resolution: MoRenderResolution;
  transparent: boolean;
}> {
  const value = values["render.format"];
  const format: MoRenderFormat = value === "webm" || value === "gif" ? value : "mp4";
  // MP4 has no alpha channel, so the switch only applies to WebM and GIF.
  const transparent = format !== "mp4" && values["render.transparent"] === true;
  if (format === "gif") {
    return {
      fps: readFps(values["render.gifFps"], GIF_FPS_OPTIONS, 24),
      format,
      maxBytes: null,
      resolution: readResolution(values["render.gifResolution"], GIF_RESOLUTIONS, "original"),
      transparent,
    };
  }
  return {
    fps: readFps(values["render.videoFps"], VIDEO_FPS_OPTIONS, 60),
    format,
    maxBytes: values["render.sizeLimit"] === "under" ? readMaxBytes(values["render.maxMb"]) : null,
    resolution: readResolution(values["render.resolution"], RESOLUTIONS, "original"),
    transparent,
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type FramePainter = (timeSeconds: number) => Promise<void>;

function readBackground(state: ToolcraftState): string {
  const value = state.values["appearance.background"];
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#DFDFDF";
}

function createFramePainter(
  canvas: HTMLCanvasElement,
  state: ToolcraftState,
  spec: AnimationSpec,
  sandbox: AnimationSandbox,
  transparent: boolean,
): FramePainter {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Rendering needs a 2D canvas context.");
  const rect = getSceneRect(state.canvas.size);
  // The scenes play one after another; each picture is drawn with its own scene's settings and time.
  const scenes = resolveProjectScenes(state.values, state.timeline.durationSeconds);
  const eachSceneValues = sceneValuesList(state.values, state.defaults, scenes);
  const cursorLayerId = getCursorLayerId(spec.layers);
  const sceneSettings = new Map<number, Readonly<{ exportParams: Record<string, unknown>; interactionItems: ReturnType<typeof readInteractions>; trackLayer: string | undefined }>>();
  const settingsOf = (frame: ReturnType<typeof frameOfScene>): { exportParams: Record<string, unknown>; interactionItems: ReturnType<typeof readInteractions>; trackLayer: string | undefined } => {
    const known = sceneSettings.get(frame.index);
    if (known) return known;
    const made = {
      exportParams: { ...sceneParams(spec, frame, state.layers), __preview: false, __previewQuality: 2 },
      interactionItems: readInteractions(frame.values),
      trackLayer: isInteractionsOn(frame.values) && cursorLayerId ? cursorLayerId : undefined,
    };
    sceneSettings.set(frame.index, made);
    return made;
  };
  const exportParams = settingsOf(frameOfScene(state.values, state.defaults, scenes, 0, eachSceneValues)).exportParams;
  const fullStack = getLayerStack(spec, state.layers);
  const background = readBackground(state);
  const storedTransform = readFrameTransform(state.values);
  const framePerspective = readFramePerspective(state.values);
  const frameStyle = readFrameStyle(state.values);
  const backdrop = readBackdrop(state.values);
  const stickiesShown = areStickiesShown(state.values, state.canvas.size, spec.size);
  const backdropImages = loadBackdropImages(getBackdropSources(backdrop));
  // The frame's box is measured once; every frame of the render uses it.
  const frameBounds = measureFrameBounds(sandbox, spec, {
    canvas: rect,
    durationSeconds: state.timeline.durationSeconds,
    params: exportParams,
  });
  const duration = state.timeline.durationSeconds;
  // A Landing Page scrolls by its Scroll plan.
  const sectionMotions = readSectionMotions(state.values[LANDING_SECTIONS_TARGET]);
  const landing =
    spec.page && readMotionType(state.values[MOTION_TYPE_TARGET]) === "landing"
      ? { page: spec.page, plan: withWaits(effectivePlan(readLandingPlan(state.values[LANDING_PLAN_TARGET]), spec.page), spec.page, sectionMotions) }
      : null;
  let cameraBuffer: HTMLCanvasElement | null = null;
  // The design's "Camera" group, when it has one, is the frame the scene cameras zoom inside.
  const cameraArea = cameraGroupArea(spec, state.layers, resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]), getRenderSize(spec, rect));
  return async (globalSeconds) => {
    const sceneNow = frameOfScene(state.values, state.defaults, scenes, globalSeconds, eachSceneValues);
    const { exportParams: sceneExportParams, interactionItems, trackLayer } = settingsOf(sceneNow);
    const timeSeconds = sceneNow.localSeconds;
    // The animation draws on a transparent picture in its own sandbox; the background goes under it here.
    const pixelScale = canvas.width / rect.width;
    const drawSize = getRenderSize(spec, rect);
    const scrolled = landing ? evaluateScroll(landing.plan, landing.page, timeSeconds) : null;
    const part = landing && scrolled && scrolled.loading !== null ? startAt(landing.plan, timeSeconds) : null;
    const start = part ? { color: part.color, index: part.index, preset: part.preset, progress: part.progress, time: timeSeconds } : undefined;
    const motionFx = landing ? allFx(sectionMotions, landing.plan, landing.page, timeSeconds, duration) : null;
    // A render always has the scroll's motion blur, whatever the preview shows.
    const blurLength = landing ? motionBlurLength(landing.plan, landing.page, timeSeconds, false) : 0;
    const { bitmap, tracked } = await sandbox.renderTracked({
      durationSeconds: sceneNow.duration,
      height: drawSize.height,
      // While the kit is on, the animation's own cursor layer is left out of the picture.
      layerStack: trackLayer && interactionItems.length > 0 ? fullStack.filter((id) => id !== trackLayer) : fullStack,
      mediaDurationSeconds: state.timeline.durationSeconds,
      mediaTimeSeconds: globalSeconds,
      texts: readTextOverrides(state.values),
      params: scrolled ? withScroll(sceneExportParams, scrolled, motionFx, motionGroups(sectionMotions, state.layers)) : sceneExportParams,
      pixelHeight: Math.max(1, Math.ceil(drawSize.height * pixelScale)),
      pixelScale,
      pixelWidth: Math.max(1, Math.ceil(drawSize.width * pixelScale)),
      timeSeconds,
      trackLayer,
      width: drawSize.width,
    });
    // The scene's camera: the picture is drawn on a buffer and placed in 3D on the canvas.
    const camera = cameraOnGroup(sceneNow.scene.scene.camera ?? undefined, cameraArea);
    const pose = poseAt(camera, sceneNow.localSeconds);
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (transparent) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const measured = await frameBounds;
    const { bounds, transform: frameTransform } = layoutFrame(measured, spec, state.canvas.size, storedTransform);
    const images = await backdropImages;
    const viewport = getMockupViewport(backdrop, images, { height: canvas.height, width: canvas.width });
    drawFramedBitmap(
      context,
      bitmap,
      frameTransform,
      pixelScale,
      bounds ? { rect: bounds, renderSize: drawSize, style: frameStyle } : undefined,
      (target2d) => drawMockup(target2d, backdrop, images, { height: canvas.height, width: canvas.width }, readDesignBackground(spec.design as Parameters<typeof readDesignBackground>[0])),
      (target2d) => {
        if (stickiesShown) drawStickies(target2d, backdrop, images, { height: canvas.height, width: canvas.width }, pixelScale);
        const cursor =
          trackLayer && tracked
            ? mapDesignPoint({ x: tracked.x, y: tracked.y }, drawSize, frameTransform, { height: canvas.height, width: canvas.width }, pixelScale)
            : null;
        // While the animation's cursor is off the picture (before it enters, after it leaves) the kit draws nothing.
        if (!trackLayer || tracked) drawInteractions(target2d, interactionItems, timeSeconds, canvas.width, canvas.height, pixelScale, cursor, {
          carriesOn: sceneNow.carriesOn,
          ...(sceneNow.leadsOn ? { leadsOnAt: sceneNow.duration } : {}),
          place: (xPercent, yPercent) => mapDesignPoint({ x: (xPercent / 100) * drawSize.width, y: (yPercent / 100) * drawSize.height }, drawSize, frameTransform, { height: canvas.height, width: canvas.width }, pixelScale),
        });
      },
      start,
      blurLength,
      viewport ? { perspective: framePerspective, viewport, transform: storedTransform } : undefined,
    );
    bitmap.close();
    if (pose && camera) {
      // The picture inside the frame is zoomed and angled; the frame and what is around it stay as they are.
      cameraBuffer ??= document.createElement("canvas");
      cameraBuffer.width = canvas.width;
      cameraBuffer.height = canvas.height;
      cameraBuffer.getContext("2d")?.drawImage(canvas, 0, 0);
      drawCameraView(context, cameraBuffer, pose, pose.focusX, pose.focusY, cameraWindow(camera, frameWindow(bounds ? { rect: bounds, renderSize: drawSize, style: frameStyle } : undefined, frameTransform, pixelScale, canvas), canvas, pixelScale), (target2d) =>
        // The window's rounded corners show the artboard behind the picture.
        drawMockup(target2d, backdrop, images, { height: canvas.height, width: canvas.width }, readDesignBackground(spec.design as Parameters<typeof readDesignBackground>[0])),
      );
    }
  };
}

function withScroll(params: Record<string, unknown>, state: { y: number }, fx: Record<string, LayerFx> | null, groups: Record<string, string[]> | null): Record<string, unknown> {
  return { ...params, ...(fx ? { __fx: fx } : {}), ...(groups ? { __groups: groups } : {}), __scrollY: state.y };
}

async function renderVideo(
  request: MoRenderRequest,
  canvas: HTMLCanvasElement,
  paint: FramePainter,
  format: "mp4" | "webm",
  fps: number,
  transparent: boolean,
  range: readonly [number, number] = [0, request.state.timeline.durationSeconds],
  // The final render carries the project's interaction sounds and music; the temporary preview does not.
  audio: AudioBuffer | null = null,
  bitrate?: number,
): Promise<Readonly<{ blob: Blob; codec: MoVideoCodec }>> {
  const startSeconds = Math.max(0, range[0]);
  const duration = Math.max(1 / fps, range[1] - startSeconds);
  const frames = Math.max(1, Math.round(duration * fps));
  const encoder = await createMoVideoEncoder({
    alpha: transparent,
    audio,
    ...(bitrate === undefined ? {} : { bitrate }),
    canvas,
    durationSeconds: frames / fps,
    frameRate: fps,
    requestedFormat: format,
    signal: request.signal,
  });
  try {
    for (let index = 0; index < frames; index += 1) {
      request.signal.throwIfAborted();
      await paint(startSeconds + index / fps);
      await encoder.addFrame(index / fps, 1 / fps, index % (fps * 2) === 0);
      request.reportProgress(((index + 1) / frames) * 0.95);
      if (index % 4 === 0) await yieldToBrowser();
    }
    return { blob: await encoder.finalize(), codec: encoder.codec };
  } catch (error) {
    await encoder.cancel().catch(() => undefined);
    throw error;
  }
}

export type TemporaryPreviewResult = Readonly<{
  blob: Blob;
  codec: MoVideoCodec;
  fps: number;
  frames: number;
  height: number;
  width: number;
}>;

// Creates an in-memory 0.5K/30 FPS video. The caller owns the resulting Blob URL;
// unlike Render this never downloads a file or changes export settings.
export async function renderTemporaryPreview(
  request: MoRenderRequest,
  range: readonly [number, number],
): Promise<TemporaryPreviewResult> {
  const fps = 30;
  const size = getMoRenderSize(request.state.canvas.size, "0.5k");
  const spec = getActiveAnimation(request.state.values);
  if (!spec) throw new Error("This project has no animation to preview.");
  const sandbox = new AnimationSandbox(spec);
  await sandbox.ready;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const paint = createFramePainter(canvas, request.state, spec, sandbox, false);
    const rendered = await renderVideo(request, canvas, paint, "mp4", fps, false, range);
    const frames = Math.max(1, Math.round(Math.max(1 / fps, range[1] - range[0]) * fps));
    request.reportProgress(1);
    return { ...rendered, fps, frames, height: size.height, width: size.width };
  } finally {
    sandbox.dispose();
    canvas.width = 1;
    canvas.height = 1;
  }
}

function hexToRgb(hex: string): number[] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Ordered dithering hides gradient banding; it is position-stable, so static
// pixels still match between frames and stay transparent in the delta.
function ditherInPlace(rgba: Uint8ClampedArray, width: number): void {
  const pixels = rgba.length / 4;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const x = pixel % width;
    const y = (pixel / width) | 0;
    const offset = ((BAYER_4[(y & 3) * 4 + (x & 3)] ?? 0) - 7.5) * 0.9;
    const base = pixel * 4;
    const r = rgba[base] ?? 0;
    const g = rgba[base + 1] ?? 0;
    const b = rgba[base + 2] ?? 0;
    // Keep pure flat colors exact.
    if ((r === 255 && g === 255 && b === 255) || (r === g && g === b)) continue;
    rgba[base] = r + offset;
    rgba[base + 1] = g + offset;
    rgba[base + 2] = b + offset;
  }
}

// applyPalette matches in RGB565 space, which can snap pure white to a
// near-white; put exact flat colors back on their pinned palette slots.
function restorePinnedColors(
  rgba: Uint8ClampedArray,
  indexed: Uint8Array,
  pinned: readonly number[][],
): void {
  for (let pixel = 0; pixel < indexed.length; pixel += 1) {
    const base = pixel * 4;
    for (let slot = 0; slot < pinned.length; slot += 1) {
      const color = pinned[slot] as number[];
      if (rgba[base] === color[0] && rgba[base + 1] === color[1] && rgba[base + 2] === color[2]) {
        indexed[pixel] = slot;
        break;
      }
    }
  }
}

async function renderGif(
  request: MoRenderRequest,
  canvas: HTMLCanvasElement,
  paint: FramePainter,
  background: string,
  fps: number,
  transparent: boolean,
): Promise<Readonly<{ blob: Blob; frames: number }>> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("GIF rendering needs a 2D canvas context.");
  const duration = request.state.timeline.durationSeconds;
  const delayCentiseconds = getGifDelayCentiseconds(fps);
  const frameSeconds = delayCentiseconds / 100;
  const frames = Math.max(1, Math.round(duration / frameSeconds));
  const { height, width } = canvas;

  // One shared palette sampled across the loop keeps colors stable between
  // frames and lets unchanged pixels become transparent (tiny files).
  const sampleTimes = [0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68].map((u) => u * duration);
  const stride = Math.max(1, Math.floor((width * height) / 120_000));
  const sample = new Uint8ClampedArray(Math.ceil((width * height) / stride) * 4 * sampleTimes.length);
  let cursor = 0;
  for (const time of sampleTimes) {
    request.signal.throwIfAborted();
    await paint(time);
    const data = context.getImageData(0, 0, width, height).data;
    for (let pixel = 0; pixel < width * height; pixel += stride) {
      // Transparent pixels carry no color worth reserving a palette entry for.
      if (transparent && (data[pixel * 4 + 3] ?? 0) < GIF_ALPHA_CUTOFF) continue;
      sample[cursor] = data[pixel * 4] ?? 0;
      sample[cursor + 1] = data[pixel * 4 + 1] ?? 0;
      sample[cursor + 2] = data[pixel * 4 + 2] ?? 0;
      sample[cursor + 3] = 255;
      cursor += 4;
    }
    await yieldToBrowser();
  }
  // Pin the flat design colors exactly so the card stays pure white.
  const pinned = [[255, 255, 255], hexToRgb(background), [17, 24, 17], [26, 27, 31]];
  const palette = [...pinned, ...quantize(sample.subarray(0, cursor), 255 - pinned.length)];
  const transparentIndex = palette.length;
  const fullPalette = [...palette, [0, 0, 0]];

  const encoder = GIFEncoder();
  const delay = delayCentiseconds * 10;
  let previous: Uint8Array | null = null;
  for (let index = 0; index < frames; index += 1) {
    request.signal.throwIfAborted();
    await paint(index * frameSeconds);
    const rgba = context.getImageData(0, 0, width, height).data;
    ditherInPlace(rgba, width);
    const indexed = applyPalette(rgba, palette);
    restorePinnedColors(rgba, indexed, pinned);
    if (transparent) {
      // GIF alpha is 1-bit: every frame is written whole and cleared before the next.
      for (let pixel = 0; pixel < indexed.length; pixel += 1) {
        if ((rgba[pixel * 4 + 3] ?? 0) < GIF_ALPHA_CUTOFF) indexed[pixel] = transparentIndex;
      }
      encoder.writeFrame(indexed, width, height, {
        delay,
        dispose: 2,
        palette: fullPalette,
        transparent: true,
        transparentIndex,
        ...(index === 0 ? { repeat: 0 } : {}),
      });
      request.reportProgress(((index + 1) / frames) * 0.97);
      await yieldToBrowser();
      continue;
    }
    if (previous) {
      const delta = new Uint8Array(indexed.length);
      for (let pixel = 0; pixel < indexed.length; pixel += 1) {
        const value = indexed[pixel] ?? 0;
        delta[pixel] = value === previous[pixel] ? transparentIndex : value;
      }
      encoder.writeFrame(delta, width, height, {
        delay,
        dispose: 1,
        palette: fullPalette,
        transparent: true,
        transparentIndex,
      });
    } else {
      encoder.writeFrame(indexed, width, height, { delay, palette: fullPalette, repeat: 0 });
    }
    previous = indexed;
    request.reportProgress(((index + 1) / frames) * 0.97);
    await yieldToBrowser();
  }
  encoder.finish();
  return { blob: new Blob([encoder.bytes().slice()], { type: "image/gif" }), frames };
}

// The project's interaction sounds and music for the render; a drag sound follows the cursor's real movement.
async function buildRenderSound(request: MoRenderRequest, spec: AnimationSpec, sandbox: AnimationSandbox): Promise<AudioBuffer | null> {
  const { values } = request.state;
  const durationSeconds = request.state.timeline.durationSeconds;
  // Every scene has its own sound; they are laid one after another. With one scene this is the project's sound as it is.
  const scenes = resolveProjectScenes(values, durationSeconds);
  const eachValues = sceneValuesList(values, request.state.defaults, scenes);
  const requests: (ReturnType<typeof soundtrackRequest>)[] = [];
  for (const item of scenes.items) {
    const own = eachValues[item.index] ?? values;
    const paths = needsDragPaths(own)
      ? await sampleDragPaths(sandbox, spec, {
          canvas: request.state.canvas.size,
          durationSeconds: item.duration,
          items: readInteractions(own),
          params: own[ANIMATION_PARAMS_TARGET],
        }).catch(() => undefined)
      : undefined;
    requests.push(soundtrackRequest(own, item.duration, paths));
  }
  const first = requests[0] ?? null;
  const base = scenes.many
    ? await getScenesSoundtrack(requests, scenes.items.map((item) => item.duration)).catch(() => null)
    : first
      ? await getSoundtrack(first).catch(() => null)
      : null;
  // Videos whose Sound is on are heard in the render too.
  const clips = soundingClips(spec, values[ANIMATION_PARAMS_TARGET] as Readonly<Record<string, unknown>> | undefined, new Set(getLayerStack(spec, request.state.layers)));
  const clipSound = await buildClipSound(spec, clips, durationSeconds).catch(() => null);
  return mixSound(base, clipSound);
}

// A video under `maxBytes` when set: the bitrate is worked out from the size and length, and a file that still
// comes out too big is rendered again at a bitrate lowered by how much it was over.
async function renderVideoUnder(
  request: MoRenderRequest,
  canvas: HTMLCanvasElement,
  paint: FramePainter,
  format: "mp4" | "webm",
  fps: number,
  transparent: boolean,
  audio: AudioBuffer | null,
  maxBytes: number | null,
): Promise<Readonly<{ blob: Blob; codec: MoVideoCodec }>> {
  if (maxBytes === null) return renderVideo(request, canvas, paint, format, fps, transparent, undefined, audio);
  const duration = request.state.timeline.durationSeconds;
  let bitrate = bitrateForSize(maxBytes, duration, audio);
  const tooSmall = (): Error =>
    new Error(`${(maxBytes / 1024 / 1024).toFixed(0)} MB is too small for a ${duration.toFixed(1)} s video at this resolution. Raise the limit, pick a lower resolution, or shorten the timeline.`);
  for (let attempt = 1; ; attempt += 1) {
    if (bitrate < MIN_VIDEO_BITRATE) throw tooSmall();
    const result = await renderVideo(request, canvas, paint, format, fps, transparent, undefined, audio, bitrate);
    if (result.blob.size <= maxBytes) return result;
    if (attempt >= SIZE_ATTEMPTS) throw tooSmall();
    bitrate *= (maxBytes / result.blob.size) * 0.85;
  }
}

export async function renderMoMotion(
  request: MoRenderRequest,
): Promise<MoRenderResult> {
  const { fps, format, maxBytes, resolution, transparent } = readMoRenderSettings(request.state.values);
  const size = getMoRenderSize(request.state.canvas.size, resolution);
  const spec = getActiveAnimation(request.state.values);
  if (!spec) throw new Error("This project has no animation to render. Add a motion or open a project file first.");
  const sandbox = new AnimationSandbox(spec);
  await sandbox.ready;
  request.reportProgress(0.01);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const paint = createFramePainter(canvas, request.state, spec, sandbox, transparent);
    const rendered =
      format === "gif"
        ? {
            ...(await renderGif(request, canvas, paint, readBackground(request.state), fps, transparent)),
            codec: null,
          }
        : {
            ...(await renderVideoUnder(request, canvas, paint, format, fps, transparent, await buildRenderSound(request, spec, sandbox), maxBytes)),
            frames: Math.max(1, Math.round(request.state.timeline.durationSeconds * fps)),
          };
    const { blob } = rendered;
    const extension = blob.type === "video/webm" ? "webm" : blob.type === "video/mp4" ? "mp4" : "gif";
    // The file is named after the open project.
    const projects = readMoProjects(request.state.values[MO_PROJECTS_TARGET]);
    const projectName = projects.items.find((item) => item.id === projects.currentId)?.name ?? "Render";
    const safeName = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim() || "Render";
    const fileName = `${safeName}.${extension}`;
    request.signal.throwIfAborted();
    download(blob, fileName);
    request.reportProgress(1);
    return { byteLength: blob.size, codec: rendered.codec, fileName, frames: rendered.frames, height: size.height, width: size.width };
  } finally {
    sandbox.dispose();
    canvas.width = 1;
    canvas.height = 1;
  }
}
