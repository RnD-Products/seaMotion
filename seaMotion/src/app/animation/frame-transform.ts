import { readFrameLayer } from "../mo/figma-paste-import";
import { applyIntro, drawPreloader, isIntro, isPreloader, type StartDraw } from "./start-screen";
import { ANIMATION_FRAME_TARGET, ANIMATION_PARAMS_TARGET, getActiveAnimation, resolveParams } from "./animation-spec";
import type { MockupViewport } from "./backdrop";

// Where the design sits on the canvas: an offset from the middle, a turn and an opacity.
// `boxW` / `boxH` resize only the frame rectangle (percent of its fitted size) and `lockRatio` keeps
// Width and Height moving together; the design inside is not resized by them.
export type FrameTransform = Readonly<{
  boxH: number;
  boxW: number;
  lockRatio: boolean;
  sizePreset: string;
  opacity: number;
  rotation: number;
  scale: number;
  x: number;
  y: number;
}>;

// Frame settings (position, scale, rotation, opacity, size, fill, stroke, corner radius, clip, perspective, frame layer) are
// switched off: the section is gone and the drawing ignores whatever a project stored for them, so a design is drawn as it is.
// Turn this on to bring the old behaviour back (nothing stored is removed by turning it off).
export const FRAME_SETTINGS_ACTIVE = false;

export const DEFAULT_FRAME_TRANSFORM: FrameTransform = Object.freeze({ boxH: 100, boxW: 100, lockRatio: true, sizePreset: "custom", opacity: 100, rotation: 0, scale: 100, x: 0, y: 0 });

export const PERSPECTIVE_CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
export type PerspectiveCorner = (typeof PERSPECTIVE_CORNERS)[number];
export type PerspectivePoint = Readonly<{ x: number; y: number }>;
export type FramePerspective = Readonly<{
  enabled: boolean;
  points: Readonly<Record<PerspectiveCorner, PerspectivePoint>>;
}>;

const ZERO_POINT: PerspectivePoint = Object.freeze({ x: 0, y: 0 });
export const DEFAULT_FRAME_PERSPECTIVE: FramePerspective = Object.freeze({
  enabled: false,
  points: Object.freeze({
    bottomLeft: ZERO_POINT,
    bottomRight: ZERO_POINT,
    topLeft: ZERO_POINT,
    topRight: ZERO_POINT,
  }),
});

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The whole frame record with some fields changed: transform and style are kept together, so
// editing one never drops the other.
export function mergeFrame(values: Readonly<Record<string, unknown>>, patch: Record<string, unknown>): Record<string, unknown> {
  const stored = values[ANIMATION_FRAME_TARGET];
  const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  return { ...record, ...readFrameTransform(values), ...patch };
}

export function readFrameTransform(values: Readonly<Record<string, unknown>>): FrameTransform {
  if (!FRAME_SETTINGS_ACTIVE) return DEFAULT_FRAME_TRANSFORM;
  const stored = values[ANIMATION_FRAME_TARGET];
  const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  return {
    boxH: Math.max(5, number(record.boxH, DEFAULT_FRAME_TRANSFORM.boxH)),
    boxW: Math.max(5, number(record.boxW, DEFAULT_FRAME_TRANSFORM.boxW)),
    lockRatio: record.lockRatio !== false,
    sizePreset: typeof record.sizePreset === "string" && getFrameSizePreset(record.sizePreset) ? record.sizePreset : "custom",
    opacity: number(record.opacity, DEFAULT_FRAME_TRANSFORM.opacity),
    rotation: number(record.rotation, DEFAULT_FRAME_TRANSFORM.rotation),
    scale: Math.max(1, number(record.scale, DEFAULT_FRAME_TRANSFORM.scale)),
    x: number(record.x, DEFAULT_FRAME_TRANSFORM.x),
    y: number(record.y, DEFAULT_FRAME_TRANSFORM.y),
  };
}

export function readFramePerspective(values: Readonly<Record<string, unknown>>): FramePerspective {
  if (!FRAME_SETTINGS_ACTIVE) return DEFAULT_FRAME_PERSPECTIVE;
  const stored = values[ANIMATION_FRAME_TARGET];
  const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const raw = typeof record.perspective === "object" && record.perspective !== null ? (record.perspective as Record<string, unknown>) : {};
  const rawPoints = typeof raw.points === "object" && raw.points !== null ? (raw.points as Record<string, unknown>) : {};
  const readPoint = (corner: PerspectiveCorner): PerspectivePoint => {
    const value = rawPoints[corner];
    const point = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return {
      x: Math.min(0.5, Math.max(-0.5, number(point.x, 0))),
      y: Math.min(0.5, Math.max(-0.5, number(point.y, 0))),
    };
  };
  return {
    enabled: raw.enabled === true,
    points: {
      bottomLeft: readPoint("bottomLeft"),
      bottomRight: readPoint("bottomRight"),
      topLeft: readPoint("topLeft"),
      topRight: readPoint("topRight"),
    },
  };
}

// The frame itself: the design's box (the area its Card used to fill), with a fill, a stroke, rounded
// corners and an option to cut the design off at its edge. Stored with the frame transform.
export type FrameStyle = Readonly<{
  clip: boolean;
  fill: boolean;
  fillColor: string;
  radius: number;
  stroke: boolean;
  strokeColor: string;
  strokeWidth: number;
}>;

// Ready-made frame sizes in px. "custom" (not listed) is the free Width / Height sliders.
export const FRAME_SIZE_PRESETS: readonly Readonly<{ height: number; id: string; label: string; width: number }>[] = [
  { height: 832, id: "macbook-air", label: "MacBook Air", width: 1280 },
  { height: 982, id: "macbook-pro-14", label: 'MacBook Pro 14"', width: 1512 },
  { height: 1117, id: "macbook-pro-16", label: 'MacBook Pro 16"', width: 1728 },
  { height: 1024, id: "desktop", label: "Desktop", width: 1440 },
];

export function getFrameSizePreset(id: string): (typeof FRAME_SIZE_PRESETS)[number] | undefined {
  return FRAME_SIZE_PRESETS.find((preset) => preset.id === id);
}

const HEX = /^#[0-9a-f]{6}$/i;

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value.toUpperCase() : fallback;
}

// Unset fields start from the design's old Card settings (card.color, card.radius ...), so a project
// looks the same until the frame is edited.
export function readFrameStyle(values: Readonly<Record<string, unknown>>): FrameStyle {
  if (!FRAME_SETTINGS_ACTIVE) return { clip: false, fill: false, fillColor: "#FFFFFF", radius: 0, stroke: false, strokeColor: "#FFFFFF", strokeWidth: 1 };
  const stored = values[ANIMATION_FRAME_TARGET];
  const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const spec = getActiveAnimation(values);
  const params = spec ? resolveParams(spec, values[ANIMATION_PARAMS_TARGET]) : {};
  // A pasted design whose own layer is its frame: that layer is the frame (the design draws it), so the app draws
  // no card of its own.
  if (spec?.design && readFrameLayer(params)) {
    return { clip: false, fill: false, fillColor: "#FFFFFF", radius: 0, stroke: false, strokeColor: "#FFFFFF", strokeWidth: 1 };
  }
  return {
    clip: record.clip === true,
    fill: typeof record.fill === "boolean" ? record.fill : true,
    fillColor: hex(record.fillColor, hex(params["card.color"], "#F4F4F4")),
    radius: Math.max(0, number(record.radius, number(params["card.radius"], 16))),
    stroke: record.stroke === true,
    strokeColor: hex(record.strokeColor, hex(params["card.strokeColor"], "#FFFFFF")),
    strokeWidth: Math.max(0, number(record.strokeWidth, number(params["card.strokeWidth"], 1))),
  };
}

// Where the frame sits inside the animation's picture, in design units.
export type FrameShape = Readonly<{
  rect: Readonly<{ height: number; width: number; x: number; y: number }>;
  renderSize: Readonly<{ height: number; width: number }>;
  style: FrameStyle;
}>;

// The frame's place on the canvas in canvas pixels (what the camera zooms inside), or null when the frame is turned or has no shape
// of its own (the camera then looks at the whole canvas).
export function frameWindow(
  shape: FrameShape | undefined,
  transform: FrameTransform,
  scale: number,
  canvas: Readonly<{ height: number; width: number }>,
): Readonly<{ height: number; radius: number; width: number; x: number; y: number }> | null {
  if (!shape || Math.abs(transform.rotation) > 0.01) return null;
  const k = transform.scale / 100;
  const centerX = canvas.width / 2 + transform.x * scale;
  const centerY = canvas.height / 2 + transform.y * scale;
  return {
    height: shape.rect.height * scale * k,
    radius: shape.style.radius * scale * k,
    width: shape.rect.width * scale * k,
    x: centerX + (shape.rect.x - shape.renderSize.width / 2) * scale * k,
    y: centerY + (shape.rect.y - shape.renderSize.height / 2) * scale * k,
  };
}

// What the frame is drawn from: the animation's picture. A canvas works as well as a bitmap, which lets the artboard
// show a picture put together from several (while a layer is dragged).
export type FrameBitmap = CanvasImageSource & Readonly<{ height: number; width: number }>;

// The picture smeared straight up and down over `length` canvas pixels (motion blur): several copies spread
// along the length, averaged by drawing the nth one at 1/n opacity into a scratch canvas, then clipped to the
// frame so the smear never leaves it.
let scratch: { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } | null = null;
function drawSmeared(
  context: CanvasRenderingContext2D,
  bitmap: FrameBitmap,
  length: number,
  area: { height: number; width: number; x: number; y: number },
  drawWidth = bitmap.width,
  drawHeight = bitmap.height,
): void {
  if (!scratch || scratch.canvas.width !== bitmap.width || scratch.canvas.height !== bitmap.height) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const inner = canvas.getContext("2d");
    if (!inner) {
      context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      return;
    }
    scratch = { canvas, context: inner };
  }
  const { canvas, context: draw } = scratch;
  const samples = Math.min(16, Math.max(4, Math.ceil(length / 3) + 2));
  draw.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < samples; index += 1) {
    draw.globalAlpha = 1 / (index + 1);
    draw.drawImage(bitmap, 0, (index / (samples - 1) - 0.5) * length);
  }
  draw.globalAlpha = 1;
  context.save();
  context.beginPath();
  context.rect(area.x, area.y, area.width, area.height);
  context.clip();
  context.drawImage(canvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

let perspectiveScratch: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null = null;

function getPerspectiveScratch(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  if (!perspectiveScratch || perspectiveScratch.canvas.width !== width || perspectiveScratch.canvas.height !== height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    perspectiveScratch = { canvas, context };
  }
  return perspectiveScratch;
}

function bilinearPoint(
  corners: Readonly<Record<PerspectiveCorner, PerspectivePoint>>,
  u: number,
  v: number,
): PerspectivePoint {
  const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * u;
  const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * u;
  const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * u;
  const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * u;
  return { x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v };
}

function drawAffineTriangle(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourcePoints: readonly [PerspectivePoint, PerspectivePoint, PerspectivePoint],
  destinationPoints: readonly [PerspectivePoint, PerspectivePoint, PerspectivePoint],
): void {
  const [s0, s1, s2] = sourcePoints;
  const [d0, d1, d2] = destinationPoints;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 0.000001) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  // Adjacent clipped triangles can leave subpixel hairlines in Canvas 2D, especially in large
  // renders. Expand only the clip around its centroid; the affine mapping stays exact and the
  // neighboring triangles overlap by less than one output pixel instead of exposing the backing.
  const center = { x: (d0.x + d1.x + d2.x) / 3, y: (d0.y + d1.y + d2.y) / 3 };
  const expandClipPoint = (point: PerspectivePoint): PerspectivePoint => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy);
    const amount = length > 0 ? 0.75 / length : 0;
    return { x: point.x + dx * amount, y: point.y + dy * amount };
  };
  const clipPoints = [expandClipPoint(d0), expandClipPoint(d1), expandClipPoint(d2)] as const;
  context.save();
  context.beginPath();
  context.moveTo(clipPoints[0].x, clipPoints[0].y);
  context.lineTo(clipPoints[1].x, clipPoints[1].y);
  context.lineTo(clipPoints[2].x, clipPoints[2].y);
  context.closePath();
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(source, 0, 0);
  context.restore();
}

function drawPerspectiveMesh(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceRect: Readonly<{ height: number; width: number; x: number; y: number }>,
  corners: Readonly<Record<PerspectiveCorner, PerspectivePoint>>,
): void {
  const columns = 8;
  const rows = 6;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u0 = column / columns;
      const u1 = (column + 1) / columns;
      const v0 = row / rows;
      const v1 = (row + 1) / rows;
      const s00 = { x: sourceRect.x + sourceRect.width * u0, y: sourceRect.y + sourceRect.height * v0 };
      const s10 = { x: sourceRect.x + sourceRect.width * u1, y: sourceRect.y + sourceRect.height * v0 };
      const s11 = { x: sourceRect.x + sourceRect.width * u1, y: sourceRect.y + sourceRect.height * v1 };
      const s01 = { x: sourceRect.x + sourceRect.width * u0, y: sourceRect.y + sourceRect.height * v1 };
      const d00 = bilinearPoint(corners, u0, v0);
      const d10 = bilinearPoint(corners, u1, v0);
      const d11 = bilinearPoint(corners, u1, v1);
      const d01 = bilinearPoint(corners, u0, v1);
      drawAffineTriangle(context, source, [s00, s10, s11], [d00, d10, d11]);
      drawAffineTriangle(context, source, [s00, s11, s01], [d00, d11, d01]);
    }
  }
}

export function getPerspectiveDestinationCorners(
  viewport: MockupViewport,
  transform: FrameTransform,
  perspective: FramePerspective,
  scale: number,
): Readonly<Record<PerspectiveCorner, PerspectivePoint>> {
  const center = { x: viewport.x + viewport.width / 2 + transform.x * scale, y: viewport.y + viewport.height / 2 + transform.y * scale };
  const factor = transform.scale / 100;
  const angle = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const base: Readonly<Record<PerspectiveCorner, PerspectivePoint>> = {
    topLeft: { x: -viewport.width / 2, y: -viewport.height / 2 },
    topRight: { x: viewport.width / 2, y: -viewport.height / 2 },
    bottomRight: { x: viewport.width / 2, y: viewport.height / 2 },
    bottomLeft: { x: -viewport.width / 2, y: viewport.height / 2 },
  };
  const result = {} as Record<PerspectiveCorner, PerspectivePoint>;
  for (const corner of PERSPECTIVE_CORNERS) {
    const point = base[corner];
    const x = point.x * factor;
    const y = point.y * factor;
    const offset = perspective.points[corner];
    result[corner] = {
      x: center.x + x * cosine - y * sine + offset.x * viewport.width,
      y: center.y + x * sine + y * cosine + offset.y * viewport.height,
    };
  }
  return result;
}

export function getPerspectiveClipRect(viewport: MockupViewport): Readonly<{ height: number; width: number; x: number; y: number }> {
  return {
    height: viewport.height + viewport.topBleed,
    width: viewport.width,
    x: viewport.x,
    y: viewport.y - viewport.topBleed,
  };
}

function drawPerspectiveFramedBitmap(
  context: CanvasRenderingContext2D,
  bitmap: FrameBitmap,
  scale: number,
  shape: FrameShape | undefined,
  start: StartDraw | undefined,
  blurLength: number,
  mockup: Readonly<{ perspective: FramePerspective; transform: FrameTransform; viewport: MockupViewport }>,
  bitmapScale: number,
): boolean {
  const scratchTarget = getPerspectiveScratch(bitmap.width, bitmap.height);
  if (!scratchTarget) return false;
  const { canvas, context: source } = scratchTarget;
  source.save();
  source.setTransform(1, 0, 0, 1, 0, 0);
  source.clearRect(0, 0, canvas.width, canvas.height);
  source.translate(bitmap.width / 2, bitmap.height / 2);
  const whole = { height: bitmap.height, width: bitmap.width, x: -bitmap.width / 2, y: -bitmap.height / 2 };
  const area = shape
    ? {
        height: shape.rect.height * bitmapScale,
        width: shape.rect.width * bitmapScale,
        x: (shape.rect.x - shape.renderSize.width / 2) * bitmapScale,
        y: (shape.rect.y - shape.renderSize.height / 2) * bitmapScale,
      }
    : whole;
  const draw = (): void => {
    source.save();
    if (start && isIntro(start.preset)) applyIntro(source, start, area, bitmapScale);
    const smear = blurLength * bitmapScale;
    if (smear >= 1) drawSmeared(source, bitmap, smear, area);
    else source.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2, bitmap.width, bitmap.height);
    source.restore();
    if (start && isPreloader(start.preset)) drawPreloader(source, start, area, bitmapScale, shape?.style.fill ? shape.style.fillColor : "#F6F6FD");
  };
  if (shape) {
    const { rect, renderSize, style } = shape;
    const path = new Path2D();
    path.roundRect(
      (rect.x - renderSize.width / 2) * bitmapScale,
      (rect.y - renderSize.height / 2) * bitmapScale,
      rect.width * bitmapScale,
      rect.height * bitmapScale,
      style.radius * bitmapScale,
    );
    if (style.fill) {
      source.fillStyle = style.fillColor;
      source.fill(path);
    }
    source.save();
    if (style.clip) source.clip(path);
    draw();
    source.restore();
    if (style.stroke && style.strokeWidth > 0) {
      source.lineWidth = style.strokeWidth * bitmapScale;
      source.strokeStyle = style.strokeColor;
      source.stroke(path);
    }
  } else {
    draw();
  }
  source.restore();

  const sourceRect = { x: area.x + bitmap.width / 2, y: area.y + bitmap.height / 2, width: area.width, height: area.height };
  const corners = getPerspectiveDestinationCorners(mockup.viewport, mockup.transform, mockup.perspective, scale);
  const clip = getPerspectiveClipRect(mockup.viewport);
  context.save();
  context.beginPath();
  context.rect(clip.x, clip.y, clip.width, clip.height);
  context.clip();
  context.globalAlpha = Math.min(1, Math.max(0, mockup.transform.opacity / 100));
  drawPerspectiveMesh(context, canvas, sourceRect, corners);
  context.restore();
  return true;
}

// Draws the animation's picture onto a canvas with the frame's position, rotation and opacity.
// `scale` is canvas pixels per design unit.
export function drawFramedBitmap(
  context: CanvasRenderingContext2D,
  bitmap: FrameBitmap,
  transform: FrameTransform,
  scale: number,
  shape?: FrameShape,
  // Drawn first, on the plain artboard: the mockup stays put while the design moves.
  before?: (context: CanvasRenderingContext2D) => void,
  // Drawn last, on the plain artboard: the sticky items sit over the design on every ratio.
  after?: (context: CanvasRenderingContext2D) => void,
  // A Landing Page's Start: a preloader over the page, or an intro transition into it.
  start?: StartDraw,
  // A Landing Page scroll's motion blur: how many design units the page is smeared up and down.
  blurLength = 0,
  mockup?: Readonly<{ perspective: FramePerspective; transform: FrameTransform; viewport: MockupViewport }>,
  // Source pixels per design unit. Preview may be lower than the output canvas scale.
  bitmapScale = scale,
): void {
  const { height, width } = context.canvas;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  before?.(context);
  if (mockup?.perspective.enabled && drawPerspectiveFramedBitmap(context, bitmap, scale, shape, start, blurLength, mockup, bitmapScale)) {
    context.restore();
    after?.(context);
    return;
  }
  if (mockup) {
    const { viewport } = mockup;
    context.beginPath();
    context.rect(viewport.x, viewport.y, viewport.width, viewport.height);
    context.clip();
    // Cover the still screenshot in the uploaded mockup, leaving its bezel and camera untouched.
    context.fillStyle = "#FFFFFF";
    context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    const frame = shape?.rect ?? { x: 0, y: 0, width: bitmap.width / bitmapScale, height: bitmap.height / bitmapScale };
    const renderSize = shape?.renderSize ?? { width: bitmap.width / bitmapScale, height: bitmap.height / bitmapScale };
    const fitX = viewport.width / (frame.width * scale);
    const fitY = viewport.height / (frame.height * scale);
    const authored = mockup.transform;
    context.translate(viewport.x + viewport.width / 2 + authored.x * scale, viewport.y + viewport.height / 2 + authored.y * scale);
    context.rotate((authored.rotation * Math.PI) / 180);
    context.scale(fitX * authored.scale / 100, fitY * authored.scale / 100);
    context.translate(-(frame.x + frame.width / 2 - renderSize.width / 2) * scale, -(frame.y + frame.height / 2 - renderSize.height / 2) * scale);
    context.globalAlpha = Math.min(1, Math.max(0, authored.opacity / 100));
  } else {
    context.globalAlpha = Math.min(1, Math.max(0, transform.opacity / 100));
    context.translate(width / 2 + transform.x * scale, height / 2 + transform.y * scale);
    context.rotate((transform.rotation * Math.PI) / 180);
    context.scale(transform.scale / 100, transform.scale / 100);
  }
  // The picture is the animation's own size, centered on the canvas whatever shape the canvas has.
  const drawWidth = (bitmap.width * scale) / bitmapScale;
  const drawHeight = (bitmap.height * scale) / bitmapScale;
  const whole = { height: drawHeight, width: drawWidth, x: -drawWidth / 2, y: -drawHeight / 2 };
  const area = shape
    ? {
        height: shape.rect.height * scale,
        width: shape.rect.width * scale,
        x: (shape.rect.x - shape.renderSize.width / 2) * scale,
        y: (shape.rect.y - shape.renderSize.height / 2) * scale,
      }
    : whole;
  const draw = (): void => {
    context.save();
    if (start && isIntro(start.preset)) applyIntro(context, start, area, scale);
    const smear = blurLength * bitmapScale;
    if (smear >= 1) drawSmeared(context, bitmap, smear, area, drawWidth, drawHeight);
    else context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    if (start && isPreloader(start.preset)) drawPreloader(context, start, area, scale, shape?.style.fill ? shape.style.fillColor : "#F6F6FD");
  };
  if (shape) {
    const { rect, renderSize, style } = shape;
    const path = new Path2D();
    path.roundRect(
      (rect.x - renderSize.width / 2) * scale,
      (rect.y - renderSize.height / 2) * scale,
      rect.width * scale,
      rect.height * scale,
      style.radius * scale,
    );
    if (style.fill) {
      context.fillStyle = style.fill ? style.fillColor : "transparent";
      context.fill(path);
    }
    context.save();
    if (style.clip) context.clip(path);
    draw();
    context.restore();
    if (style.stroke && style.strokeWidth > 0) {
      context.lineWidth = style.strokeWidth * scale;
      context.strokeStyle = style.strokeColor;
      context.stroke(path);
    }
  } else {
    draw();
  }
  context.restore();
  after?.(context);
}

// The layer a blank project gets in the Layers panel when its Frame is made Active.
export const FRAME_PANEL_LAYER_ID = "mo-frame";

// A blank project's frame: a rectangle the size of the artboard (at the frame's scale), with the
// frame's position, rotation, opacity, fill, stroke and corner radius. `scale` is canvas pixels per
// artboard unit.
export function drawBlankFrame(
  context: CanvasRenderingContext2D,
  size: Readonly<{ height: number; width: number }>,
  transform: FrameTransform,
  style: FrameStyle,
  scale: number,
): void {
  const { height, width } = context.canvas;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = Math.min(1, Math.max(0, transform.opacity / 100));
  context.translate(width / 2 + transform.x * scale, height / 2 + transform.y * scale);
  context.rotate((transform.rotation * Math.PI) / 180);
  const frameWidth = (size.width * transform.scale * transform.boxW * scale) / 10000;
  const frameHeight = (size.height * transform.scale * transform.boxH * scale) / 10000;
  const path = new Path2D();
  path.roundRect(-frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight, style.radius * scale);
  if (style.fill) {
    context.fillStyle = style.fillColor;
    context.fill(path);
  }
  if (style.stroke && style.strokeWidth > 0) {
    context.lineWidth = style.strokeWidth * scale;
    context.strokeStyle = style.strokeColor;
    context.stroke(path);
  }
  context.restore();
}
