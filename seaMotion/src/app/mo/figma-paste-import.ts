import type { AnimationSpec } from "../animation/animation-spec";
import type { ProjectFile, ProjectFileLayer } from "./mo-projects";

// Turns what the "seaMotion" Figma plugin copied (type "mo-figma-layers") into a design: every Figma layer
// becomes a layer of the Layers panel, and the app's design script paints them (rectangles, gradients, strokes,
// shadows, pictures, text and SVG icons). The design lives in the animation's `design` field as blocks: the first
// paste of a project, then each later paste placed (and scaled) where it was put. A project whose drawing is its own
// script keeps that script; the pasted blocks are drawn over it.

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

// A 2D transform in canvas order [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
type Mat = [number, number, number, number, number, number];

// A frame's clip as pasted: the box (the frame's own), its corner radius (one value or one per corner), and the frame that made it
// (`f`), so a Clip content or Corner radius set on that frame in the app replaces it.
type Clip = { f?: string; h: number; r: number | number[]; w: number; x: number; y: number };
type Box = { h: number; w: number; x: number; y: number };

export type FigmaFont = Readonly<{ family: string; style: string; weight: number }>;

export type FigmaText = {
  align: string;
  case?: string;
  chars: string;
  deco?: string;
  family: string;
  // Every font the text uses ("Family|Style"), and those this computer cannot draw (the text shows as its picture).
  fonts: FigmaFont[];
  // Opacity of the layers around the text (the picture already has the text's own).
  ia?: number;
  // The text as a picture (a key of the assets) and the box it covers, for while a font is missing.
  ib?: Box;
  img?: string;
  lh: number;
  ls: number;
  missing?: string[];
  // Figma's text resize: "WIDTH_AND_HEIGHT" is a one-line label, the others are boxes of paragraph text.
  resize?: string;
  size: number;
  style: string;
  valign: string;
  weight: number;
};

export type FigmaPicture = {
  // A key of the assets: the picture's original file.
  asset: string;
  // The layer's files (asset keys, in order): pictures, GIFs and videos added in the app. Missing means [asset].
  // The one shown is chosen in the Layer section (params __picture[id].show), else the first.
  files?: string[];
  mode: string;
  // The picture is the layer's only paint, so it is drawn from its file (not from the rendered fill).
  only: boolean;
  opacity: number;
  sf?: number;
  t?: number[][];
  // A Figma video fill: the picture is the fill as Figma showed it, until the video file is added in the app.
  video?: boolean;
};

export type FigmaItem = {
  alpha: number;
  // The layer (or group) of this design that masks this one, as it was in Figma (the Layer section can pick another).
  mask?: string;
  blend: string;
  clips: Clip[];
  ellipse: boolean;
  effects: unknown[];
  // A key of the project's assets: the fill of this layer as a picture (several colors, or a picture fill).
  fillAsset?: string;
  fills: unknown[];
  // This layer is a Figma frame (or an auto layout): the layer of the same id in the Layers panel is a group, and this is its own
  // fill, stroke and effects, drawn under what it holds. `clip` is whether the frame cut what it holds; its corner radius is `radius`.
  // `members`: every layer inside the frame, kept only when the frame has a layer blur (the blur covers them all).
  frame?: { auto?: boolean; clip: boolean; members?: string[] };
  h: number;
  id: string;
  // A mask layer's own drawing is not shown: it only cuts the layers it masks.
  isMask?: boolean;
  kind: "png" | "shape" | "svg" | "text";
  // A drawn shape (vector, star, polygon, line, ring) as its outline paths (SVG path data in the layer's own box; `r` is the winding
  // rule): painted from the layer's fills and strokes, so both stay editable. `cap`, `join`, `miter`: line ends, corners, miter limit;
  // `sa`: where the stroke sits on the outline (CENTER, INSIDE, OUTSIDE).
  paths?: { d: string; r?: string }[];
  // How far the layer's picture (svg) reaches past its box on each side (a glow, a shadow, half a stroke): sent by the plugin, so the picture
  // is placed exactly. Older pastes have none and the drawing works it out.
  bleed?: { b: number; l: number; r: number; t: number };
  // A line made from one side of a frame's (or rectangle's) stroke: which side. It is a box as thick as that stroke, filled with the stroke's paint.
  line?: string;
  cap?: string;
  join?: string;
  miter?: number;
  sa?: string;
  // The layer's place when it is rotated or flipped (it, or a parent): drawn in its own box with this matrix.
  m?: Mat;
  pic?: FigmaPicture;
  // The asset a "png" item shows (the whole design's picture).
  png?: string;
  radius: number | number[];
  rot: number;
  strokes: unknown[];
  sw: number;
  svg?: string;
  text?: FigmaText;
  w: number;
  x: number;
  y: number;
};

export type FigmaBlock = {
  height: number;
  id: string;
  items: FigmaItem[];
  // The design's mask layers: id of the mask layer (or group) -> its name and the drawn items that make its shape.
  masks?: Record<string, { items: string[]; name: string }>;
  name: string;
  // The tag the Figma plugin set on a layer (layer id -> tag); see mo-layer-tags.ts. Layers without one are not listed.
  tags?: Record<string, string>;
  s: number;
  width: number;
  x: number;
  y: number;
};

export type FigmaDesign = { blocks: FigmaBlock[]; height: number; width: number };

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

// Figma's relativeTransform is [[a, c, e], [b, d, f]].
function parseTransform(value: unknown): Mat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [row0, row1] = value as unknown[];
  if (!Array.isArray(row0) || !Array.isArray(row1)) return null;
  const parts = [row0[0], row1[0], row0[1], row1[1], row0[2], row1[2]];
  return parts.every((part) => typeof part === "number" && Number.isFinite(part)) ? (parts as Mat) : null;
}

function multiply(p: Mat, l: Mat): Mat {
  return [
    p[0] * l[0] + p[2] * l[1],
    p[1] * l[0] + p[3] * l[1],
    p[0] * l[2] + p[2] * l[3],
    p[1] * l[2] + p[3] * l[3],
    p[0] * l[4] + p[2] * l[5] + p[4],
    p[1] * l[4] + p[3] * l[5] + p[5],
  ];
}

function invertMat(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

const isUpright = (m: Mat): boolean => Math.abs(m[0] - 1) < 1e-4 && Math.abs(m[1]) < 1e-4 && Math.abs(m[2]) < 1e-4 && Math.abs(m[3] - 1) < 1e-4;

const BLEND: Record<string, string> = {
  COLOR_BURN: "color-burn",
  COLOR_DODGE: "color-dodge",
  DARKEN: "darken",
  DIFFERENCE: "difference",
  COLOR: "color",
  EXCLUSION: "exclusion",
  HARD_LIGHT: "hard-light",
  HUE: "hue",
  LIGHTEN: "lighten",
  LINEAR_DODGE: "plus-lighter",
  LUMINOSITY: "luminosity",
  MULTIPLY: "multiply",
  OVERLAY: "overlay",
  SATURATION: "saturation",
  SCREEN: "screen",
  SOFT_LIGHT: "soft-light",
};

// Font style names to weights, for fonts Figma did not give a number for.
const WEIGHT_WORDS: readonly (readonly [RegExp, number])[] = [
  [/hairline|thin/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
];

export function weightOfStyle(style: string): number {
  for (const [pattern, weight] of WEIGHT_WORDS) if (pattern.test(style)) return weight;
  return 400;
}

export const isItalicStyle = (style: string): boolean => /italic|oblique/i.test(style);

export const fontKey = (font: Readonly<{ family: string; style: string }>): string => `${font.family}|${font.style}`.toLowerCase();

// The params keys the Layer section writes for a pasted design's layers.
export const TEXT_EDITS_KEY = "__text";
export const PICTURE_EDITS_KEY = "__picture";
// color is "#rrggbb" and opacity 0-100: the text's color when it was changed in the app.
export type TextEdit = Partial<Pick<FigmaText, "align" | "case" | "chars" | "family" | "lh" | "ls" | "size" | "style" | "weight">> &
  Partial<Readonly<{ color: string; opacity: number }>>;
export type PictureEdit = Readonly<{ mode?: string; show?: string }>;

// The files a picture layer holds, in order.
export const pictureFiles = (pic: FigmaPicture): string[] => pic.files ?? [pic.asset];

// Marks the design script, and a project script with pasted blocks drawn over it.
const DESIGN_MARK = "/*mo-design*/";

// What Figma calls a frame: a frame, an auto layout (a frame with a layout), a component and what an instance becomes.
const FRAME_TYPES: ReadonlySet<string> = new Set(["COMPONENT", "COMPONENT_SET", "FRAME", "INSTANCE"]);
const COMPOSITE_MARK = "/*mo-design-composite*/";

// The design script: draws api.design's blocks, the layers in the Layers panel's order.
// Shape edits made in the Layer section (params.__shape[layerId]): the fills and strokes as they are now (replacing the pasted
// ones), the stroke width, the corner radius, an opacity factor and whether the effects show.
// A layer moved in the Layer section (params.__pos[layerId]): how far it is from where it was pasted, in design pixels.
export const POSITION_KEY = "__pos";
// A layer stretched on the artboard (params.__grow[layerId] = { sx, sy }): scaled from its top-left corner by these factors.
export const GROW_KEY = "__grow";
export type PositionEdit = { x?: number; y?: number };

export const SHAPE_KEY = "__shape";
export type ShapeEdit = {
  am?: number;
  // The stroke's line ends (BUTT, ROUND, SQUARE) and corners (MITER, BEVEL, ROUND), and its dashes: [dash, gap] in pixels (none = solid).
  cap?: string;
  dash?: number[];
  fills?: unknown[];
  join?: string;
  fx?: boolean;
  radius?: number | number[];
  // A stroke on single sides of a box: its weight on the top, right, bottom and left (empty: one weight all round).
  sides?: number[];
  // Where a box's stroke sits on its edge: INSIDE (the default), CENTER or OUTSIDE.
  sp?: string;
  strokes?: unknown[];
  sw?: number;
};

// The blend modes the Layer section offers (label, canvas value); params.__blend[layerId] holds the canvas value.
export const BLEND_KEY = "__blend";
export const BLEND_OPTIONS: readonly { label: string; value: string }[] = [
  { label: "Normal", value: "source-over" },
  { label: "Darken", value: "darken" },
  { label: "Multiply", value: "multiply" },
  { label: "Color burn", value: "color-burn" },
  { label: "Lighten", value: "lighten" },
  { label: "Screen", value: "screen" },
  { label: "Color dodge", value: "color-dodge" },
  { label: "Linear dodge", value: "plus-lighter" },
  { label: "Overlay", value: "overlay" },
  { label: "Soft light", value: "soft-light" },
  { label: "Hard light", value: "hard-light" },
  { label: "Difference", value: "difference" },
  { label: "Exclusion", value: "exclusion" },
  { label: "Hue", value: "hue" },
  { label: "Saturation", value: "saturation" },
  { label: "Color", value: "color" },
  { label: "Luminosity", value: "luminosity" },
];

export const DESIGN_CODE = String.raw`${DESIGN_MARK}
const D = api.design || { blocks: [], height: 0, width: 0 };
const images = new Map();
const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const load = (src) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});
const rgba = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
};
// Figma's gradientTransform maps the box (0..1) into gradient space; the line runs (0,.5) -> (1,.5) there.
const invert = (t) => {
  const [[a, c, e], [b, d, f]] = t;
  const raw = a * d - b * c;
  const det = Math.abs(raw) < 1e-9 ? (raw < 0 ? -1e-9 : 1e-9) : raw;
  return (x, y) => [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
};
function paintStyle(ctx, fill, it) {
  if (fill.type === "SOLID") return rgba(fill.color, fill.opacity);
  if (fill.type && fill.type.indexOf("GRADIENT") === 0 && fill.stops && fill.stops.length) {
    const t = fill.transform || [[1, 0, 0], [0, 1, 0]];
    const back = invert(t);
    let gradient;
    if (fill.type === "GRADIENT_RADIAL") {
      const [cx, cy] = back(0.5, 0.5);
      const [ex, ey] = back(1, 0.5);
      const radius = Math.hypot((ex - cx) * it.w, (ey - cy) * it.h);
      gradient = ctx.createRadialGradient(it.x + cx * it.w, it.y + cy * it.h, 0, it.x + cx * it.w, it.y + cy * it.h, Math.max(1, radius));
    } else {
      // The gradient's position at a point is t = a u + c v + e (u, v: 0..1 across the box). Its line runs along the
      // direction t grows fastest, from t = 0 to t = 1; this also holds when Figma's matrix cannot be inverted.
      const [[a, c, e]] = t;
      const gx = a / Math.max(it.w, 1e-6);
      const gy = c / Math.max(it.h, 1e-6);
      const len2 = gx * gx + gy * gy;
      if (len2 < 1e-12) return fill.stops.length ? rgba(fill.stops[0].color, fill.stops[0].alpha * fill.opacity) : null;
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      const tc = a * 0.5 + c * 0.5 + e;
      const k0 = (0 - tc) / len2;
      const k1 = (1 - tc) / len2;
      gradient = ctx.createLinearGradient(cx + gx * k0, cy + gy * k0, cx + gx * k1, cy + gy * k1);
    }
    for (const stop of fill.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.position)), rgba(stop.color, stop.alpha * fill.opacity));
    return gradient;
  }
  return null;
}
function outline(ctx, x, y, w, h, radius, ellipse, keep) {
  if (!keep) ctx.beginPath();
  if (ellipse) {
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.01, w / 2), Math.max(0.01, h / 2), 0, 0, Math.PI * 2);
    return;
  }
  const r = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
  const cap = Math.min(w, h) / 2;
  ctx.roundRect(x, y, w, h, r.map((value) => Math.min(value, cap)));
}
// The outline paths of a drawn shape (it.paths), placed at the layer's place; null for a box or circle.
const pathCache = new Map();
function shapePath(it) {
  if (!it.paths || !it.paths.length) return null;
  const key = it.id + "|" + it.x + "|" + it.y;
  const known = pathCache.get(key);
  if (known && known.paths === it.paths) return known.list;
  const move = new DOMMatrix([1, 0, 0, 1, it.x, it.y]);
  const list = it.paths.map((entry) => {
    const path = new Path2D();
    path.addPath(new Path2D(entry.d), move);
    return { d: entry.d, path, rule: entry.r === "EVENODD" ? "evenodd" : "nonzero" };
  });
  pathCache.set(key, { paths: it.paths, list });
  return list;
}
const lengths = new Map();
const probes = new Map();
function pathProbe(d) {
  if (probes.has(d)) return probes.get(d);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  probes.set(d, path);
  return path;
}
function pathLength(d) {
  if (lengths.has(d)) return lengths.get(d);
  let length = 0;
  try {
    length = pathProbe(d).getTotalLength();
  } catch (error) {
    length = 0;
  }
  lengths.set(d, length);
  return length;
}
const fillShape = (ctx, list) => {
  for (const entry of list) ctx.fill(entry.path, entry.rule);
};
// A box stroked on single sides (it.sides: top, right, bottom, left weights): each side is a bar along that edge, inside, centered on or outside it
// as the stroke's position says; inside, the bars stay within the rounded corners.
function sidesStroke(ctx, it, style) {
  const [t, r, b, l] = it.sides;
  const out = it.sp === "OUTSIDE" ? 1 : it.sp === "CENTER" ? 0.5 : 0;
  ctx.save();
  if (out === 0) {
    outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
    ctx.clip();
  }
  ctx.fillStyle = style;
  if (t > 0) ctx.fillRect(it.x, it.y - out * t, it.w, t);
  if (b > 0) ctx.fillRect(it.x, it.y + it.h - (1 - out) * b, it.w, b);
  if (l > 0) ctx.fillRect(it.x - out * l, it.y, l, it.h);
  if (r > 0) ctx.fillRect(it.x + it.w - (1 - out) * r, it.y, r, it.h);
  ctx.restore();
}
function strokeShape(ctx, it, list, style) {
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = it.sw;
  ctx.lineCap = it.cap === "ROUND" ? "round" : it.cap === "SQUARE" ? "square" : "butt";
  ctx.lineJoin = it.join === "ROUND" ? "round" : it.join === "BEVEL" ? "bevel" : "miter";
  if (it.miter) ctx.miterLimit = it.miter;
  if (it.dash && it.dash.length && it.trim == null) ctx.setLineDash(it.dash);
  if (it.rotY && Math.abs(Math.sin(it.rotY / 2)) > 0.0001) {
    // A turn about the vertical axis in perspective: points of the outline are placed along its length (as far as Trim path has drawn it) and
    // moved by the turn, the nearer side larger, and joined by lines.
    const at = it.rotAt || { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    const sin = Math.sin(it.rotY);
    const cos = Math.cos(it.rotY);
    const camera = Math.max(it.w, it.h) * 3.5;
    const upto = it.trim == null ? 1 : Math.min(1, Math.max(0, it.trim));
    for (const entry of list) {
      const whole = pathLength(entry.d);
      if (whole <= 0 || upto <= 0) continue;
      const probe = pathProbe(entry.d);
      const count = Math.max(8, Math.ceil((whole * upto) / 1.2));
      ctx.beginPath();
      for (let i = 0; i <= count; i += 1) {
        const point = probe.getPointAtLength((whole * upto * i) / count);
        const px = it.x + point.x - at.x;
        const py = it.y + point.y - at.y;
        const depth = camera / (camera - px * sin);
        const x = at.x + px * cos * depth;
        const y = at.y + py * depth;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (it.trim != null && it.trim < 1) {
    // Trim path: each outline draws itself along its length.
    for (const entry of list) {
      const length = pathLength(entry.d);
      if (it.trim <= 0 || length <= 0) continue;
      ctx.setLineDash([length * it.trim, length * 2]);
      ctx.lineDashOffset = 0;
      ctx.stroke(entry.path);
    }
    ctx.restore();
    return;
  }
  if (it.sa === "INSIDE" || it.sa === "OUTSIDE") {
    // Half of the doubled stroke is kept: the half inside the outline, or the half outside it.
    const whole = new Path2D();
    for (const entry of list) whole.addPath(entry.path);
    if (it.sa === "INSIDE") {
      ctx.clip(whole, list[0].rule);
    } else {
      const around = new Path2D();
      around.rect(it.x - 4000, it.y - 4000, it.w + 8000, it.h + 8000);
      around.addPath(whole);
      ctx.clip(around, "evenodd");
    }
    ctx.lineWidth = it.sw * 2;
  }
  for (const entry of list) ctx.stroke(entry.path);
  ctx.restore();
}
const caseOf = (text, mode) => {
  if (mode === "UPPER") return text.toUpperCase();
  if (mode === "LOWER") return text.toLowerCase();
  if (mode === "TITLE") return text.replace(/(^|\s)(\S)/g, (all, space, letter) => space + letter.toUpperCase());
  return text;
};
function drawText(ctx, it, text) {
  const italic = /italic|oblique/i.test(text.style || "") ? "italic " : "";
  const weight = text.weight || 400;
  ctx.font = italic + weight + " " + text.size + 'px "' + (text.family || "Inter") + '", "Instrument Sans", system-ui, sans-serif';
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = (text.ls || 0) + "px";
  const lineHeight = text.lh || text.size * 1.25;
  const lines = [];
  // An auto-width text (Figma's "WIDTH_AND_HEIGHT") never wraps: a longer value just runs wider.
  const wraps = it.w > 0 && text.resize !== "WIDTH_AND_HEIGHT";
  for (const raw of caseOf(String(text.chars), text.case).split("\n")) {
    if (!wraps) { lines.push(raw); continue; }
    let line = "";
    for (const word of raw.split(" ")) {
      const next = line ? line + " " + word : word;
      if (line && ctx.measureText(next).width > it.w + 1) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  const total = lines.length * lineHeight;
  const metrics = ctx.measureText("Hg");
  const ascent = typeof metrics.fontBoundingBoxAscent === "number" ? metrics.fontBoundingBoxAscent : text.size * 0.95;
  const descent = typeof metrics.fontBoundingBoxDescent === "number" ? metrics.fontBoundingBoxDescent : text.size * 0.25;
  const top = text.valign === "CENTER" ? it.y + (it.h - total) / 2 : text.valign === "BOTTOM" ? it.y + it.h - total : it.y;
  const fill = text.color ? rgba(text.color, text.opacity == null ? 1 : text.opacity / 100) : it.fills[0] ? paintStyle(ctx, it.fills[0], it) : "#fff";
  ctx.fillStyle = fill || "#fff";
  if (text.letters && lines.length === 1) {
    // Letter by letter: each letter comes in (and goes out) one stagger after the letter before, with a fade, a blur and a slide.
    const L = text.letters;
    const line = lines[0];
    const full = ctx.measureText(line).width;
    const x0 = text.align === "CENTER" ? it.x + (it.w - full) / 2 : text.align === "RIGHT" ? it.x + it.w - full : it.x;
    const base = top + (lineHeight - (ascent + descent)) / 2 + ascent;
    const progress = (one, i) => (one ? PLAN_EASE(Math.min(1, Math.max(0, (one.t - i * one.stagger) / one.length))) : null);
    for (let i = 0; i < line.length; i += 1) {
      const kIn = progress(L.in, i);
      const kOut = progress(L.out, i);
      const alpha = (kIn == null ? 1 : kIn) * (kOut == null ? 1 : 1 - kOut);
      if (alpha <= 0) continue;
      const away = kIn == null ? 0 : 1 - kIn;
      const gone = kOut == null ? 0 : kOut;
      const blur = (L.in ? L.in.blur * away : 0) + (L.out ? L.out.blur * gone : 0);
      const dx = (L.in ? L.in.dx * away : 0) + (L.out ? L.out.dx * gone : 0);
      const dy = (L.in ? L.in.dy * away : 0) + (L.out ? L.out.dy * gone : 0);
      ctx.save();
      ctx.globalAlpha *= alpha;
      if (blur > 0.01) ctx.filter = "blur(" + blur * view.scale + "px)";
      ctx.fillText(line[i], x0 + ctx.measureText(line.slice(0, i)).width + dx, base + dy);
      ctx.restore();
    }
    return;
  }
  lines.forEach((line, index) => {
    const width = ctx.measureText(line).width;
    const x = text.align === "CENTER" ? it.x + (it.w - width) / 2 : text.align === "RIGHT" ? it.x + it.w - width : it.x;
    // The glyphs sit in the middle of the line box: the font's ascent plus descent is centered in the line height.
    const baseline = top + index * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent;
    ctx.fillText(line, x, baseline);
    if (text.deco === "UNDERLINE" || text.deco === "STRIKETHROUGH") {
      const thick = Math.max(1, text.size / 14);
      ctx.fillRect(x, text.deco === "UNDERLINE" ? baseline + thick * 1.5 : baseline - text.size * 0.3, width, thick);
    }
  });
}
// The canvas pixels per design pixel and where the block sits on the canvas (set for each block).
const view = { cw: 0, ch: 0, ox: 0, oy: 0, scale: 1 };
const kindOf = (it, type) => it.effects.filter((effect) => effect.type === type);
const setShadow = (ctx, effect) => {
  // Canvas shadows are in device pixels, not design pixels.
  ctx.shadowColor = rgba(effect.color, effect.alpha);
  ctx.shadowBlur = effect.radius * view.scale;
  ctx.shadowOffsetX = effect.offset.x * view.scale;
  ctx.shadowOffsetY = effect.offset.y * view.scale;
};
// Background blur and glass: what is already painted under the layer is blurred inside the layer's shape.
function backdropBlur(ctx, it, radius, source) {
  if (it.rot || it.m || !(radius > 0)) return;
  const pad = Math.ceil(radius * 2) + 2;
  const x0 = Math.max(-view.ox, it.x - pad);
  const y0 = Math.max(-view.oy, it.y - pad);
  const x1 = Math.min(view.cw / view.scale - view.ox, it.x + it.w + pad);
  const y1 = Math.min(view.ch / view.scale - view.oy, it.y + it.h + pad);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  const shaped = shapePath(it);
  if (shaped) {
    for (const entry of shaped) ctx.clip(entry.path, entry.rule);
  } else {
    outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
    ctx.clip();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "blur(" + (radius / 2) * view.scale + "px)";
  ctx.drawImage(source || ctx.canvas, (x0 + view.ox) * view.scale, (y0 + view.oy) * view.scale, (x1 - x0) * view.scale, (y1 - y0) * view.scale, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}
// The shadow falls inside the shape: a huge frame with the shape cut out casts it.
function innerShadow(ctx, it, effect) {
  ctx.save();
  outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
  ctx.clip();
  setShadow(ctx, effect);
  ctx.beginPath();
  ctx.rect(it.x - 4000, it.y - 4000, it.w + 8000, it.h + 8000);
  outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse, true);
  ctx.fillStyle = "#000";
  ctx.fill("evenodd");
  ctx.restore();
}
// Figma's glass is approximated: frosted backdrop and a soft light edge along the light's angle.
function glass(ctx, it, effect) {
  const intensity = typeof effect.lightIntensity === "number" ? Math.min(1, Math.max(0, effect.lightIntensity)) : 0.5;
  const angle = ((typeof effect.lightAngle === "number" ? effect.lightAngle : -45) * Math.PI) / 180;
  ctx.save();
  outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
  ctx.clip();
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const reach = Math.hypot(it.w, it.h) / 2;
  const dx = Math.cos(angle) * reach;
  const dy = Math.sin(angle) * reach;
  const edge = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  edge.addColorStop(0, "rgba(255,255,255," + 0.35 * intensity + ")");
  edge.addColorStop(0.45, "rgba(255,255,255,0)");
  edge.addColorStop(0.55, "rgba(255,255,255,0)");
  edge.addColorStop(1, "rgba(255,255,255," + 0.2 * intensity + ")");
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
  ctx.stroke();
  ctx.restore();
}
// A picture fill from its file, the way Figma fills: Fill covers, Fit shows all, Crop uses Figma's crop, Tile repeats.
function drawPicture(ctx, it, image, mode) {
  ctx.save();
  outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
  ctx.clip();
  ctx.globalAlpha *= it.pic.opacity == null ? 1 : it.pic.opacity;
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (mode === "TILE") {
    const k = it.pic.sf || 1;
    const pattern = ctx.createPattern(image, "repeat");
    if (pattern) {
      ctx.translate(it.x, it.y);
      ctx.scale(k, k);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, it.w / k, it.h / k);
    }
  } else if (mode === "CROP" && it.pic.t) {
    const [[a, c, e], [b, d, f]] = it.pic.t;
    const det = a * d - b * c || 1;
    ctx.translate(it.x, it.y);
    ctx.scale(it.w, it.h);
    ctx.transform(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
    ctx.drawImage(image, 0, 0, 1, 1);
  } else {
    const k = mode === "FIT" ? Math.min(it.w / iw, it.h / ih) : Math.max(it.w / iw, it.h / ih);
    const w = iw * k;
    const h = ih * k;
    ctx.drawImage(image, it.x + (it.w - w) / 2, it.y + (it.h - h) / 2, w, h);
  }
  ctx.restore();
}
// A progressive layer blur: the picture (the whole canvas) is blurred more and more along the line from the effect's start to its
// end (startRadius at the start, radius at the end). Nine blurred copies are mixed by how far along the line each pixel is.
function progressiveBlur(ctx, source, it, effect, k) {
  const t = ctx.getTransform();
  const dx = (x) => x * t.a + t.e;
  const dy = (y) => y * t.d + t.f;
  const so = effect.startOffset || { x: 0.5, y: 0.5 };
  const eo = effect.endOffset || { x: 0.5, y: 1 };
  const p0 = { x: dx(it.x + so.x * it.w), y: dy(it.y + so.y * it.h) };
  const p1 = { x: dx(it.x + eo.x * it.w), y: dy(it.y + eo.y * it.h) };
  const start = effect.startRadius || 0;
  const end = effect.radius || 0;
  const pad = Math.ceil(Math.max(start, end) * k) + 4;
  const rx = Math.max(0, Math.floor(dx(it.x) - pad));
  const ry = Math.max(0, Math.floor(dy(it.y) - pad));
  const rw = Math.min(source.width, Math.ceil(dx(it.x + it.w) + pad)) - rx;
  const rh = Math.min(source.height, Math.ceil(dy(it.y + it.h) + pad)) - ry;
  if (rw <= 0 || rh <= 0) return;
  const steps = 8;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i <= steps; i += 1) {
    const radius = start + (end - start) * (i / steps);
    const level = new OffscreenCanvas(rw, rh);
    const lc = level.getContext("2d");
    if (radius > 0.05) lc.filter = "blur(" + (radius / 2) * k + "px)";
    lc.drawImage(source, rx, ry, rw, rh, 0, 0, rw, rh);
    lc.filter = "none";
    lc.globalCompositeOperation = "destination-in";
    const g = lc.createLinearGradient(p0.x - rx, p0.y - ry, p1.x - rx, p1.y - ry);
    const lo = Math.max(0, (i - 1) / steps);
    const mid = i / steps;
    const hi = Math.min(1, (i + 1) / steps);
    if (i === 0) {
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(hi, "rgba(0,0,0,0)");
    } else if (i === steps) {
      g.addColorStop(lo, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,1)");
    } else {
      g.addColorStop(lo, "rgba(0,0,0,0)");
      g.addColorStop(mid, "rgba(0,0,0,1)");
      g.addColorStop(hi, "rgba(0,0,0,0)");
    }
    lc.fillStyle = g;
    lc.fillRect(0, 0, rw, rh);
    ctx.drawImage(level, rx, ry);
  }
  ctx.restore();
}
// The shape's own painting: its picture, fills (with the drop shadow), glass, inner shadow and stroke.
function paintShape(ctx, it, edit, picEdit) {
  const shadow = kindOf(it, "DROP_SHADOW")[0];
  ctx.save();
  const files = it.pic ? it.pic.files || [it.pic.asset] : [];
  const shown = picEdit && picEdit.show && files.indexOf(picEdit.show) >= 0 ? picEdit.show : files[0];
  const picture = it.pic && shown ? images.get(it.id + "#p:" + shown) : null;
  const mode = (picEdit && picEdit.mode) || (it.pic && it.pic.mode) || "FILL";
  if (it.pic && it.pic.files && files.length === 0) {
    // Every file was removed: the layer shows no picture.
  } else if (picture && (it.pic.only || (picEdit && (picEdit.mode || picEdit.show)))) {
    drawPicture(ctx, it, picture, mode);
  } else if (it.fillAsset && images.get(it.id)) {
    // Several colors or a picture in the fill: painted from its picture, clipped to the shape.
    ctx.save();
    outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
    ctx.clip();
    ctx.drawImage(images.get(it.id), it.x, it.y, it.w, it.h);
    ctx.restore();
  } else if (picture) {
    drawPicture(ctx, it, picture, mode);
  }
  if (shadow) setShadow(ctx, shadow);
  for (const fill of it.fills) {
    const style = paintStyle(ctx, fill, it);
    if (!style) continue;
    ctx.fillStyle = style;
    const drawn = shapePath(it);
    if (drawn) {
      fillShape(ctx, drawn);
    } else {
      outline(ctx, it.x, it.y, it.w, it.h, it.radius, it.ellipse);
      ctx.fill();
    }
  }
  ctx.restore();
  for (const effect of kindOf(it, "GLASS")) glass(ctx, it, effect);
  for (const effect of kindOf(it, "INNER_SHADOW")) innerShadow(ctx, it, effect);
  if (it.sw > 0) {
    for (const stroke of it.strokes) {
      const style = paintStyle(ctx, stroke, it);
      if (!style) continue;
      const traced = shapePath(it);
      if (traced) {
        strokeShape(ctx, it, traced, style);
        continue;
      }
      if (it.sides && it.sides.length === 4 && !it.ellipse) {
        sidesStroke(ctx, it, style);
        continue;
      }
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = it.sw;
      ctx.lineCap = it.cap === "ROUND" ? "round" : it.cap === "SQUARE" ? "square" : "butt";
      ctx.lineJoin = it.join === "ROUND" ? "round" : it.join === "BEVEL" ? "bevel" : "miter";
      if (it.dash && it.dash.length) ctx.setLineDash(it.dash);
      // Inside (the default) keeps the stroke within the box, center draws it on the edge, outside around it.
      const pad = it.sp === "CENTER" ? 0 : it.sp === "OUTSIDE" ? -it.sw / 2 : it.sw / 2;
      outline(ctx, it.x + pad, it.y + pad, Math.max(0, it.w - pad * 2), Math.max(0, it.h - pad * 2), it.radius, it.ellipse);
      ctx.stroke();
      ctx.restore();
    }
  }
}
function drawItem(ctx, it, edit, picEdit) {
  ctx.save();
  for (const clip of it.clips) {
    outline(ctx, clip.x, clip.y, clip.w, clip.h, clip.r, false);
    ctx.clip();
  }
  // A text whose font this computer does not have shows as its picture, exactly as in Figma.
  if (it.kind === "text" && it.text.missing && it.text.missing.length && images.get(it.id + "#t") && it.text.ib) {
    const box = it.text.ib;
    ctx.globalAlpha = it.text.ia == null ? 1 : it.text.ia;
    ctx.drawImage(images.get(it.id + "#t"), box.x, box.y, box.w, box.h);
    ctx.restore();
    return;
  }
  // A picture exported from Figma already carries the layer's own opacity (an opacity on its drawing), so it is not applied a second time.
  let alpha = it.alpha;
  if (it.kind === "svg" && it.svg) {
    const baked = /\sopacity="([\d.]+)"/.exec(it.svg);
    const own = baked ? parseFloat(baked[1]) : 1;
    if (own > 0 && own < 1) alpha = Math.min(1, it.alpha / own);
  }
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = it.blend;
  if (it.m) ctx.transform(it.m[0], it.m[1], it.m[2], it.m[3], it.m[4], it.m[5]);
  if (it.rot) {
    ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
    ctx.rotate((-it.rot * Math.PI) / 180);
    ctx.translate(-(it.x + it.w / 2), -(it.y + it.h / 2));
  }
  const layerBlur = kindOf(it, "LAYER_BLUR")[0];
  if (layerBlur) ctx.filter = "blur(" + (layerBlur.radius / 2) * view.scale + "px)";
  if (it.kind === "text") {
    const shadow = kindOf(it, "DROP_SHADOW")[0];
    if (shadow) setShadow(ctx, shadow);
    drawText(ctx, it, edit ? Object.assign({}, it.text, edit) : it.text);
  } else if (it.kind === "svg" || it.kind === "png") {
    const image = images.get(it.id);
    // The picture of a drawn layer is not always the size of the layer's box. It is bigger when Figma added room around the layer (a glow
    // or shadow, a stroke's round ends, a line with no height): drawn at its own size, centered on the box. It is smaller when a frame
    // around cut what sticks out of it (a route that starts above the map, a glow at the map's edge): it then keeps the end of the box
    // that is inside the frame. A picture cut by a frame stays inside that frame's edge.
    const own = image && it.kind === "svg" && it.svg ? /<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(it.svg) : null;
    const nw = own ? parseFloat(own[1]) : 0;
    const nh = own ? parseFloat(own[2]) : 0;
    const frameClip = it.clips && it.clips.length ? it.clips[it.clips.length - 1] : null;
    const axis = (start, len, nat, cs, cl) => {
      // A line has no thickness in Figma: its picture (the stroke) is centered on it, however thin.
      // A hairline (1 or 2 px) sits on whole pixels, so it stays crisp instead of being spread over two rows.
      if (len < 0.5 && nat > 0) return { start: nat <= 2 ? Math.round(start - nat / 2) : start - nat / 2, len: nat };
      if (Math.abs(nat - len) <= 1.5) return { start, len };
      if (nat > len) {
        // The room around a stroked shape is half the stroke on its outer sides (an arc keeps its flat ends flush); around a glow or
        // shadow it is even on all sides.
        const bleed = nat - len;
        let at = it.sw > 0 && bleed > 0.5 && bleed <= it.sw + 2 ? start - it.sw / 2 : start + len / 2 - nat / 2;
        if (cl != null) {
          if (at < cs - 0.5) at = cs;
          else if (at + nat > cs + cl + 0.5) at = cs + cl - nat;
        }
        return { start: at, len: nat };
      }
      if (cl == null) return null;
      const low = start < cs - 0.5;
      const high = start + len > cs + cl + 0.5;
      if (low && !high) return { start: start + len - nat, len: nat };
      if (high && !low) return { start, len: nat };
      if (low && high) return { start: cs, len: nat };
      return null;
    };
    let rect = null;
    const bleed = it.bleed;
    if (image && bleed && nw > 0 && nh > 0 && Math.abs(nw - (it.w + bleed.l + bleed.r)) <= 1.5 && Math.abs(nh - (it.h + bleed.t + bleed.b)) <= 1.5) {
      // The plugin told how far the picture reaches past the box, and it fits the picture's size: placed exactly.
      rect = { x: it.x - bleed.l, y: it.y - bleed.t, w: nw, h: nh };
    } else if (image && nw > 0 && nh > 0 && (Math.abs(nw - it.w) > 1.5 || Math.abs(nh - it.h) > 1.5 || it.w < 0.5 || it.h < 0.5)) {
      const ax = axis(it.x, it.w, nw, frameClip ? frameClip.x : 0, frameClip ? frameClip.w : null);
      const ay = axis(it.y, it.h, nh, frameClip ? frameClip.y : 0, frameClip ? frameClip.h : null);
      if (ax && ay) rect = { x: ax.start, y: ay.start, w: ax.len, h: ay.len };
    }
    if (image && rect) {
      ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    } else if (image) {
      ctx.drawImage(image, it.x, it.y, it.w, it.h);
    }
  } else {
    // A layer with a background blur and a layer blur: the frosted backdrop and the layer's own painting are made together, then the
    // whole is blurred by the layer blur (so the frosted area has soft edges, as in Figma).
    const backdrops = kindOf(it, "BACKGROUND_BLUR");
    if (layerBlur && backdrops.length && !kindOf(it, "GLASS").length && typeof OffscreenCanvas === "function") {
      const off = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
      const oc = off.getContext("2d");
      oc.setTransform(ctx.getTransform());
      for (const effect of backdrops) backdropBlur(oc, it, effect.radius, ctx.canvas);
      paintShape(oc, it, edit, picEdit);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    } else {
      for (const effect of backdrops) backdropBlur(ctx, it, effect.radius);
      for (const effect of kindOf(it, "GLASS")) backdropBlur(ctx, it, typeof effect.radius === "number" ? effect.radius : 12);
      paintShape(ctx, it, edit, picEdit);
    }
  }
  ctx.restore();
}
const where = new Map();
for (const block of D.blocks) for (const it of block.items) where.set(it.id, { block, it });
// A design can carry its own motion (D.motion: a script returning { init?, stateAt, drawLayer?, getSegments? }). Each frame
// stateAt gives per-layer changes { [id]: { dx, dy, sx, sy, ox, oy, alpha, text, freeClip, clip, hidden, draw } }; layers that are
// not part of the design (a Cursor) are drawn by drawLayer. The design script itself stays shared, so its fixes reach it.
const H = { drawItem, images, outline, paintStyle, rgba, view };
const M = (() => {
  if (typeof D.motion !== "string" || !D.motion) return null;
  try {
    return new Function("api", "D", "H", D.motion)(api, D, H);
  } catch (error) {
    return null;
  }
})();
// A shape edited in the Layer section (params.__shape): its fills, strokes, stroke width, corner radius, opacity and effects.
function applyShape(it, e) {
  if (!e) return it;
  const patch = {};
  if (e.fills) patch.fills = e.fills;
  if (e.strokes) patch.strokes = e.strokes;
  if (typeof e.sw === "number") patch.sw = e.sw;
  if (e.sp) patch.sp = e.sp;
  if (e.cap) patch.cap = e.cap;
  if (e.join) patch.join = e.join;
  if (e.dash) patch.dash = e.dash;
  if (e.sides) patch.sides = e.sides;
  if (e.radius !== undefined) patch.radius = e.radius;
  if (typeof e.am === "number") patch.alpha = it.alpha * e.am;
  if (e.fx === false) patch.effects = [];
  return Object.assign({}, it, patch);
}
// What the Layer section set on a frame (params.__groupStyle[frameId]: Clip content and Corner radius) replaces what was pasted: the
// frame's own fill takes the radius, and the clips the frame made for what it holds go (the group's clip does that job).
function withGroupStyle(it, styles) {
  let next = it;
  const own = styles[it.id];
  if (it.frame && own && Array.isArray(own.radius)) next = Object.assign({}, next, { radius: own.radius });
  if (next.clips.some((c) => c.f && styles[c.f])) next = Object.assign({}, next, { clips: next.clips.filter((c) => !(c.f && styles[c.f])) });
  return next;
}
function drawPatched(ctx, it, patch, edit, picEdit) {
  if (!patch) return drawItem(ctx, it, edit, picEdit);
  // A text whose value changes can run wider than the box it was pasted in: the tight boxes around it (auto-layout
  // frames sized to the old text) stop clipping it; the larger ones (a card, the container) still do.
  if (patch.freeClip) it = Object.assign({}, it, { clips: it.clips.filter((c) => c.w > it.w * 2.5 && c.h > it.h * 2.5) });
  // A layer that moves or scales (a slide in, a zoom in) keeps the clips of the big frames around it (the page, the container, with Clip content on) where they
  // are, so it is cut by the frame's edge while it moves; the small clips (its own card) move with it.
  let still = null;
  const scaling = (patch.sx != null && patch.sx !== 1) || (patch.sy != null && patch.sy !== 1);
  if ((patch.dx || patch.dy || scaling) && it.clips.length) {
    const big = (c) => c.w > D.width * 0.6 && c.h > D.height * 0.6;
    still = it.clips.filter(big);
    if (still.length) it = Object.assign({}, it, { clips: it.clips.filter((c) => !big(c)) });
  }
  ctx.save();
  if (still) for (const c of still) {
    outline(ctx, c.x, c.y, c.w, c.h, c.r, false);
    ctx.clip();
  }
  // A layer that turns, a wave that moves along its line, or a layer shown through a wedge keeps every frame that cuts it where it is.
  if (patch.rot || patch.loop || patch.sweep) {
    for (const c of it.clips) {
      outline(ctx, c.x, c.y, c.w, c.h, c.r, false);
      ctx.clip();
    }
    it = Object.assign({}, it, { clips: [] });
  }
  if (patch.sweep) {
    const rad = ((180 - patch.sweep.dir) * Math.PI) / 180;
    // The arc's start end (and half its stroke, a glow's wide stroke too) can lie below the pivot: the wedge then begins that much below the
    // horizontal, so nothing at the arc's start is cut off (a dark gap under the arc). Nothing shows before the sweep starts.
    const below = Math.max(0, it.y + it.h + (Number(it.sw) || 0) / 2 + 2 - patch.sweep.y);
    const pad = rad > 0.002 ? Math.atan2(below, Math.max(1, patch.sweep.x - it.x)) : 0;
    ctx.beginPath();
    ctx.moveTo(patch.sweep.x, patch.sweep.y);
    ctx.arc(patch.sweep.x, patch.sweep.y, 600, Math.PI - pad, Math.PI + Math.max(0.0001, rad), false);
    ctx.closePath();
    ctx.clip();
  }
  if (patch.clip) {
    ctx.beginPath();
    ctx.rect(patch.clip.x, patch.clip.y, patch.clip.w, patch.clip.h);
    ctx.clip();
  }
  // A band that opens across the layer from the middle of the frame, up and down at once (Mask out): patch.hole is its height.
  if (patch.hole > 0 && patch.holeAt) {
    ctx.beginPath();
    ctx.rect(-20000, -20000, 40000, 40000);
    ctx.rect(-20000, patch.holeAt.y - patch.hole / 2, 40000, patch.hole);
    ctx.clip("evenodd");
  }
  if (patch.dx || patch.dy) ctx.translate(patch.dx || 0, patch.dy || 0);
  if (patch.rot && patch.rotAt) {
    ctx.translate(patch.rotAt.x, patch.rotAt.y);
    ctx.rotate((patch.rot * Math.PI) / 180);
    ctx.translate(-patch.rotAt.x, -patch.rotAt.y);
  }
  if ((patch.sx != null && patch.sx !== 1) || (patch.sy != null && patch.sy !== 1)) {
    const ox = patch.ox != null ? patch.ox : it.x + it.w / 2;
    const oy = patch.oy != null ? patch.oy : it.y + it.h / 2;
    ctx.translate(ox, oy);
    ctx.scale(patch.sx != null ? patch.sx : 1, patch.sy != null ? patch.sy : 1);
    ctx.translate(-ox, -oy);
  }
  if (patch.alpha != null) ctx.globalAlpha *= Math.max(0, Math.min(1, patch.alpha));
  // A plan's fade scales the layer's own opacity (the drawing sets it again, so the context's alone would not show).
  if (patch.fade != null) it = Object.assign({}, it, { alpha: it.alpha * Math.max(0, Math.min(1, patch.fade)) });
  if (patch.blur > 0) ctx.filter = "blur(" + patch.blur * view.scale + "px)";
  if (patch.loop) {
    // The first wave length of the line, repeated end to end along the line and moved sideways: each copy shows only its own wave length, so the
    // copies meet exactly (a wave that goes on for ever, with no double line).
    for (const k of [-1, 0, 1]) {
      const offset = patch.loop.shift + k * patch.loop.step;
      ctx.save();
      ctx.beginPath();
      ctx.rect(it.x + offset, it.y - 60, patch.loop.step, it.h + 120);
      ctx.clip();
      ctx.translate(offset, 0);
      drawItem(ctx, it, edit, picEdit);
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  if (patch.trim != null) it = Object.assign({}, it, { trim: patch.trim });
  if (patch.rotY) it = Object.assign({}, it, { rotAt: patch.rotAt, rotY: patch.rotY });
  if (patch.draw) patch.draw(ctx, it, H);
  else drawItem(ctx, it, patch.text != null || patch.letters ? Object.assign({}, edit, patch.text != null ? { chars: patch.text } : null, patch.letters ? { letters: patch.letters } : null) : edit, picEdit);
  ctx.restore();
}
// The states of two motions at once: the second one wins where both change the same layer.
const mergeState = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const items = Object.assign({}, a.items);
  for (const id of Object.keys(b.items || {})) items[id] = Object.assign({}, items[id], b.items[id]);
  return Object.assign({}, a, b, { items });
};
const allIds = [];
for (const block of D.blocks) for (const it of block.items) allIds.push(it.id);
// An Interaction plan built by hand (params.plan: segments one after another, animations on a layer). Each animation brings its
// layer in: fade from clear, move up from below, scale from smaller, blur from soft, finishing when its time is over.
// params.__planLayers says which drawn layers a group of the Layers panel holds.
const PLAN_EASE = (k) => 1 - Math.pow(1 - k, 3);
// The middle of the boxes of some layers (the point a group scales and turns about), in the coordinates of their block.
function unionCenter(ids) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let at = null;
  for (const id of ids) {
    const found = where.get(id);
    if (!found || found.it.isMask) continue;
    if (at && found.block !== at) continue;
    at = found.block;
    x0 = Math.min(x0, found.it.x);
    y0 = Math.min(y0, found.it.y);
    x1 = Math.max(x1, found.it.x + found.it.w);
    y1 = Math.max(y1, found.it.y + found.it.h);
  }
  return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
}
// A text with a number in it, split for counting: the signs before and after, the decimals, the zeros in front ("064") and the commas.
function countParts(chars) {
  const m = /^([^0-9]*)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/.exec(String(chars));
  if (!m) return null;
  const raw = m[2];
  const dot = raw.indexOf(".");
  const whole = (dot < 0 ? raw : raw.slice(0, dot)).replace(/,/g, "");
  return { commas: raw.indexOf(",") >= 0, decimals: dot < 0 ? 0 : raw.length - dot - 1, pad: whole.length > 1 && whole[0] === "0" ? whole.length : 0, prefix: m[1], suffix: m[3], value: parseFloat(raw.replace(/,/g, "")) };
}
function countText(parts, value) {
  const fixed = Math.max(0, value).toFixed(parts.decimals);
  const dot = fixed.indexOf(".");
  let whole = dot < 0 ? fixed : fixed.slice(0, dot);
  while (parts.pad && whole.length < parts.pad) whole = "0" + whole;
  if (parts.commas) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.prefix + whole + (dot < 0 ? "" : fixed.slice(dot)) + parts.suffix;
}
function planState(params, time) {
  const plan = params.plan;
  if (!plan || !Array.isArray(plan.animations) || plan.animations.length === 0) return null;
  const starts = new Map();
  let at = 0;
  for (const segment of plan.segments || []) {
    starts.set(segment.id, at);
    at += (Number(segment.travel) || 0) + (Number(segment.hold) || 0);
  }
  const groups = params.__planLayers || {};
  const items = {};
  for (const animation of plan.animations) {
    if (animation.enabled === false) continue;
    const begin = (animation.segmentId && starts.has(animation.segmentId) ? starts.get(animation.segmentId) : 0) + (Number(animation.delay) || 0);
    const length = Math.max(0.001, Number(animation.duration) || 0.6);
    const k = PLAN_EASE(Math.min(1, Math.max(0, (time - begin) / length)));
    const targets = animation.layer ? groups[animation.layer] || [animation.layer] : allIds;
    const center = animation.effect === "in" || animation.effect === "out" || animation.effect === "flip" ? unionCenter(targets) : null;
    const dist = Number(animation.distance) || 0;
    const slide = animation.slide || "none";
    const side = (away) => ({
      dx: slide === "left" ? -away * dist : slide === "right" ? away * dist : 0,
      dy: slide === "top" ? -away * dist : slide === "bottom" ? away * dist : 0,
    });
    for (const id of targets) {
      const patch = items[id] || (items[id] = {});
      const effect = animation.effect;
      if (effect === "rotate" || effect === "spin") {
        // About the pivot (or the middle of the layers' boxes): rotate swings from the angle to where the layer is; spin never stops, one whole
        // turn every period, in step with the whole motion (the phase is the seconds already run when this scene starts).
        const pivot = animation.px != null && animation.py != null ? { x: Number(animation.px), y: Number(animation.py) } : unionCenter(targets);
        if (pivot) {
          if (effect === "rotate") {
            patch.rot = (patch.rot || 0) + (animation.angle == null ? 0 : Number(animation.angle)) * (1 - k);
            patch.rotAt = pivot;
          } else if (time >= begin && time <= begin + length) {
            const period = Math.max(0.01, Number(animation.period) || 1);
            patch.rot = (patch.rot || 0) + 360 * ((((time + (Number(animation.phase) || 0)) / period) % 1 + 1) % 1);
            patch.rotAt = pivot;
          }
        }
      } else if (effect === "sweep") {
        // A wedge from the left (180 degrees, 0 = right, 90 = up) clockwise to the direction the sweep ends at, which the layer shows through.
        const pivot = animation.px != null && animation.py != null ? { x: Number(animation.px), y: Number(animation.py) } : unionCenter(targets);
        if (pivot) {
          const end = animation.angle == null ? 0 : Number(animation.angle);
          let dir = end + (180 - end) * (1 - k);
          // A needle that swings in step (its base at bx, by, this sweep's angle, its length is reach): the reveal grows along the ring and ends
          // under the needle tip (the tip's direction seen from the pivot, the ring's centre), so the ring's ticks are cut along the ring's own
          // radius, at the needle.
          if (animation.bx != null && animation.by != null && Number(animation.reach) > 0) {
            const tip = (deg) => {
              const rad = (deg * Math.PI) / 180;
              const tx = Number(animation.bx) + Math.cos(rad) * Number(animation.reach);
              const ty = Number(animation.by) - Math.sin(rad) * Number(animation.reach);
              return (Math.atan2(-(ty - pivot.y), tx - pivot.x) * 180) / Math.PI;
            };
            // The tip may start a little above the ring's start: the reveal still starts at the ring's start and meets the tip at the end.
            dir = tip(dir) + (180 - tip(180)) * (1 - k);
          }
          patch.sweep = { dir, x: pivot.x, y: pivot.y };
        }
      } else if (effect === "wave") {
        if (time >= begin && time <= begin + length) {
          const step = Math.max(1, Number(animation.distance) || 90);
          const period = Math.max(0.01, Number(animation.period) || 1);
          patch.loop = { shift: ((((time + (Number(animation.phase) || 0)) / period) % 1 + 1) % 1) * step, step };
        }
      } else if (effect === "float") {
        // Two bobs and one slow sway in every period (whole cycles, so the end meets the start); distance is the size of a bob in design pixels.
        if (time >= begin && time <= begin + length) {
          const period = Math.max(0.01, Number(animation.period) || 8);
          const bob = animation.distance == null ? 6 : Number(animation.distance);
          const turn = (((time + (Number(animation.phase) || 0)) / period) % 1 + 1) % 1 * Math.PI * 2;
          patch.dy = (patch.dy || 0) + bob * Math.sin(2 * turn);
          patch.dx = (patch.dx || 0) + bob * 0.58 * Math.sin(turn + 1.2);
        }
      } else if (effect === "count") {
        const found = where.get(id);
        const typed = params.__text && params.__text[id] && params.__text[id].chars != null ? params.__text[id].chars : null;
        const parts = found && found.it.kind === "text" && found.it.text ? countParts(typed != null ? typed : found.it.text.chars) : null;
        if (parts) {
          const from = Number(animation.from) || 0;
          const to = animation.to != null ? Number(animation.to) : parts.value;
          // With its own target number a count only takes over from its start (several counts in a row on one number).
          if (animation.to == null || time >= begin) patch.text = countText(parts, from + (to - from) * k);
        }
      } else if (effect === "swap") {
        if (animation.text != null && time >= begin && time <= begin + length) patch.text = String(animation.text);
      } else if (effect === "hide") {
        if (time >= begin && time <= begin + length) patch.hidden = true;
      } else if (effect === "fade") patch.fade = (patch.fade == null ? 1 : patch.fade) * k;
      else if (effect === "move") patch.dy = (patch.dy || 0) + (1 - k) * 40;
      else if (effect === "scale") {
        const size = 0.8 + 0.2 * k;
        patch.sx = (patch.sx == null ? 1 : patch.sx) * size;
        patch.sy = (patch.sy == null ? 1 : patch.sy) * size;
      } else if (effect === "blur") patch.blur = (patch.blur || 0) + (1 - k) * 16;
      else if (effect === "in" || effect === "out") {
        // The amount the layer is still away from its place: 1 before it comes in (or after it has gone out), 0 where it sits.
        const away = effect === "in" ? 1 - k : k;
        patch.fade = (patch.fade == null ? 1 : patch.fade) * (1 - away);
        if (animation.blur) patch.blur = (patch.blur || 0) + away * Number(animation.blur);
        const to = side(away);
        patch.dx = (patch.dx || 0) + to.dx;
        patch.dy = (patch.dy || 0) + to.dy;
        const from = animation.scale == null ? 1 : Number(animation.scale) / 100;
        if (from !== 1) {
          const size = 1 + (from - 1) * away;
          patch.sx = (patch.sx == null ? 1 : patch.sx) * size;
          patch.sy = (patch.sy == null ? 1 : patch.sy) * size;
          if (center) {
            patch.ox = center.x;
            patch.oy = center.y;
          }
        }
      } else if (effect === "letters" || effect === "lettersOut") {
        const to = side(1);
        const one = { blur: Number(animation.blur) || 0, dx: to.dx, dy: to.dy, length, stagger: animation.stagger == null ? 0.05 : Number(animation.stagger), t: time - begin };
        patch.letters = Object.assign({}, patch.letters, effect === "letters" ? { in: one } : { out: one });
      } else if (effect === "trim") patch.trim = k;
      else if (effect === "flip") {
        // Waits flat until it starts, then turns from the angle to flat (a whole turn comes back to where it was).
        const angle = time < begin ? 0 : ((animation.angle == null ? 90 : Number(animation.angle)) * (1 - k) * Math.PI) / 180;
        const found = where.get(id);
        if (found && found.it.paths) {
          patch.rotY = angle;
          if (center) patch.rotAt = center;
        } else {
          patch.sx = (patch.sx == null ? 1 : patch.sx) * Math.max(0.0001, Math.abs(Math.cos(angle)));
          if (center) {
            patch.ox = center.x;
            patch.oy = center.y;
          }
        }
      } else if (effect === "reveal") {
        const found = where.get(id);
        if (found) {
          const s = found.block.s || 1;
          const cx = (D.width / 2 - found.block.x) / s;
          const cy = (D.height / 2 - found.block.y) / s;
          patch.holeAt = { x: cx, y: cy };
          patch.hole = k * (D.height / s + 8);
        }
      }
    }
  }
  return { items };
}
return {
  getSegments(params) {
    return M && M.getSegments ? M.getSegments(params || {}) : null;
  },
  async init() {
    if (M && M.init) await M.init();
    // Fonts the design carries (added in the Layer section, or from the app's saved fonts).
    for (const font of api.fonts || []) {
      const source = api.assets[font.asset];
      if (!source || typeof FontFace !== "function") continue;
      try {
        const face = new FontFace(font.family, "url(" + source + ")", { style: font.style || "normal", weight: String(font.weight || 400) });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        // A font file that cannot be read: the text falls back to another font.
      }
    }
    for (const block of D.blocks) {
      for (const it of block.items) {
        if (it.kind === "svg" && it.svg) images.set(it.id, await load("data:image/svg+xml;base64," + toBase64(it.svg)));
        if (it.kind === "png" && api.assets[it.png || "designPng"]) images.set(it.id, await load(api.assets[it.png || "designPng"]));
        if (it.fillAsset && api.assets[it.fillAsset]) images.set(it.id, await load(api.assets[it.fillAsset]));
        for (const key of it.pic ? it.pic.files || [it.pic.asset] : []) {
          if (api.assets[key]) images.set(it.id + "#p:" + key, await load(api.assets[key]));
        }
        if (it.text && it.text.img && api.assets[it.text.img]) images.set(it.id + "#t", await load(api.assets[it.text.img]));
      }
    }
  },
  async render(ctx, frame) {
    const params = frame.params || {};
    const edits = params.__text || {};
    const pictures = params.__picture || {};
    const scale = frame.pixelScale;
    const ox = (frame.width - D.width) / 2;
    const oy = (frame.height - D.height) / 2;
    view.cw = ctx.canvas.width;
    view.ch = ctx.canvas.height;
    // The design's frame layer (chosen in Frame Settings): its background takes the frame's fill, stroke and corner
    // radius, and the layers it clips follow its corners (or are not clipped when Clip content is off).
    const F = params.__frame && params.__frame.bg ? params.__frame : null;
    const isFrameBox = (c) => F && F.box && Math.abs(c.x - F.box.x) < 0.5 && Math.abs(c.y - F.box.y) < 0.5 && Math.abs(c.w - F.box.w) < 0.5 && Math.abs(c.h - F.box.h) < 0.5;
    const framed = (block, it) => {
      if (!F || block.id !== F.block) return it;
      let out = it;
      if (it.clips.some(isFrameBox)) {
        const clips = F.clip === false ? it.clips.filter((c) => !isFrameBox(c)) : it.clips.map((c) => (isFrameBox(c) && F.radius != null ? Object.assign({}, c, { r: F.radius }) : c));
        out = Object.assign({}, out, { clips });
      }
      if (it.id === F.bg) {
        const patch = {};
        if (F.radius != null) patch.radius = F.radius;
        if (F.fill === false) { patch.fills = []; patch.fillAsset = undefined; patch.pic = undefined; }
        else if (F.fillColor) { patch.fills = [{ type: "SOLID", color: F.fillColor, opacity: 1 }]; patch.fillAsset = undefined; patch.pic = undefined; }
        if (F.stroke === false) { patch.strokes = []; patch.sw = 0; }
        else if (F.stroke === true) { patch.strokes = [{ type: "SOLID", color: F.strokeColor || "#FFFFFF", opacity: 1 }]; patch.sw = F.strokeWidth || 1; }
        out = Object.assign({}, out, patch);
      }
      return out;
    };
    // A scene without the design's motion (params.__noMotion) draws only its own plan; a scene that starts from the end of the
    // scene before it (params.__base) draws that scene's last picture's changes underneath its own.
    const motionOn = M && M.stateAt && !params.__noMotion;
    const base = params.__base;
    let baseState = null;
    if (base) {
      const baseParams = Object.assign({}, base.params, { plan: base.plan, __planLayers: base.planLayers });
      baseState = mergeState(base.motion && M && M.stateAt ? M.stateAt(base.params, base.time, frame) : null, planState(baseParams, base.time));
    }
    // The motion's own layers (a Cursor) are drawn from the motion's state, never from a plan's.
    const hasMotionState = !!(motionOn || (base && base.motion && M && M.stateAt));
    let st = mergeState(baseState, motionOn ? M.stateAt(params, frame.timeSeconds, frame) : null);
    st = mergeState(st, planState(params, frame.timeSeconds));
    // One layer painted on a context (the picture, or the offscreen picture of a frame whose layer blur covers what it holds).
    const paint = (ctx, id, noBlur) => {
      const found = where.get(id);
      if (!found) {
        // A layer the motion draws itself (a Cursor), in the design's coordinates.
        if (M && M.drawLayer && hasMotionState) {
          view.scale = scale;
          view.ox = ox;
          view.oy = oy;
          ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);
          M.drawLayer(ctx, id, st, frame);
        }
        return;
      }
      const patch = st && st.items ? st.items[id] : null;
      if (patch && patch.hidden) return;
      if (found.it.isMask) return;
      const block = found.block;
      // A blend mode picked in the Layer section (params.__blend) replaces the one the layer was pasted with.
      const blendPick = params.__blend && params.__blend[id];
      const framedIt = framed(block, found.it);
      const blended = blendPick ? Object.assign({}, framedIt, { blend: blendPick }) : framedIt;
      const styled = withGroupStyle(applyShape(blended, params.__shape && params.__shape[id]), params.__groupStyle || {});
      const it = noBlur ? Object.assign({}, styled, { effects: styled.effects.filter((effect) => effect.type !== "LAYER_BLUR") }) : styled;
      const s = block.s || 1;
      view.scale = scale * s;
      view.ox = (ox + block.x) / s;
      view.oy = (oy + block.y) / s;
      ctx.setTransform(scale * s, 0, 0, scale * s, (ox + block.x) * scale, (oy + block.y) * scale);
      // A layer moved in the Layer section (params.__pos) is drawn that far from where it was pasted.
      const place = params.__pos && params.__pos[id];
      const placed = place ? Object.assign({}, patch, { dx: ((patch && patch.dx) || 0) + (place.x || 0), dy: ((patch && patch.dy) || 0) + (place.y || 0) }) : patch;
      // A layer stretched on the artboard (params.__grow) is scaled from its top-left corner, on top of any scale its motion gives it.
      const grown = params.__grow && params.__grow[id];
      const moved = grown
        ? Object.assign({}, placed, {
            ox: placed && placed.ox != null ? placed.ox : it.x,
            oy: placed && placed.oy != null ? placed.oy : it.y,
            sx: (placed && placed.sx != null ? placed.sx : 1) * (grown.sx || 1),
            sy: (placed && placed.sy != null ? placed.sy : 1) * (grown.sy || 1),
          })
        : placed;
      // A masked layer: drawn on its own, then cut to the shape of its mask layer (the design's own, or the one picked in the
      // Layer section; "" is no mask). A mask layer itself is not shown.
      const picked = params.__mask && Object.prototype.hasOwnProperty.call(params.__mask, id) ? params.__mask[id] : it.mask;
      const mask = picked && block.masks ? block.masks[picked] : null;
      const shapeIds = mask ? mask.items.filter((maskId) => where.has(maskId)) : [];
      if (mask && shapeIds.length && typeof OffscreenCanvas === "function") {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const t = ctx.getTransform();
        const layer = new OffscreenCanvas(w, h);
        const lc = layer.getContext("2d");
        lc.setTransform(t);
        drawPatched(lc, it, moved, edits[id], pictures[id]);
        const shape = new OffscreenCanvas(w, h);
        const sc = shape.getContext("2d");
        sc.setTransform(t);
        for (const maskId of shapeIds) {
          const maskFound = where.get(maskId);
          if (maskFound) drawItem(sc, Object.assign({}, maskFound.it, { alpha: 1, blend: "source-over", effects: [] }), null, null);
        }
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.globalCompositeOperation = "destination-in";
        lc.drawImage(shape, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(layer, 0, 0);
        ctx.restore();
      } else {
        drawPatched(ctx, it, moved, edits[id], pictures[id]);
      }
    };
    // Bottom to top, in the Layers panel's order. A frame with a layer blur is painted with what it holds as one picture, blurred as a
    // whole (as in Figma); the layers it holds are then not painted again.
    const drawnInFrame = new Set();
    const inStack = new Set(frame.layerStack);
    for (const id of frame.layerStack) {
      if (drawnInFrame.has(id)) continue;
      const found = where.get(id);
      const members = found && ((found.it.frame && found.it.frame.members) || (params.__blurMembers && params.__blurMembers[id]));
      const blurry = members && found.it.effects.filter((effect) => effect.type === "LAYER_BLUR" && (effect.radius > 0 || effect.startRadius > 0))[0];
      const hiddenFrame = st && st.items && st.items[id] && st.items[id].hidden;
      if (blurry && !hiddenFrame && !(params.__shape && params.__shape[id] && params.__shape[id].fx === false) && typeof OffscreenCanvas === "function") {
        const group = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
        const gc = group.getContext("2d");
        paint(gc, id, true);
        for (const memberId of members) {
          if (!inStack.has(memberId) || drawnInFrame.has(memberId)) continue;
          drawnInFrame.add(memberId);
          paint(gc, memberId, false);
        }
        const block = found.block;
        const k = scale * (block.s || 1);
        if (blurry.blurType === "PROGRESSIVE") {
          ctx.setTransform(k, 0, 0, k, (ox + block.x) * scale, (oy + block.y) * scale);
          progressiveBlur(ctx, group, found.it, blurry, k);
        } else {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.filter = "blur(" + (blurry.radius / 2) * k + "px)";
          ctx.drawImage(group, 0, 0);
          ctx.restore();
        }
        continue;
      }
      paint(ctx, id, false);
    }
  },
};
`;

// The layer of a pasted design that is its frame (Frame Settings edit it): kept with the project's settings (params).
// bg is the frame's own background layer, box its place in its block (the clip its contents share). The other fields
// are the frame's settings, set only once changed (until then the layer is as it was pasted).
export const FRAME_LAYER_KEY = "__frame";
export type FrameLayer = Readonly<{
  bg: string;
  block: string;
  box: Readonly<{ h: number; w: number; x: number; y: number }>;
  clip?: boolean;
  fill?: boolean;
  fillColor?: string;
  layer: string;
  radius?: number;
  stroke?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
}>;

export function readFrameLayer(params: Readonly<Record<string, unknown>> | undefined): FrameLayer | null {
  const stored = params?.[FRAME_LAYER_KEY];
  return isRecord(stored) && typeof stored.layer === "string" && typeof stored.bg === "string" && isRecord(stored.box) ? (stored as unknown as FrameLayer) : null;
}

type PanelLayer = Readonly<{ id: string; kind?: string; name: string; parentGroupId?: string }>;

// The group layers of the pasted design that can be its frame (they have a background of their own), near the top.
export function frameLayerCandidates(spec: AnimationSpec, layers: readonly PanelLayer[]): { bg: string; id: string; name: string }[] {
  const depth = (layer: PanelLayer): number => {
    let level = 0;
    for (let parent = layer.parentGroupId; parent && level < 5; level += 1) parent = layers.find((item) => item.id === parent)?.parentGroupId;
    return level;
  };
  return layers
    .filter((layer) => layer.kind === "group" && depth(layer) <= 1)
    .flatMap((group) => {
      const bg = layers.find((layer) => layer.parentGroupId === group.id && layer.name === `${group.name} background` && findFigmaItem(spec, layer.id));
      return bg ? [{ bg: bg.id, id: group.id, name: group.name }] : [];
    });
}

// The frame record for a group layer (with its background), or null when it cannot be the frame.
export function frameLayerFor(spec: AnimationSpec, candidate: Readonly<{ bg: string; id: string }>): FrameLayer | null {
  const design = readFigmaDesign(spec);
  for (const block of design?.blocks ?? []) {
    const item = block.items.find((own) => own.id === candidate.bg);
    if (item) return { bg: item.id, block: block.id, box: { h: item.h, w: item.w, x: item.x, y: item.y }, layer: candidate.id };
  }
  return null;
}

// The frame layer's settings as they are now: what was pasted, with the changes made in Frame Settings.
export function frameLayerStyle(spec: AnimationSpec, frame: FrameLayer): Readonly<{ clip: boolean; fill: boolean; fillColor: string; radius: number; stroke: boolean; strokeColor: string; strokeWidth: number }> {
  const item = findFigmaItem(spec, frame.bg);
  const solid = (list: unknown[] | undefined): string | null => {
    const paint = (list ?? []).find((own): own is { color: string; type: string } => isRecord(own) && own.type === "SOLID" && typeof own.color === "string");
    return paint ? paint.color.toUpperCase() : null;
  };
  const fillColor = solid(item?.fills) ?? "#FFFFFF";
  const hasFill = (item?.fills.length ?? 0) > 0 || Boolean(item?.fillAsset) || Boolean(item?.pic);
  const strokeColor = solid(item?.strokes) ?? "#FFFFFF";
  const radius = Array.isArray(item?.radius) ? (item?.radius[0] ?? 0) : (item?.radius ?? 0);
  const design = readFigmaDesign(spec);
  const box = frame.box;
  const clips = (design?.blocks.find((block) => block.id === frame.block)?.items ?? []).some((own) =>
    own.clips.some((c) => Math.abs(c.x - box.x) < 0.5 && Math.abs(c.y - box.y) < 0.5 && Math.abs(c.w - box.w) < 0.5 && Math.abs(c.h - box.h) < 0.5),
  );
  return {
    clip: frame.clip ?? clips,
    fill: frame.fill ?? hasFill,
    fillColor: (frame.fillColor ?? fillColor).toUpperCase(),
    radius: frame.radius ?? radius,
    stroke: frame.stroke ?? (item?.sw ?? 0) > 0,
    strokeColor: (frame.strokeColor ?? strokeColor).toUpperCase(),
    strokeWidth: frame.strokeWidth ?? (item?.sw || 1),
  };
}

// The design script a stored animation runs: a pasted design always draws with this version of the script (fixes reach
// designs pasted before them), and a project's own script keeps its own code.
export function currentDesignCode(code: string): string {
  if (code.startsWith(DESIGN_MARK)) return DESIGN_CODE;
  if (code.startsWith(COMPOSITE_MARK)) {
    const start = code.indexOf("const __base = (function (api) {\n");
    const end = code.indexOf("\n})(api);\nconst __design = (function (api) {");
    if (start >= 0 && end > start) return compositeCode(code.slice(start + "const __base = (function (api) {\n".length, end));
  }
  return code;
}

// A project's own script with pasted blocks drawn over it.
function compositeCode(baseCode: string): string {
  return `${COMPOSITE_MARK}
const __base = (function (api) {
${baseCode}
})(api);
const __design = (function (api) {
${DESIGN_CODE}
})(api);
const __mine = new Set();
for (const block of (api.design && api.design.blocks) || []) for (const it of block.items) __mine.add(it.id);
return Object.assign({}, __base, {
  async init() {
    if (__base.init) await __base.init();
    await __design.init();
  },
  async render(ctx, frame) {
    ctx.save();
    await __base.render(ctx, Object.assign({}, frame, { layerStack: frame.layerStack.filter((id) => !__mine.has(id)) }));
    ctx.restore();
    const mine = frame.layerStack.filter((id) => __mine.has(id));
    if (mine.length === 0) return;
    ctx.save();
    await __design.render(ctx, Object.assign({}, frame, { layerStack: mine }));
    ctx.restore();
  },
});`;
}

export function figmaPasteProjectName(text: string): string | null {
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || data.type !== "mo-figma-layers" || !Array.isArray(data.nodes)) return null;
    const first = data.nodes.find(isRecord);
    return first && typeof first.name === "string" && first.name.trim() ? first.name.trim() : "Figma design";
  } catch {
    return null;
  }
}

export function isFigmaPaste(text: string): boolean {
  return figmaPasteProjectName(text) !== null;
}

function paintList(fills: unknown): Json[] {
  return Array.isArray(fills) ? fills.filter(isRecord) : [];
}

// What a layer marked "Artboard" in the plugin gives the project: its name, size and fill (solid or gradient).
export type PasteBackdrop = Readonly<{
  angle: number;
  from: string;
  height: number;
  name: string;
  to: string | null;
  width: number;
  // Where the marked frame sits inside the pasted design (its top-left corner, in design pixels).
  x: number;
  y: number;
}>;

// The first node (the roots first, then inside) carrying the plugin's artboard mark.
function findBackdropNode(nodes: readonly Json[]): Json | null {
  for (const node of nodes) {
    if (node.mark === "bg") return node;
  }
  for (const node of nodes) {
    const found = findBackdropNode(Array.isArray(node.children) ? node.children.filter(isRecord) : []);
    if (found) return found;
  }
  return null;
}

// Gradient angle in the app's convention (0° = to the top, 180° = to the bottom) from a Figma gradient transform.
function gradientAngle(transform: unknown): number {
  if (!Array.isArray(transform) || transform.length < 2 || !Array.isArray(transform[0]) || !Array.isArray(transform[1])) return 180;
  const [a, b] = transform[0] as number[];
  const [d, e] = transform[1] as number[];
  const det = a * e - b * d;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return 180;
  const vx = e / det;
  const vy = -d / det;
  const degrees = (Math.atan2(vx, -vy) * 180) / Math.PI;
  return Math.round(((degrees % 360) + 360) % 360);
}

export function readBackdrop(nodes: readonly Json[], originX = 0, originY = 0): PasteBackdrop | null {
  const node = findBackdropNode(nodes);
  if (!node) return null;
  const at = isRecord(node.abs) ? { x: num(node.abs.x) - originX, y: num(node.abs.y) - originY } : { x: 0, y: 0 };
  const fills = paintList(node.fills).filter((fill) => fill.type === "SOLID" || (typeof fill.type === "string" && fill.type.startsWith("GRADIENT")));
  const top = fills[fills.length - 1];
  const width = Math.round(num(node.width));
  const height = Math.round(num(node.height));
  const name = str(node.name) || "Artboard";
  if (!top || !(width > 0) || !(height > 0)) return { angle: 180, from: "#FFFFFF", height: Math.max(1, height), name, to: null, width: Math.max(1, width), ...at };
  if (top.type === "SOLID") return { angle: 180, from: str(top.color) || "#FFFFFF", height, name, to: null, width, ...at };
  const stops = Array.isArray(top.stops) ? top.stops.filter(isRecord) : [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  return {
    angle: gradientAngle(top.transform),
    from: first ? str(first.color) || "#FFFFFF" : "#FFFFFF",
    height,
    name,
    to: last ? str(last.color) || "#FFFFFF" : null,
    width,
    ...at,
  };
}

// The values the artboard takes from a backdrop (background fill, name).
export function backdropValues(backdrop: PasteBackdrop): Record<string, unknown> {
  const upper = (color: string): string => color.toUpperCase();
  return {
    "appearance.background": upper(backdrop.from),
    "artboard.name": backdrop.name,
    "bg.fillAngle": backdrop.angle,
    "bg.fillTo": upper(backdrop.to ?? backdrop.from),
    "bg.fillType": backdrop.to ? "gradient" : "solid",
    "bg.mode": "fill",
  };
}

// A layer named like a file ("69d256de7d74a6529b29daf1_Polygon%201.svg 2"): the hash, the %20 codes and the extension go.
export function fileLayerName(raw: string): string {
  let text = raw;
  let changed = false;
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) {
      text = decoded;
      changed = true;
    }
  } catch {
    // not an encoded name
  }
  const noExt = text.replace(/\.(svg|png|jpe?g|gif|webp|avif|mp4|webm|mov|pdf)\b/gi, "");
  if (noExt !== text) {
    text = noExt;
    changed = true;
  }
  const noHash = text.replace(/^[0-9a-f]{12,}[\s_-]+/i, "");
  if (noHash !== text) {
    text = noHash;
    changed = true;
  }
  if (changed) text = text.replace(/_+/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export type ParsedPaste = {
  assets: Record<string, string>;
  backdrop: PasteBackdrop | null;
  block: FigmaBlock;
  // The design's own picture (2x), kept as a hidden "Original picture" layer in a new project.
  designPng: string | null;
  // The Layers panel entries, top first; the first root layer is named after the Figma frame.
  layers: ProjectFileLayer[];
  name: string;
  specLayers: { id: string; name: string }[];
};

// Reads the plugin's JSON into one block at (0, 0). Layer ids start with `prefix`, so several pastes never clash.
export function parseFigmaPaste(text: string, prefix = "fg-"): ParsedPaste {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON. Paste what the seaMotion plugin copied.");
  }
  if (!isRecord(data) || data.type !== "mo-figma-layers" || !Array.isArray(data.nodes) || data.nodes.length === 0) {
    throw new Error("This is not a design copied by the seaMotion plugin. Select layers in Figma, press Copy in the plugin, then paste here.");
  }
  const roots = data.nodes.filter(isRecord);
  // Roots are placed by their absolute boxes (so layers taken from different parents keep their relative places).
  const rootX = (node: Json): number => (isRecord(node.abs) ? num(node.abs.x) : num(node.x));
  const rootY = (node: Json): number => (isRecord(node.abs) ? num(node.abs.y) : num(node.y));
  const rootW = (node: Json): number => (isRecord(node.abs) ? num(node.abs.width) : num(node.width));
  const rootH = (node: Json): number => (isRecord(node.abs) ? num(node.abs.height) : num(node.height));
  const left = Math.min(...roots.map(rootX));
  const top = Math.min(...roots.map(rootY));
  const right = Math.max(...roots.map((node) => rootX(node) + rootW(node)));
  const bottom = Math.max(...roots.map((node) => rootY(node) + rootH(node)));
  const width = Math.max(1, Math.round(right - left));
  const height = Math.max(1, Math.round(bottom - top));

  const items: FigmaItem[] = [];
  const assets: Record<string, string> = {};
  const specLayers: { id: string; name: string }[] = [];
  let counter = 0;
  const nextId = (): string => `${prefix}${(counter += 1)}`;

  const base = (node: Json, id: string, x: number, y: number, alpha: number, clips: Clip[]): FigmaItem => {
    const radius = Array.isArray(node.cornerRadius) ? node.cornerRadius.map((value) => num(value)) : num(node.cornerRadius);
    const strokes = paintList(node.strokes);
    const fillImage = typeof node.fillImage === "string" && node.fillImage.startsWith("data:image/") ? node.fillImage : null;
    const fills = paintList(node.fills);
    let pic: FigmaPicture | undefined;
    const image = isRecord(node.image) ? node.image : null;
    const base64Picture = image && typeof image.src === "string" && image.src.startsWith("data:image/") ? image.src : null;
    if (image && base64Picture) {
      assets[`pic-${id}`] = base64Picture;
      pic = {
        asset: `pic-${id}`,
        mode: str(image.scaleMode) || "FILL",
        only: fills.filter((paint) => paint.type === "IMAGE").length === fills.length && fills.length === 1,
        opacity: num(image.opacity, 1),
        ...(typeof image.scalingFactor === "number" ? { sf: image.scalingFactor } : {}),
        ...(Array.isArray(image.imageTransform) ? { t: image.imageTransform as number[][] } : {}),
      };
    } else if (image && fillImage) {
      // A video fill (its file cannot leave Figma) or a picture too big to copy: the layer shows the fill as Figma
      // drew it, and its file can be added in the app.
      assets[`pic-${id}`] = fillImage;
      pic = { asset: `pic-${id}`, mode: "FILL", only: true, opacity: 1, ...(image.video === true ? { video: true } : {}) };
    }
    // A picture drawn from its own file needs no copy of Figma's rendered fill; stacked paints keep it (it is how
    // they look together).
    const keepFill = fillImage !== null && !pic?.only;
    if (keepFill && fillImage) assets[`fill-${id}`] = fillImage;
    return {
      alpha,
      blend: BLEND[str(node.blendMode)] ?? "source-over",
      clips,
      effects: Array.isArray(node.effects) ? node.effects.filter(isRecord) : [],
      ellipse: node.type === "ELLIPSE",
      ...(keepFill ? { fillAsset: `fill-${id}` } : {}),
      // A fill that travelled as a picture is drawn from the picture, not from its colors.
      // The frame marked as the artboard is the artboard: its fill is the artboard's background (backdropValues), so it is not painted again as
      // a layer on top; changing the Background color then changes what shows, which is the frame's own colour.
      fills: fillImage || pic || node.mark === "bg" ? [] : fills,
      h: num(node.height),
      id,
      kind: "shape",
      ...(pic ? { pic } : {}),
      radius,
      rot: num(node.rotation),
      strokes,
      sw: strokes.length ? num(node.strokeWeight, 1) : 0,
      w: num(node.width),
      x,
      y,
    };
  };

  const layerEntry = (id: string, name: string, visible: boolean, parent: string | undefined): ProjectFileLayer => ({
    id,
    kind: "layer",
    name,
    visible,
    ...(parent ? { parentGroupId: parent } : {}),
  });

  // Masking: layer -> the layer that masks it, and the mask layers with their names.
  const tags: Record<string, string> = {};
  const maskOf = new Map<string, string>();
  const maskLayers = new Map<string, string>();

  // Walks one node; returns its layer entries (top-first order is made by the caller).
  const walk = (node: Json, parentLayerId: string | undefined, pm: Mat, alpha: number, clips: Clip[], rootAt?: Mat, fixedId?: string): ProjectFileLayer[] => {
    const name = fileLayerName(str(node.name)) || "Layer";
    const ownTransform = parseTransform(node.transform);
    const local: Mat = rootAt ?? ownTransform ?? [1, 0, 0, 1, num(node.x), num(node.y)];
    const abs = multiply(pm, local);
    const upright = isUpright(abs);
    const x = abs[4];
    const y = abs[5];
    // Rotated or flipped (the layer or a parent): drawn in its own box through its matrix.
    const place = (item: FigmaItem): FigmaItem => {
      const box = isRecord(node.abs) ? node.abs : null;
      if ((item.kind === "svg" || item.kind === "png") && ownTransform && box) {
        // An exported icon already has its own rotation or flip in the picture: it is only placed in its bounds.
        item.x = num(box.x) - left;
        item.y = num(box.y) - top;
        item.w = num(box.width);
        item.h = num(box.height);
        item.rot = 0;
        return item;
      }
      item.rot = 0;
      if (!upright) {
        item.m = abs;
        item.x = 0;
        item.y = 0;
      }
      return item;
    };
    const own = alpha * (typeof node.opacity === "number" ? node.opacity : 1);
    const visible = node.visible !== false;
    const children = Array.isArray(node.children) ? node.children.filter(isRecord) : [];
    const id = fixedId ?? nextId();
    if (typeof node.tag === "string" && node.tag) tags[id] = node.tag;
    const hasPaint = paintList(node.fills).length > 0 || paintList(node.strokes).length > 0 || (Array.isArray(node.effects) && node.effects.length > 0);

    // The sides of a box that carry a stroke on their own (a bottom rule, a left bar) become line layers: boxes as thick as the stroke,
    // filled with the stroke's paint (solid or gradient), on that side. The box itself then has no border.
    const sideInfo = isRecord(node.sideStrokes) ? node.sideStrokes : null;
    const sideLines = (lineClips: Clip[], lineParent: string | undefined, soleName: boolean): ProjectFileLayer[] => {
      const sides = sideInfo && Array.isArray(sideInfo.sides) ? sideInfo.sides.filter(isRecord) : [];
      const paints = sideInfo ? paintList(sideInfo.paints) : [];
      if (sides.length === 0 || paints.length === 0) return [];
      const w = num(node.width);
      const h = num(node.height);
      const found: ProjectFileLayer[] = [];
      for (const side of sides) {
        const weight = Math.max(0, num(side.weight));
        const which = str(side.side);
        if (weight <= 0) continue;
        const box = which === "TOP" ? [0, 0, w, weight] : which === "BOTTOM" ? [0, h - weight, w, weight] : which === "LEFT" ? [0, 0, weight, h] : [w - weight, 0, weight, h];
        const lineId = nextId();
        const lineName = soleName && sides.length === 1 ? name : `${name} ${which.toLowerCase()} line`;
        const item: FigmaItem = {
          alpha: own,
          blend: BLEND[str(node.blendMode)] ?? "source-over",
          clips: lineClips,
          effects: [],
          ellipse: false,
          fills: paints,
          h: box[3] as number,
          id: lineId,
          kind: "shape",
          line: which.toLowerCase(),
          radius: 0,
          rot: 0,
          strokes: [],
          sw: 0,
          w: box[2] as number,
          x: upright ? x + (box[0] as number) : box[0] as number,
          y: upright ? y + (box[1] as number) : box[1] as number,
        };
        if (!upright) item.m = abs;
        items.push(item);
        specLayers.push({ id: lineId, name: lineName });
        found.push(layerEntry(lineId, lineName, visible, lineParent));
      }
      return found;
    };

    if (node.type === "TEXT") {
      const item = place(base(node, id, x, y, own, clips));
      const t = isRecord(node.text) ? node.text : {};
      const size = num(t.fontSize, 16);
      const family = str(t.fontFamily) || "Inter";
      const style = str(t.fontStyle) || "Regular";
      const fonts: FigmaFont[] = Array.isArray(t.fonts)
        ? t.fonts.filter(isRecord).map((font) => ({ family: str(font.family), style: str(font.style) || "Regular", weight: num(font.weight, weightOfStyle(str(font.style))) }))
        : [];
      if (fonts.length === 0) fonts.push({ family, style, weight: num(t.fontWeight, weightOfStyle(style)) });
      item.kind = "text";
      item.text = {
        align: str(t.align) || "LEFT",
        ...(str(t.case) && t.case !== "ORIGINAL" ? { case: str(t.case) } : {}),
        chars: str(node.characters),
        ...(str(t.decoration) && t.decoration !== "NONE" ? { deco: str(t.decoration) } : {}),
        family,
        fonts,
        lh: lineHeightPx(t.lineHeight, size),
        ...(str(t.autoResize) ? { resize: str(t.autoResize) } : {}),
        ls: letterSpacingPx(t.letterSpacing, size),
        size,
        style,
        valign: str(t.verticalAlign) || "TOP",
        weight: num(t.fontWeight, weightOfStyle(style)),
      };
      const picture = typeof node.textPng === "string" && node.textPng.startsWith("data:image/") ? node.textPng : null;
      const box = isRecord(node.textPngBox) ? node.textPngBox : null;
      if (picture && box) {
        assets[`text-${id}`] = picture;
        item.text.img = `text-${id}`;
        // Centered on the text's box from its position in its parent (page positions of the working copy can be stale).
        const size = pngSize(picture);
        const w = size ? size.width / 2 : num(box.width);
        const h = size ? size.height / 2 : num(box.height);
        const [cx, cy] = boxCenter(abs, num(node.width), num(node.height));
        item.text.ib = { h, w, x: cx - w / 2, y: cy - h / 2 };
        item.text.ia = alpha;
      }
      items.push(item);
      specLayers.push({ id, name });
      return [layerEntry(id, name, visible, parentLayerId)];
    }

    // A drawn path with blur or shadows arrives as an exact picture, placed where Figma rendered it.
    if (typeof node.vectorPng === "string" && node.vectorPng.startsWith("data:image/") && isRecord(node.vectorPngBox)) {
      const box = node.vectorPngBox;
      // The picture's size is right, but Figma's render position for the plugin's working copy can be stale: the
      // picture (the shape plus its blur or glow, spread evenly) is centered on the shape's own box instead.
      // Placed by the layer's position in its parent (Figma's page positions of the plugin's working copy can be
      // stale): the picture, at its real size from the PNG, is centered on the layer's box.
      const size = pngSize(node.vectorPng);
      const pw = size ? size.width / 2 : num(box.width);
      const ph = size ? size.height / 2 : num(box.height);
      const [cx, cy] = boxCenter(abs, num(node.width), num(node.height));
      const px = cx - pw / 2;
      const py = cy - ph / 2;
      const item = base(node, id, px, py, alpha, clips);
      assets[`vec-${id}`] = node.vectorPng;
      Object.assign(item, { effects: [], fills: [], h: ph, kind: "png" as const, png: `vec-${id}`, rot: 0, strokes: [], sw: 0, w: pw });
      items.push(item);
      specLayers.push({ id, name });
      return [layerEntry(id, name, visible, parentLayerId)];
    }

    // A drawn shape as its outline (the plugin sends it for a vector, star, polygon, line, ring): painted from its fills and strokes.
    const outlines = Array.isArray(node.paths) ? node.paths.filter(isRecord).filter((path) => typeof path.d === "string" && path.d.length > 0) : [];
    if (outlines.length > 0) {
      const item = place(base(node, id, x, y, own, clips));
      item.paths = outlines.map((path) => ({ d: str(path.d), ...(str(path.r) ? { r: str(path.r) } : {}) }));
      if (str(node.strokeAlign)) item.sa = str(node.strokeAlign);
      if (str(node.strokeCap)) item.cap = str(node.strokeCap);
      if (str(node.strokeJoin)) item.join = str(node.strokeJoin);
      if (typeof node.strokeMiterLimit === "number") item.miter = node.strokeMiterLimit;
      items.push(item);
      specLayers.push({ id, name });
      return [layerEntry(id, name, visible, parentLayerId)];
    }

    if (typeof node.svg === "string") {
      const item = base(node, id, x, y, own, clips);
      item.kind = "svg";
      item.svg = node.svg;
      if (isRecord(node.svgBleed)) item.bleed = { b: num(node.svgBleed.bottom), l: num(node.svgBleed.left), r: num(node.svgBleed.right), t: num(node.svgBleed.top) };
      items.push(place(item));
      specLayers.push({ id, name });
      return [layerEntry(id, name, visible, parentLayerId)];
    }

    if (children.length === 0) {
      // A box with nothing of its own to show but a stroke on some sides is only those lines.
      const ownLook = hasPaint || paintList(node.fills).length > 0 || typeof node.fillImage === "string" || isRecord(node.image);
      const lines = sideLines(clips, parentLayerId, !ownLook);
      if (lines.length > 0 && !ownLook) return lines;
      const item = place(base(node, id, x, y, own, clips));
      items.push(item);
      specLayers.push({ id, name });
      return [...lines, layerEntry(id, name, visible, parentLayerId)];
    }

    // A container: a group. A Figma frame (an auto layout, a component) is a frame layer: a group whose own fill, stroke and
    // shadow are the bottom of what it holds, with the same id as the group (no separate background row).
    const isFrame = node.frame === true || FRAME_TYPES.has(str(node.type));
    const out: ProjectFileLayer[] = [{ collapsed: true, id, kind: "group", name, visible, ...(parentLayerId ? { parentGroupId: parentLayerId } : {}) }];
    const frameRadius = Array.isArray(node.cornerRadius) ? node.cornerRadius.map((value) => num(value)) : num(node.cornerRadius);
    const childClips =
      node.clipsContent === true && upright
        ? [...clips, { ...(isFrame ? { f: id } : {}), h: num(node.height), r: frameRadius, w: num(node.width), x, y }]
        : clips;
    // A Figma group (and a boolean shape) has no coordinate space of its own: its children are placed in its parent's
    // space, so they take the parent's matrix, not the group's (else the group's offset counts twice).
    const local0: Mat = ownTransform ?? [1, 0, 0, 1, num(node.x), num(node.y)];
    const childMatrix = node.type === "GROUP" || node.type === "BOOLEAN_OPERATION" ? multiply(abs, invertMat(local0)) : abs;
    // Figma lists children back to front; the Layers panel lists top first.
    // Ids first, so a mask (below its masked layers in z-order, walked after them) can be named by them.
    const childIds = children.map(() => nextId());
    const byPosition = new Map<number, string>();
    children.forEach((child, index) => byPosition.set(typeof child.idx === "number" ? child.idx : index, childIds[index] as string));
    children.forEach((child, index) => {
      const childId = childIds[index] as string;
      if (child.isMask === true) maskLayers.set(childId, str(child.name) || "Mask");
      const by = typeof child.maskBy === "number" ? byPosition.get(child.maskBy) : undefined;
      if (by) maskOf.set(childId, by);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      out.push(...walk(children[index] as Json, id, childMatrix, own, childClips, undefined, childIds[index]));
    }
    if (isFrame) {
      const frameItem = place(base(node, id, x, y, own, clips));
      const blurred = frameItem.effects.some((effect) => isRecord(effect) && effect.type === "LAYER_BLUR");
      frameItem.frame = {
        ...(node.autoLayout === true || isRecord(node.autoLayout) ? { auto: true } : {}),
        clip: node.clipsContent === true,
        ...(blurred ? { members: out.slice(1).map((layer) => layer.id) } : {}),
      };
      items.push(frameItem);
      specLayers.push({ id, name });
    } else if (hasPaint) {
      const backgroundId = nextId();
      items.push(place(base(node, backgroundId, x, y, own, clips)));
      specLayers.push({ id: backgroundId, name: `${name} background` });
      out.push(layerEntry(backgroundId, `${name} background`, visible, id));
    }
    out.splice(1, 0, ...sideLines(childClips, id, false));
    return out;
  };

  const layers: ProjectFileLayer[] = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const node = roots[index] as Json;
    layers.push(...walk(node, undefined, IDENTITY, 1, [], [1, 0, 0, 1, rootX(node) - left, rootY(node) - top]));
  }

  // Which drawn items make each mask's shape, and which mask cuts each item (a layer takes the mask of the nearest group
  // around it that is masked).
  const parentOf = new Map<string, string | undefined>();
  for (const layer of layers) parentOf.set(layer.id, layer.parentGroupId);
  const addParents = (list: readonly ProjectFileLayer[]): void => list.forEach((layer) => parentOf.set(layer.id, layer.parentGroupId));
  addParents(layers);
  const masks: Record<string, { items: string[]; name: string }> = {};
  for (const [maskId, name] of maskLayers) masks[maskId] = { items: [], name };
  for (const it of items) {
    let own: string | undefined;
    for (let at: string | undefined = it.id; at; at = parentOf.get(at)) {
      if (!own && maskOf.has(at)) own = maskOf.get(at);
      if (maskLayers.has(at) && masks[at]) {
        masks[at].items.push(it.id);
        it.isMask = true;
      }
    }
    if (own) it.mask = own;
  }
  const png = roots.map((node) => str(node.png)).find((value) => value.startsWith("data:image/png;base64,")) ?? null;
  const name = figmaPasteProjectName(text) ?? "Figma design";
  return {
    assets,
    backdrop: readBackdrop(roots, left, top),
    block: { height, id: prefix.replace(/-$/, ""), items, ...(Object.keys(masks).length ? { masks } : {}), name, s: 1, ...(Object.keys(tags).length ? { tags } : {}), width, x: 0, y: 0 },
    designPng: png,
    layers,
    name,
    specLayers,
  };
}

// The artboard a layer marked "Artboard" gives: the drawing is exactly that frame (its size), with the frame at the corner, so
// what is drawn fills the canvas instead of sitting small in an older, larger drawing area.
export function fitDesignToBackdrop(spec: AnimationSpec, blockId: string, backdrop: PasteBackdrop): AnimationSpec {
  const design = readFigmaDesign(spec);
  if (!design) return spec;
  const blocks = design.blocks.map((block) => (block.id === blockId ? { ...block, s: 1, x: -backdrop.x, y: -backdrop.y } : block));
  const next = withFigmaDesign(spec, { ...design, blocks, height: backdrop.height, width: backdrop.width });
  return { ...next, size: { height: backdrop.height, width: backdrop.width } };
}

// A new project made of one pasted design (with its picture as a hidden "Original picture" layer).
export function buildProjectFromFigmaPaste(text: string): ProjectFile {
  const parsed = parseFigmaPaste(text);
  const { block } = parsed;
  const assets = { ...parsed.assets };
  const layers = [...parsed.layers];
  const specLayers = [...parsed.specLayers];
  if (parsed.designPng) {
    assets.designPng = parsed.designPng;
    const id = `${block.id}-original`;
    block.items.unshift({ alpha: 1, blend: "source-over", clips: [], effects: [], ellipse: false, fills: [], h: block.height, id, kind: "png", png: "designPng", radius: 0, rot: 0, strokes: [], sw: 0, w: block.width, x: 0, y: 0 });
    specLayers.push({ id, name: "Original picture" });
    layers.unshift({ id, kind: "layer", name: "Original picture", visible: false });
  }
  const stamp = Date.now().toString(36);
  const design: FigmaDesign = { blocks: [block], height: block.height, width: block.width };
  const base: AnimationSpec = {
    assets,
    code: DESIGN_CODE,
    controls: [],
    design,
    fonts: [],
    id: `figma-design-${stamp}`,
    imageAssets: [],
    layers: specLayers,
    name: parsed.name,
    size: { height: block.height, width: block.width },
    version: 1,
  };
  // A marked artboard sets the drawing's own size too, so the canvas and the drawing always agree.
  const spec = parsed.backdrop ? fitDesignToBackdrop(base, block.id, parsed.backdrop) : base;
  return {
    animation: spec,
    canvas: { mode: "finite", size: parsed.backdrop ? { height: parsed.backdrop.height, width: parsed.backdrop.width } : { height: block.height, width: block.width } },
    durationSeconds: 5,
    id: null,
    layers,
    name: parsed.name,
    params: {},
    values: parsed.backdrop ? backdropValues(parsed.backdrop) : {},
  };
}

// The design a project holds: its `design` field, or (for a design pasted before blocks existed) the data its
// script was made with. Null when the project has no pasted design.
const designCache = new WeakMap<AnimationSpec, FigmaDesign | null>();

export function readFigmaDesign(spec: AnimationSpec): FigmaDesign | null {
  if (designCache.has(spec)) return designCache.get(spec) ?? null;
  const design = parseDesign(spec);
  designCache.set(spec, design);
  return design;
}

function parseDesign(spec: AnimationSpec): FigmaDesign | null {
  const stored = spec.design;
  if (isRecord(stored) && Array.isArray(stored.blocks)) return stored as unknown as FigmaDesign;
  if (typeof spec.code !== "string") return null;
  const start = spec.code.indexOf("const DATA = ");
  const end = spec.code.indexOf(";\nconst images = new Map();");
  if (!spec.id.startsWith("figma-design-") || start < 0 || end < start) return null;
  try {
    const data = JSON.parse(spec.code.slice(start + "const DATA = ".length, end)) as { height: number; items: FigmaItem[]; width: number };
    // The design's picture was always drawn from the "designPng" asset.
    const items = data.items.map((item) => (item.kind === "png" && !item.png ? { ...item, png: "designPng" } : item));
    return { blocks: [{ height: data.height, id: "fg", items, name: spec.name, s: 1, width: data.width, x: 0, y: 0 }], height: data.height, width: data.width };
  } catch {
    return null;
  }
}

// The animation with this design, drawn by the design script (a pasted design) or over the project's own script.
export function withFigmaDesign(spec: AnimationSpec, design: FigmaDesign): AnimationSpec {
  const isDesignOnly = spec.code.startsWith(DESIGN_MARK) || (spec.id.startsWith("figma-design-") && spec.code.includes("const DATA = "));
  const code = isDesignOnly ? DESIGN_CODE : spec.code.startsWith(COMPOSITE_MARK) ? spec.code : compositeCode(spec.code);
  return { ...spec, code, design: design as unknown as Readonly<Record<string, unknown>>, version: spec.version + 1 };
}

export function findFigmaItem(spec: AnimationSpec, id: string): FigmaItem | null {
  const design = readFigmaDesign(spec);
  for (const block of design?.blocks ?? []) {
    const found = block.items.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

// The layers that are frames (Figma frames, auto layouts, components): a group in the Layers panel whose own fill is drawn under what it holds.
export function frameIds(spec: AnimationSpec | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!spec) return ids;
  for (const block of readFigmaDesign(spec)?.blocks ?? []) for (const item of block.items) if (item.frame) ids.add(item.id);
  return ids;
}

// What a frame has when nothing was set in the app: whether it cut what it holds, and its corner radii (top left, top right, bottom right,
// bottom left). Null for a layer that is not a frame.
export function frameDefaultStyle(spec: AnimationSpec | null | undefined, id: string): Readonly<{ clip: boolean; radius: [number, number, number, number] }> | null {
  const item = spec ? findFigmaItem(spec, id) : null;
  if (!item?.frame) return null;
  const list = Array.isArray(item.radius) ? item.radius : [item.radius, item.radius, item.radius, item.radius];
  const at = (index: number): number => (typeof list[index] === "number" && Number.isFinite(list[index]) ? (list[index] as number) : 0);
  return { clip: item.frame.clip, radius: [at(0), at(1), at(2), at(3)] };
}

// A prefix no layer of the project uses yet, for the layers of a new paste.
export function nextBlockPrefix(spec: AnimationSpec | null): string {
  const taken = new Set(spec?.layers.map((layer) => layer.id) ?? []);
  for (let n = 2; ; n += 1) {
    const prefix = `fg${n}-`;
    if (![...taken].some((id) => id.startsWith(prefix))) return prefix;
  }
}

export type BlockPlace = Readonly<{ s: number; x: number; y: number }>;

// Where a pasted block goes in a design of the given size: at its own size, never scaled, and centered. A design bigger than the artboard is the
// same size as in Figma and runs past the edges equally on both sides. With a box (Paste to replace), it fills that box keeping its shape.
export function placeBlock(block: Pick<FigmaBlock, "height" | "width">, design: Readonly<{ height: number; width: number }>, box?: Box | null): BlockPlace {
  if (box && box.w > 0 && box.h > 0) {
    const s = Math.min(box.w / block.width, box.h / block.height);
    return { s, x: box.x + (box.w - block.width * s) / 2, y: box.y + (box.h - block.height * s) / 2 };
  }
  return { s: 1, x: (design.width - block.width) / 2, y: (design.height - block.height) / 2 };
}

// The drawing area (and so the artboard) taking a new width and height. What is drawn stays centered: every design moves by half of the change,
// so a design in the middle of the artboard is still in the middle after the artboard changes shape.
export function withDesignArea(spec: AnimationSpec, size: Readonly<{ height: number; width: number }>): AnimationSpec {
  const design = readFigmaDesign(spec);
  if (!design) return { ...spec, size: { height: size.height, width: size.width }, version: spec.version + 1 };
  const dx = (size.width - design.width) / 2;
  const dy = (size.height - design.height) / 2;
  const blocks = design.blocks.map((block) => ({ ...block, x: block.x + dx, y: block.y + dy }));
  const next = withFigmaDesign(spec, { ...design, blocks, height: size.height, width: size.width });
  return { ...next, size: { height: size.height, width: size.width }, version: next.version + 1 };
}

// The open project's animation with a pasted design added on top, where `place` says.
export function addPastedBlock(
  spec: AnimationSpec,
  parsed: ParsedPaste,
  size: Readonly<{ height: number; width: number }>,
  place: BlockPlace,
): AnimationSpec {
  const current = readFigmaDesign(spec) ?? { blocks: [], height: size.height, width: size.width };
  const block: FigmaBlock = { ...parsed.block, s: place.s, x: place.x, y: place.y };
  const design: FigmaDesign = { ...current, blocks: [...current.blocks, block] };
  const next = withFigmaDesign(spec, design);
  return {
    ...next,
    assets: { ...spec.assets, ...parsed.assets },
    layers: [...parsed.specLayers, ...spec.layers],
  };
}

// The animation without the pasted design's layers `ids` (their pictures go too).
export function removeFigmaItems(spec: AnimationSpec, ids: ReadonlySet<string>): AnimationSpec {
  const design = readFigmaDesign(spec);
  if (!design) return spec;
  const gone = design.blocks.flatMap((block) => block.items.filter((item) => ids.has(item.id)));
  if (gone.length === 0) return spec;
  const unused = new Set(
    gone.flatMap((item) => [
      item.fillAsset,
      item.text?.img,
      ...(item.pic ? pictureFiles(item.pic).flatMap((key) => [key, `${key}.media`]) : []),
    ].filter((key): key is string => typeof key === "string")),
  );
  const blocks = design.blocks.map((block) => ({ ...block, items: block.items.filter((item) => !ids.has(item.id)) })).filter((block) => block.items.length > 0);
  const next = withFigmaDesign(spec, { ...design, blocks });
  return {
    ...next,
    assets: Object.fromEntries(Object.entries(spec.assets).filter(([key]) => !unused.has(key))),
    layers: spec.layers.filter((layer) => !ids.has(layer.id)),
  };
}

// What a pasted design keeps only to look right while nothing else is there: Figma's picture of the whole design (the hidden
// "Original picture" layer), the pictures of texts whose fonts are installed or carried (they show only while a font is
// missing), and pictures nothing uses any more. Clearing them makes the project lighter; the design itself stays.
export type CacheSweep = Readonly<{ bytes: number; count: number; layerIds: string[]; spec: AnimationSpec }>;

export function clearDesignCaches(spec: AnimationSpec): CacheSweep {
  const design = readFigmaDesign(spec);
  if (!design) return { bytes: 0, count: 0, layerIds: [], spec };
  const drop = new Set<string>();
  const layerIds: string[] = [];
  const blocks = design.blocks.map((block) => {
    const items: FigmaItem[] = [];
    for (const item of block.items) {
      if (item.kind === "png" && item.png === "designPng" && item.id === `${block.id}-original`) {
        drop.add("designPng");
        layerIds.push(item.id);
        continue;
      }
      if (item.kind === "text" && item.text?.img && !(item.text.missing && item.text.missing.length > 0)) {
        drop.add(item.text.img);
        const { ia: _a, ib: _b, img: _i, ...text } = item.text;
        items.push({ ...item, text });
        continue;
      }
      items.push(item);
    }
    return { ...block, items };
  });
  // Pictures the import made (text-, vec-, fill-, pic-) that no layer shows.
  const used = new Set<string>();
  for (const block of blocks) {
    for (const item of block.items) {
      for (const key of [item.png, item.fillAsset, item.text?.img]) if (key) used.add(key);
      if (item.pic) for (const key of pictureFiles(item.pic)) used.add(key);
    }
  }
  for (const [key, media] of Object.entries(spec.assetMedia ?? {})) {
    used.add(key);
    if (media && typeof media.asset === "string") used.add(media.asset);
  }
  for (const font of spec.fonts ?? []) if (font.asset) used.add(font.asset);
  for (const key of Object.keys(spec.assets)) {
    if (/^(text|vec|fill|pic)-/.test(key) && !used.has(key)) drop.add(key);
  }
  const gone = [...drop].filter((key) => key in spec.assets);
  const bytes = gone.reduce((sum, key) => sum + (spec.assets[key]?.length ?? 0), 0);
  if (gone.length === 0 && layerIds.length === 0 && JSON.stringify(blocks) === JSON.stringify(design.blocks)) return { bytes: 0, count: 0, layerIds: [], spec };
  const next = withFigmaDesign(spec, { ...design, blocks });
  return {
    bytes,
    count: gone.length + layerIds.length,
    layerIds,
    spec: {
      ...next,
      assets: Object.fromEntries(Object.entries(spec.assets).filter(([key]) => !drop.has(key))),
      layers: spec.layers.filter((layer) => !layerIds.includes(layer.id)),
    },
  };
}

// The animation with one pasted layer changed.
export function updateFigmaItem(spec: AnimationSpec, id: string, change: (item: FigmaItem) => FigmaItem): AnimationSpec {
  const design = readFigmaDesign(spec);
  if (!design) return spec;
  return withFigmaDesign(spec, {
    ...design,
    blocks: design.blocks.map((block) => ({ ...block, items: block.items.map((item) => (item.id === id ? change(item) : item)) })),
  });
}

// The fonts a text uses (a design pasted before fonts were listed has only its one font).
export function textFonts(text: FigmaText): FigmaFont[] {
  return Array.isArray(text.fonts) && text.fonts.length > 0 ? text.fonts : [{ family: text.family || "Inter", style: text.style || "Regular", weight: text.weight || 400 }];
}

// The pasted design as it is saved: layers deleted from the Layers panel leave no data behind (their shapes, texts
// and pictures go, and a paste whose layers are all gone goes too), and a picture shown from its own file keeps no
// copy of Figma's rendered fill. Only designs in the block format are cleaned (older pastes keep their own code).
export function pruneFigmaDesign(spec: AnimationSpec, panelLayers: readonly Readonly<{ id: string }>[]): AnimationSpec {
  const stored = spec.design;
  if (!isRecord(stored) || !Array.isArray(stored.blocks)) return spec;
  const design = stored as unknown as FigmaDesign;
  const keep = new Set(panelLayers.map((layer) => layer.id));
  const designIds = new Set(design.blocks.flatMap((block) => block.items.map((item) => item.id)));
  const blocks = design.blocks
    .map((block) => ({
      ...block,
      items: block.items
        .filter((item) => keep.has(item.id))
        .map((item): FigmaItem => {
          if (!item.pic?.only || !item.fillAsset) return item;
          const { fillAsset: _rendered, ...rest } = item;
          return rest;
        }),
    }))
    .filter((block) => block.items.length > 0);
  const used = new Set<string>();
  for (const block of blocks) {
    for (const item of block.items) {
      for (const key of [item.fillAsset, item.png, item.text?.img, ...(item.pic ? pictureFiles(item.pic) : [])]) {
        if (typeof key === "string") used.add(key);
      }
    }
  }
  // Pictures that belong to pasted layers (by their key) and are no longer used go; others are the project's own.
  const pasted = (key: string): boolean => /^(fill|pic|text|vec)-/.test(key) || key === "designPng";
  const base = (key: string): string => key.replace(/\.media$/, "");
  const assets = Object.fromEntries(Object.entries(spec.assets).filter(([key]) => !pasted(base(key)) || used.has(base(key))));
  const assetMedia = spec.assetMedia
    ? Object.fromEntries(Object.entries(spec.assetMedia).filter(([key]) => !pasted(key) || used.has(key)))
    : undefined;
  return {
    ...spec,
    ...(assetMedia ? { assetMedia } : {}),
    assets,
    design: { ...design, blocks } as unknown as Readonly<Record<string, unknown>>,
    layers: spec.layers.filter((layer) => !designIds.has(layer.id) || keep.has(layer.id)),
  };
}

// Every font the design's texts use.
export function designFonts(spec: AnimationSpec): FigmaFont[] {
  const found = new Map<string, FigmaFont>();
  for (const block of readFigmaDesign(spec)?.blocks ?? []) {
    for (const item of block.items) for (const font of item.text ? textFonts(item.text) : []) found.set(fontKey(font), font);
  }
  return [...found.values()];
}

// The design with each text's missing fonts worked out again: a font is there when the design carries it or this
// computer has its family. A text missing any font shows as its picture and cannot be edited.
export function withMissingFonts(spec: AnimationSpec, hasFamily: (family: string) => boolean): AnimationSpec {
  const design = readFigmaDesign(spec);
  if (!design) return spec;
  const carries = (font: FigmaFont): boolean =>
    spec.fonts.some(
      (own) => own.family.toLowerCase() === font.family.toLowerCase() && Number(own.weight) === font.weight && (own.style === "italic") === isItalicStyle(font.style),
    );
  let changed = false;
  const blocks = design.blocks.map((block) => ({
    ...block,
    items: block.items.map((item) => {
      if (!item.text) return item;
      const missing = textFonts(item.text).filter((font) => !carries(font) && !hasFamily(font.family)).map(fontKey);
      const before = item.text.missing ?? [];
      if (missing.length === before.length && missing.every((key, index) => key === before[index])) return item;
      changed = true;
      const { missing: _old, ...rest } = item.text;
      return { ...item, text: missing.length > 0 ? { ...rest, missing } : rest };
    }),
  }));
  return changed ? withFigmaDesign(spec, { ...design, blocks }) : spec;
}

// The middle of a layer's box (w x h) placed by matrix m.
function boxCenter(m: Mat, w: number, h: number): [number, number] {
  return [m[0] * (w / 2) + m[2] * (h / 2) + m[4], m[1] * (w / 2) + m[3] * (h / 2) + m[5]];
}

// A PNG's pixel size, read from its header (the plugin exports at 2x).
function pngSize(dataUrl: string): { height: number; width: number } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png") || comma < 0) return null;
  try {
    const head = atob(dataUrl.slice(comma + 1, comma + 1 + 44));
    const read = (at: number): number => ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0;
    const width = read(16);
    const height = read(20);
    return width > 0 && height > 0 ? { height, width } : null;
  } catch {
    return null;
  }
}

function lineHeightPx(value: unknown, fontSize: number): number {
  if (isRecord(value)) {
    const amount = num(value.value);
    if (value.unit === "PIXELS" && amount > 0) return amount;
    if (value.unit === "PERCENT" && amount > 0) return (fontSize * amount) / 100;
  }
  return fontSize * 1.25;
}

function letterSpacingPx(value: unknown, fontSize: number): number {
  if (isRecord(value)) {
    const amount = num(value.value);
    if (value.unit === "PIXELS") return amount;
    if (value.unit === "PERCENT") return (fontSize * amount) / 100;
  }
  return 0;
}


// The layers each blurred layer covers, for a layer blur on a group (a frame, or a plain group's "background" layer that carries the
// group's effects): the blur is applied to everything inside the group, as in Figma. Frames pasted by the current plugin carry their
// own list; this covers frames and groups pasted before.
type NamedLayer = Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string }>;
export function blurMembers(spec: AnimationSpec, layers: readonly NamedLayer[]): Record<string, string[]> {
  const design = readFigmaDesign(spec);
  if (!design) return {};
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const nameOf = (layer: NamedLayer): string => String(layer.displayName ?? layer.name ?? "").trim().toLowerCase();
  const inside = (groupId: string): string[] => {
    const found: string[] = [];
    const walk = (parent: string): void => {
      for (const layer of layers) {
        if (layer.parentGroupId !== parent) continue;
        found.push(layer.id);
        if (layer.kind === "group") walk(layer.id);
      }
    };
    walk(groupId);
    return found;
  };
  const out: Record<string, string[]> = {};
  for (const block of design.blocks) {
    for (const item of block.items) {
      if (item.frame?.members) continue;
      if (!item.effects.some((effect) => isRecord(effect) && effect.type === "LAYER_BLUR")) continue;
      const own = byId.get(item.id);
      if (!own) continue;
      if (item.frame) {
        const members = inside(item.id);
        if (members.length > 0) out[item.id] = members;
      } else if (own.parentGroupId) {
        const group = byId.get(own.parentGroupId);
        if (group && nameOf(own) === `${nameOf(group)} background`) {
          const members = inside(group.id).filter((id) => id !== item.id);
          if (members.length > 0) out[item.id] = members;
        }
      }
    }
  }
  return out;
}
