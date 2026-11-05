import { LAYER_STYLE_KEY, type AnimationSpec, type LayerStyle } from "./animation-spec";
import { currentDesignCode } from "../mo/figma-paste-import";
import { loadLottiePlayerSource, LOTTIE_SCRIPT } from "../lottie/lottie-runtime";
import { dataUrlToBlob, openMediaClip, type MediaClip } from "../media/media-clip";
import { clipTime, planBlend, readVideoSettings, type MediaLayer, type VideoSegment } from "../media/media-layer";
import { LatestFrameScheduler, type LatestFrameSample, type LatestFrameStats } from "./latest-frame-scheduler";

// The box around everything the design draws, in design units.
export type DesignBounds = Readonly<{ height: number; width: number; x: number; y: number }>;

// Everything the drawing script receives for one picture.
export type SandboxFrame = Readonly<{
  durationSeconds: number;
  // Scene size in design units.
  height: number;
  layerStack: readonly string[];
  // The time and length videos and GIFs play by: the whole timeline's, while timeSeconds and durationSeconds are the scene's own.
  mediaDurationSeconds?: number;
  mediaTimeSeconds?: number;
  params: Readonly<Record<string, unknown>>;
  pixelHeight: number;
  pixelScale: number;
  pixelWidth: number;
  // Drawn texts to replace: the text the script draws -> the text to draw instead.
  texts?: Readonly<Record<string, string>>;
  // A layer whose position is reported with the picture: the box around what it draws, in design units.
  trackLayer?: string;
  timeSeconds: number;
  width: number;
}>;

// One segment of an animation's own plan: the seconds it starts and ends, and how much of it is the final hold.
// `items` says what moves and where it is in the design.
export type SandboxSegmentItem = Readonly<{ item: string; where: string }>;
// `slides`: the layers that slide in during the part (its own times), each with the step it belongs to (layers of a step slide in together).
export type SandboxSlide = Readonly<{ end: number; id: string; start: number; step: number }>;
export type SandboxSegment = Readonly<{ end: number; hold: number; id: string; items?: readonly SandboxSegmentItem[]; name: string; slides?: readonly SandboxSlide[]; start: number }>;

export type SandboxMemoryStats = Readonly<{
  budgetBytes?: number;
  bytes?: number;
  effectBytes?: number;
  effectEvictions?: number;
  evictions?: number;
  peakBytes?: number;
  totalBytes?: number;
}>;

// The page the script runs in. It has no network, no storage and no access to the app: it
// is a sandboxed frame with its own empty origin and a content policy that allows only
// inline script and data: images and fonts.
const RUNTIME = `
let animation = null;
// Keep a small set of frame surfaces across renders. Concurrent export/preview
// requests lease different surfaces, so an awaited script never shares a canvas.
const frameSurfaces = [];
const MAX_IDLE_SURFACES = 2;
const MAX_IDLE_BYTES = 96 * 1024 * 1024;
function acquireSurface(width, height, readFrequently = false) {
  const index = frameSurfaces.findIndex((item) => item.width === width && item.height === height && item.readFrequently === readFrequently);
  const item = index < 0
    ? { canvas: new OffscreenCanvas(width, height), height, readFrequently, width }
    : frameSurfaces.splice(index, 1)[0];
  const context = item.canvas.getContext("2d", { willReadFrequently: readFrequently });
  if (typeof context.reset === "function") context.reset();
  else item.canvas.width = width;
  return { ...item, context };
}
function releaseSurface(surface) {
  const bytes = surface.width * surface.height * 4;
  const idleBytes = frameSurfaces.reduce((total, item) => total + item.width * item.height * 4, 0);
  if (frameSurfaces.length < MAX_IDLE_SURFACES && idleBytes + bytes <= MAX_IDLE_BYTES) frameSurfaces.push(surface);
  else { surface.canvas.width = 0; surface.canvas.height = 0; }
}
// Video and GIF layers come with the frame as pictures (frame.media, in stack order of their ids). The
// design's other layers are drawn in groups between them, each group on its own surface, so a script that
// clears its canvas never erases a video under it.
// Layer pictures played by a video or GIF: the script loads the clip's first frame as an ordinary image; images
// given that picture are tagged, and while a frame is drawn every drawImage / createPattern of a tagged image
// uses the clip's current picture instead (frame.assetFrames).
const posters = new Map();
let assetFrames = null;
function posterKey(url) {
  const list = posters.get(url.length);
  const found = list && list.find((item) => item.url === url);
  return found ? found.key : undefined;
}
(function hookImages() {
  const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    enumerable: source.enumerable,
    get() { return source.get.call(this); },
    set(value) {
      const key = typeof value === "string" ? posterKey(value) : undefined;
      if (key) this.__moMedia = key; else delete this.__moMedia;
      source.set.call(this, value);
    },
  });
  const pick = (image) => (image && image.__moMedia && assetFrames && assetFrames.get(image.__moMedia)) || image;
  for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
    const draw = proto.drawImage;
    proto.drawImage = function (image, ...rest) { return draw.call(this, pick(image), ...rest); };
    const pattern = proto.createPattern;
    proto.createPattern = function (image, repeat) { return pattern.call(this, pick(image), repeat); };
  }
  const makeBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async function (image, ...rest) {
    const bitmap = await makeBitmap.call(this, image, ...rest);
    if (image && image.__moMedia) bitmap.__moMedia = image.__moMedia;
    return bitmap;
  };
})();
function placeMedia(context, frame, item) {
  const scale = frame.pixelScale;
  const boxW = frame.width * scale;
  const boxH = frame.height * scale;
  const ratio = item.fit === "contain" ? Math.min(boxW / item.bitmap.width, boxH / item.bitmap.height) : Math.max(boxW / item.bitmap.width, boxH / item.bitmap.height);
  const w = item.bitmap.width * ratio;
  const h = item.bitmap.height * ratio;
  context.save();
  context.globalAlpha = item.opacity;
  context.globalCompositeOperation = item.blend;
  context.beginPath();
  context.rect(0, 0, boxW, boxH);
  context.clip();
  context.drawImage(item.bitmap, (boxW - w) / 2, (boxH - h) / 2, w, h);
  context.restore();
}
async function drawFrame(context, frame) {
  const frames = frame.assetFrames;
  if (!frames || frames.length === 0) return drawLayers(context, frame);
  assetFrames = new Map(frames.map((item) => [item.key, item.bitmap]));
  try {
    await drawLayers(context, frame);
  } finally {
    assetFrames = null;
    for (const item of frames) item.bitmap.close();
  }
}
// ---- Perspective: a layer (or a group) drawn warped to four moved corners ----
let alphaProbe = null;
// The box around what a surface draws, in its pixels (found on a small copy; null when it is empty).
function alphaBounds(canvas, source) {
  const scale = Math.min(1, 192 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  if (!alphaProbe || alphaProbe.canvas.width !== w || alphaProbe.canvas.height !== h) {
    const probe = new OffscreenCanvas(w, h);
    alphaProbe = { canvas: probe, context: probe.getContext("2d", { willReadFrequently: true }) };
  }
  const ctx = alphaProbe.context;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > 6) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const sx = canvas.width / w;
  const sy = canvas.height / h;
  const left = Math.max(0, Math.floor((x0 - 1) * sx));
  const top = Math.max(0, Math.floor((y0 - 1) * sy));
  const right = Math.min(canvas.width, Math.ceil((x1 + 2) * sx));
  const bottom = Math.min(canvas.height, Math.ceil((y1 + 2) * sy));
  const coarse = { h: bottom - top, w: right - left, x: left, y: top };
  return source ? exactBounds(source, coarse, Math.ceil(Math.max(sx, sy)) + 3) : coarse;
}
// The coarse box made exact: each side is moved to the first pixel that draws, found on a thin strip of the full-size picture, so the
// box (and what is cut to it) is where the content really ends and does not shift by a few pixels from one picture to the next.
function exactBounds(ctx, coarse, band) {
  const hit = (x, y, w, h, axis, last) => {
    if (w <= 0 || h <= 0) return -1;
    const data = ctx.getImageData(x, y, w, h).data;
    let found = -1;
    if (axis === "y") {
      for (let row = 0; row < h; row += 1) {
        const r = last ? h - 1 - row : row;
        for (let col = 0; col < w; col += 1) if (data[(r * w + col) * 4 + 3] > 6) return r;
      }
    } else {
      for (let col = 0; col < w; col += 1) {
        const c = last ? w - 1 - col : col;
        for (let row = 0; row < h; row += 1) if (data[(row * w + c) * 4 + 3] > 6) return c;
      }
    }
    return found;
  };
  const b = Math.min(band, Math.floor(coarse.h / 2), Math.floor(coarse.w / 2));
  const top = hit(coarse.x, coarse.y, coarse.w, b, "y", false);
  const bottom = hit(coarse.x, coarse.y + coarse.h - b, coarse.w, b, "y", true);
  const left = hit(coarse.x, coarse.y, b, coarse.h, "x", false);
  const right = hit(coarse.x + coarse.w - b, coarse.y, b, coarse.h, "x", true);
  const x0 = left < 0 ? coarse.x : coarse.x + left;
  const y0 = top < 0 ? coarse.y : coarse.y + top;
  const x1 = right < 0 ? coarse.x + coarse.w : coarse.x + coarse.w - b + right + 1;
  const y1 = bottom < 0 ? coarse.y + coarse.h : coarse.y + coarse.h - b + bottom + 1;
  return { h: Math.max(1, y1 - y0), w: Math.max(1, x1 - x0), x: x0, y: y0 };
}
// The map from the unit square to the quad tl, tr, br, bl (a projective one, so the far side looks smaller).
function quadMap(q) {
  const dx1 = q[1].x - q[2].x, dx2 = q[3].x - q[2].x, dx3 = q[0].x - q[1].x + q[2].x - q[3].x;
  const dy1 = q[1].y - q[2].y, dy2 = q[3].y - q[2].y, dy3 = q[0].y - q[1].y + q[2].y - q[3].y;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = q[1].x - q[0].x + g * q[1].x, b = q[3].x - q[0].x + h * q[3].x, c = q[0].x;
  const d = q[1].y - q[0].y + g * q[1].y, e = q[3].y - q[0].y + h * q[3].y, f = q[0].y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}
function drawTriangle(ctx, image, s0, s1, s2, d0, d1, d2) {
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  // The triangle's clip is grown a little so no hairline shows between neighbours.
  const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p) => { const l = Math.hypot(p.x - cx, p.y - cy) || 1; return { x: p.x + ((p.x - cx) / l) * 0.7, y: p.y + ((p.y - cy) / l) * 0.7 }; };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y);
  ctx.lineTo(g1.x, g1.y);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}
const WARP_CELLS = 14;
function warpQuad(ctx, image, box, quad) {
  const map = quadMap(quad);
  const point = (i, j) => map(i / WARP_CELLS, j / WARP_CELLS);
  const src = (i, j) => ({ x: box.x + (i / WARP_CELLS) * box.w, y: box.y + (j / WARP_CELLS) * box.h });
  for (let j = 0; j < WARP_CELLS; j += 1) {
    for (let i = 0; i < WARP_CELLS; i += 1) {
      const s00 = src(i, j), s10 = src(i + 1, j), s01 = src(i, j + 1), s11 = src(i + 1, j + 1);
      const d00 = point(i, j), d10 = point(i + 1, j), d01 = point(i, j + 1), d11 = point(i + 1, j + 1);
      drawTriangle(ctx, image, s00, s10, s01, d00, d10, d01);
      drawTriangle(ctx, image, s10, s11, s01, d10, d11, d01);
    }
  }
}
// A rounded box path; radii are top left, top right, bottom right, bottom left.
function roundedBox(ctx, box, radii) {
  const limit = Math.min(box.w, box.h) / 2;
  const r = radii.map((value) => Math.max(0, Math.min(limit, value || 0)));
  const x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  ctx.beginPath();
  ctx.moveTo(x0 + r[0], y0);
  ctx.lineTo(x1 - r[1], y0);
  ctx.arcTo(x1, y0, x1, y0 + r[1], r[1]);
  ctx.lineTo(x1, y1 - r[2]);
  ctx.arcTo(x1, y1, x1 - r[2], y1, r[2]);
  ctx.lineTo(x0 + r[3], y1);
  ctx.arcTo(x0, y1, x0, y1 - r[3], r[3]);
  ctx.lineTo(x0, y0 + r[0]);
  ctx.arcTo(x0, y0, x0 + r[0], y0, r[0]);
  ctx.closePath();
}
// Draws layers in order; a group inside another (its layers a part of the outer one's) is drawn on its own, with its own
// clip, so every clipping group in a nest cuts what it holds.
async function drawNested(context, frame, ids, entries) {
  const owner = new Map();
  for (const entry of entries) for (const id of entry.ids) {
    const held = owner.get(id);
    if (!held || entry.ids.length > held.ids.length) owner.set(id, entry);
  }
  const done = new Set();
  let run = [];
  const flush = async () => {
    if (run.length === 0) return;
    await animation.render(context, { ...frame, layerStack: run, media: undefined });
    run = [];
  };
  for (const id of ids) {
    const entry = owner.get(id);
    if (!entry) {
      run.push(id);
      continue;
    }
    if (done.has(entry)) continue;
    done.add(entry);
    await flush();
    await drawWarped(context, frame, entry, entries);
  }
  await flush();
}
async function drawWarped(context, frame, entry, all) {
  const ids = frame.layerStack.filter((id) => entry.ids.indexOf(id) >= 0);
  if (ids.length === 0) return;
  const surface = acquireSurface(frame.pixelWidth, frame.pixelHeight);
  let clipped = null;
  try {
    const inner = (all || []).filter((other) => other !== entry && other.ids.length < entry.ids.length && other.ids.every((id) => entry.ids.indexOf(id) >= 0));
    if (inner.length > 0) await drawNested(surface.context, frame, ids, inner);
    else await animation.render(surface.context, { ...frame, layerStack: ids, media: undefined });
    let box = alphaBounds(surface.canvas, surface.context);
    if (!box) return;
    // A group that clips to its own frame (the box of its background layer, as in Figma): that frame is its box, so what hangs
    // over it is cut away and aligning, scaling and turning work on the frame.
    const given = entry.box || (entry.clip && entry.clip.box);
    if (given) {
      const kb = frame.pixelWidth / Math.max(1, frame.width);
      box = { h: given.h * kb, w: given.w * kb, x: given.x * kb, y: given.y * kb };
    }
    let source = surface.canvas;
    // A group that clips: what it holds is cut to a rounded box around what it draws.
    if (entry.clip) {
      const k = frame.pixelWidth / Math.max(1, frame.width);
      clipped = acquireSurface(frame.pixelWidth, frame.pixelHeight);
      const c = clipped.context;
      c.save();
      roundedBox(c, box, entry.clip.radius.map((value) => value * k));
      c.clip();
      c.drawImage(surface.canvas, 0, 0);
      c.restore();
      source = clipped.canvas;
    }
    // Scaled from the box's top-left corner, then aligned to an edge or the centre of the design (the scaled box is what is aligned).
    const sx = entry.size ? entry.size.sx : 1;
    const sy = entry.size ? entry.size.sy : 1;
    const scaledW = box.w * sx;
    const scaledH = box.h * sy;
    let dx = 0;
    let dy = 0;
    if (entry.align) {
      if (entry.align.h === "left") dx = -box.x;
      else if (entry.align.h === "right") dx = frame.pixelWidth - (box.x + scaledW);
      else if (entry.align.h === "center") dx = (frame.pixelWidth - scaledW) / 2 - box.x;
      if (entry.align.v === "top") dy = -box.y;
      else if (entry.align.v === "bottom") dy = frame.pixelHeight - (box.y + scaledH);
      else if (entry.align.v === "middle") dy = (frame.pixelHeight - scaledH) / 2 - box.y;
    }
    // The move (design units to pixels) and the rotation about the middle of the scaled box come after the alignment.
    const k = frame.pixelWidth / Math.max(1, frame.width);
    const px = entry.size ? entry.size.x * k : 0;
    const py = entry.size ? entry.size.y * k : 0;
    const rot = entry.size ? (entry.size.rot * Math.PI) / 180 : 0;
    const moved = dx !== 0 || dy !== 0 || px !== 0 || py !== 0 || rot !== 0 || sx !== 1 || sy !== 1;
    if (moved) {
      context.save();
      context.translate(dx + px, dy + py);
      if (rot !== 0) {
        const cx = box.x + scaledW / 2;
        const cy = box.y + scaledH / 2;
        context.translate(cx, cy);
        context.rotate(rot);
        context.translate(-cx, -cy);
      }
      context.translate(box.x, box.y);
      context.scale(sx, sy);
      context.translate(-box.x, -box.y);
    }
    if (entry.points) {
      // The pins move the corners of the box by a fraction of its width and height.
      const p = entry.points;
      const quad = [
        { x: box.x + p.tl.x * box.w, y: box.y + p.tl.y * box.h },
        { x: box.x + box.w + p.tr.x * box.w, y: box.y + p.tr.y * box.h },
        { x: box.x + box.w + p.br.x * box.w, y: box.y + box.h + p.br.y * box.h },
        { x: box.x + p.bl.x * box.w, y: box.y + box.h + p.bl.y * box.h },
      ];
      warpQuad(context, source, box, quad);
    } else {
      context.drawImage(source, 0, 0);
    }
    if (moved) context.restore();
  } finally {
    if (clipped) releaseSurface(clipped);
    releaseSurface(surface);
  }
}
async function drawLayers(context, frame) {
  const media = frame.media;
  const perspectives = frame.params && Array.isArray(frame.params.__perspectives) ? frame.params.__perspectives : [];
  const hasMedia = media && media.length > 0;
  if (!hasMedia && perspectives.length === 0) return animation.render(context, frame);
  const byId = new Map((hasMedia ? media : []).map((item) => [item.id, item]));
  // The first entry that holds a layer draws it (its layers are drawn together, warped, where its first layer sits).
  const owner = new Map();
  for (const entry of perspectives) for (const id of entry.ids) {
    const held = owner.get(id);
    if (!held || entry.ids.length > held.ids.length) owner.set(id, entry);
  }
  const drawn = new Set();
  let group = [];
  const flush = async () => {
    if (group.length === 0) return;
    const surface = acquireSurface(frame.pixelWidth, frame.pixelHeight);
    try {
      await animation.render(surface.context, { ...frame, layerStack: group, media: undefined });
      context.drawImage(surface.canvas, 0, 0);
    } finally {
      releaseSurface(surface);
    }
    group = [];
  };
  try {
    for (const id of frame.layerStack) {
      const entry = owner.get(id);
      if (entry && !byId.has(id)) {
        if (!drawn.has(entry)) {
          drawn.add(entry);
          await flush();
          await drawWarped(context, frame, entry, perspectives);
        }
        continue;
      }
      const item = byId.get(id);
      if (!item) {
        group.push(id);
        continue;
      }
      await flush();
      placeMedia(context, frame, item);
    }
    await flush();
  } finally {
    if (hasMedia) for (const item of media) item.bitmap.close();
  }
}
addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || typeof message.type !== "string") return;
  try {
    if (message.type === "init") {
      const spec = message.spec;
      const api = { assets: spec.assets, design: spec.design, fonts: spec.fonts, imageAssets: spec.imageAssets, previewAssets: spec.previewAssets ?? {} };
      posters.clear();
      for (const key of Object.keys(spec.assetMedia || {})) {
        const url = spec.assets[key];
        if (typeof url !== "string") continue;
        const list = posters.get(url.length) || [];
        list.push({ key, url });
        posters.set(url.length, list);
      }
      // A Lottie Animation project: the lottie-web player arrives as source text and is started here.
      if (typeof message.lottiePlayer === "string") {
        new Function(message.lottiePlayer).call(globalThis);
        api.lottiePlayer = globalThis.lottie;
        api.lottie = spec.lottie;
      }
      animation = new Function("api", spec.code)(api);
      if (animation.init) await animation.init();
      parent.postMessage({ id: message.id, type: "ready" }, "*");
    } else if (message.type === "fonts") {
      // Which font families can draw here: a family the frame has (installed, or loaded by the design) changes the
      // width of a sample text against at least one of the generic families.
      const canvas = new OffscreenCanvas(8, 8);
      const context = canvas.getContext("2d");
      const sample = "mmmmmmmmmmlli1WQ@#&gjy";
      const available = {};
      for (const family of message.families || []) {
        available[family] = ["monospace", "serif", "sans-serif"].some((generic) => {
          context.font = "72px " + generic;
          const plain = context.measureText(sample).width;
          context.font = '72px "' + String(family).replace(/"/g, "") + '", ' + generic;
          return Math.abs(context.measureText(sample).width - plain) > 0.01;
        });
      }
      parent.postMessage({ available, id: message.id, type: "fonts" }, "*");
    } else if (message.type === "stats") {
      const stats = animation && typeof animation.getMemoryStats === "function" ? animation.getMemoryStats() : null;
      parent.postMessage({ id: message.id, stats, type: "stats" }, "*");
    } else if (message.type === "segments") {
      // An animation made of segments may report when each one starts and ends for the given settings.
      const segments = animation && typeof animation.getSegments === "function" ? animation.getSegments(message.params || {}) : null;
      parent.postMessage({ id: message.id, segments, type: "segments" }, "*");
    } else if (message.type === "dispose") {
      if (animation && typeof animation.dispose === "function") animation.dispose();
      animation = null;
    } else if (message.type === "probe") {
      // Draws the given layers at several times and reports every text they draw.
      const found = new Set();
      for (const time of message.times) {
        const canvas = new OffscreenCanvas(message.frame.pixelWidth, message.frame.pixelHeight);
        const context = canvas.getContext("2d");
        for (const name of ["fillText", "strokeText"]) {
          const original = context[name].bind(context);
          context[name] = (text, ...rest) => {
            if (typeof text === "string") found.add(text);
            return original(text, ...rest);
          };
        }
        await animation.render(context, { ...message.frame, timeSeconds: time });
      }
      parent.postMessage({ id: message.id, texts: [...found], type: "probe" }, "*");
    } else if (message.type === "bounds") {
      // Draws the whole picture once and reports the box around everything that is visible.
      const { pixelWidth, pixelHeight, pixelScale } = message.frame;
      const canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      await drawFrame(context, message.frame);
      const { data } = context.getImageData(0, 0, pixelWidth, pixelHeight);
      let minX = pixelWidth, minY = pixelHeight, maxX = -1, maxY = -1;
      for (let y = 0; y < pixelHeight; y += 1) {
        for (let x = 0; x < pixelWidth; x += 1) {
          if (data[(y * pixelWidth + x) * 4 + 3] > 64) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const bounds = maxX < 0 ? null : { height: (maxY - minY + 1) / pixelScale, width: (maxX - minX + 1) / pixelScale, x: minX / pixelScale, y: minY / pixelScale };
      parent.postMessage({ bounds, id: message.id, type: "bounds" }, "*");
    } else if (message.type === "render") {
      const frame = message.frame;
      const surface = acquireSurface(frame.pixelWidth, frame.pixelHeight);
      const { canvas, context } = surface;
      const texts = frame.texts;
      const originals = [];
      try {
        if (texts && Object.keys(texts).length > 0) {
          for (const name of ["fillText", "strokeText", "measureText"]) {
            const original = context[name];
            originals.push([name, original]);
            context[name] = (text, ...rest) => original.call(context, typeof text === "string" && Object.hasOwn(texts, text) ? texts[text] : text, ...rest);
          }
        }
        await drawFrame(context, frame);
        let tracked = null;
        if (frame.trackLayer) {
          const k = 0.25;
          const w = Math.max(1, Math.ceil(frame.pixelWidth * k));
          const h = Math.max(1, Math.ceil(frame.pixelHeight * k));
          const trackedSurface = acquireSurface(w, h, true);
          const sc = trackedSurface.context;
          try {
            await animation.render(sc, { ...frame, layerStack: [frame.trackLayer], media: undefined, pixelHeight: h, pixelScale: frame.pixelScale * k, pixelWidth: w });
            const { data } = sc.getImageData(0, 0, w, h);
            let minX = w, minY = h, maxX = -1, maxY = -1;
            for (let y = 0; y < h; y += 1) {
              for (let x = 0; x < w; x += 1) {
                if (data[(y * w + x) * 4 + 3] > 40) {
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                }
              }
            }
            const unit = frame.pixelScale * k;
            if (maxX >= 0) tracked = { height: (maxY - minY + 1) / unit, width: (maxX - minX + 1) / unit, x: minX / unit, y: minY / unit };
          } finally {
            releaseSurface(trackedSurface);
          }
        }
        const bitmap = canvas.transferToImageBitmap();
        parent.postMessage({ bitmap, id: message.id, tracked, type: "frame" }, "*", [bitmap]);
      } finally {
        for (const [name, original] of originals) context[name] = original;
        releaseSurface(surface);
      }
    }
  } catch (error) {
    parent.postMessage({ id: message.id, message: String((error && error.message) || error), type: "error" }, "*");
  }
});
`;

// The live preview needs a video picture no bigger than it is drawn: a video layer covers or fits the frame, a picture that plays is
// never larger than the frame. A render (not a preview) always gets the full picture.
function previewWidth(frame: SandboxFrame, layer: Readonly<{ fit?: string; height: number; width: number }> | undefined): number | undefined {
  if (!layer || frame.params.__preview !== true || !(layer.width > 0) || !(layer.height > 0)) return undefined;
  const boxWidth = frame.width * frame.pixelScale;
  const boxHeight = frame.height * frame.pixelScale;
  const ratio = layer.fit === "contain" ? Math.min(boxWidth / layer.width, boxHeight / layer.height) : Math.max(boxWidth / layer.width, boxHeight / layer.height);
  const wanted = layer.fit === undefined ? Math.max(frame.pixelWidth, (frame.pixelHeight * layer.width) / layer.height) : layer.width * ratio;
  return Math.ceil(wanted);
}

// A picture that has not come back after this long is given up (see LatestFrameScheduler).
const PICTURE_TIMEOUT_MS = 6000;

const SANDBOX_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'"></head><body><script>${RUNTIME.replace(/<\/script>/gi, "<\\/script>")}</script></body></html>`;

type Pending = Readonly<{ reject: (error: Error) => void; resolve: (value: unknown) => void }>;

// A picture with a transition on it: faded to nothing by `alpha` and covered with black by `black`.
async function shade(bitmap: ImageBitmap, blend: Readonly<{ alpha?: number; black?: number }>): Promise<ImageBitmap> {
  const alpha = blend.alpha ?? 1;
  const black = blend.black ?? 0;
  if (alpha >= 1 && black <= 0) return bitmap;
  const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = surface.getContext("2d");
  if (!context) return bitmap;
  context.globalAlpha = alpha;
  context.drawImage(bitmap, 0, 0);
  if (black > 0) {
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = black;
    context.fillStyle = "#000";
    context.fillRect(0, 0, bitmap.width, bitmap.height);
  }
  bitmap.close();
  return createImageBitmap(surface);
}

export class AnimationSandbox {
  readonly ready: Promise<void>;
  private readonly frame: HTMLIFrameElement;
  private readonly pending = new Map<number, Pending>();
  private readonly scheduler: LatestFrameScheduler<SandboxFrame, { bitmap: ImageBitmap; tracked: DesignBounds | null }>;
  private nextId = 1;
  private disposed = false;
  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== this.frame.contentWindow) return;
    const message = event.data as { available?: Record<string, boolean>; bitmap?: ImageBitmap; id?: number; message?: string; texts?: string[]; type?: string; bounds?: DesignBounds | null; tracked?: DesignBounds | null; stats?: SandboxMemoryStats | null; segments?: readonly SandboxSegment[] | null };
    const request = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!request || typeof message.id !== "number") return;
    this.pending.delete(message.id);
    if (message.type === "error") request.reject(new Error(message.message ?? "The animation failed."));
    else request.resolve(message.type === "frame" ? { bitmap: message.bitmap, tracked: message.tracked ?? null } : message.type === "probe" ? message.texts : message.type === "bounds" ? message.bounds : message.type === "stats" ? message.stats : message.type === "segments" ? message.segments : message.type === "fonts" ? message.available : undefined);
  };

  private readonly spec: AnimationSpec;
  private readonly clips = new Map<string, Promise<MediaClip>>();

  constructor(spec: AnimationSpec) {
    // A pasted Figma design draws with the app's current design script.
    if (spec.design) spec = { ...spec, code: currentDesignCode(spec.code) };
    this.spec = spec;
    // Video and GIF files are decoded here, not in the sandbox; the script never sees them.
    const mediaAssets = new Set([...Object.values(spec.media ?? {}), ...Object.values(spec.assetMedia ?? {})].map((item) => item.asset));
    if (mediaAssets.size > 0) spec = { ...spec, assets: Object.fromEntries(Object.entries(spec.assets).filter(([key]) => !mediaAssets.has(key))) };
    this.frame = document.createElement("iframe");
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.setAttribute("aria-hidden", "true");
    this.frame.tabIndex = -1;
    this.frame.style.cssText = "position:fixed;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-10px;top:-10px";
    this.frame.srcdoc = SANDBOX_DOCUMENT;
    window.addEventListener("message", this.onMessage);
    const loaded = new Promise<void>((resolve) => this.frame.addEventListener("load", () => resolve(), { once: true }));
    document.body.append(this.frame);
    // A Lottie project plays through the app's Lottie script and the lottie-web player instead of its own code.
    this.ready = loaded
      .then(async () =>
        spec.lottie
          ? this.request({ lottiePlayer: await loadLottiePlayerSource(), spec: { ...spec, code: LOTTIE_SCRIPT }, type: "init" })
          : this.request({ spec, type: "init" }),
      )
      .then(() => undefined);
    this.scheduler = new LatestFrameScheduler(
      (frame) => this.renderTracked(frame),
      ({ bitmap }) => bitmap.close(),
      () => performance.now(),
      PICTURE_TIMEOUT_MS,
      (reason) => this.repair(reason),
    );
    this.warmUp();
  }

  private request(message: Record<string, unknown>, transfer: Transferable[] = [], timeoutMs = 0): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error("The animation was closed."));
        return;
      }
      const id = this.nextId;
      this.nextId += 1;
      // A request the page never answers is dropped (a picture request after a while), so nothing waits for it forever.
      const timer = timeoutMs > 0 ? globalThis.setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`The animation did not answer in ${timeoutMs} ms.`));
      }, timeoutMs) : null;
      this.pending.set(id, {
        reject: (error) => {
          if (timer !== null) globalThis.clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          if (timer !== null) globalThis.clearTimeout(timer);
          resolve(value);
        },
      });
      this.frame.contentWindow?.postMessage({ ...message, id }, "*", transfer);
    });
  }

  // Videos and GIFs are opened and their first picture decoded now, so the first Play does not wait for them.
  private warmUp(): void {
    for (const key of [...Object.keys(this.spec.media ?? {}), ...Object.keys(this.spec.assetMedia ?? {})]) {
      const clip = this.clip(key);
      if (clip) void clip.then((item) => item.frameAt(0)).then((bitmap) => bitmap?.close(), () => undefined);
    }
    // A picture played in parts may dissolve one part into another, which takes a second reader: opened now as well.
    for (const [key, media] of Object.entries(this.spec.assetMedia ?? {})) {
      const under = media.kind === "video" ? this.clip(key, true) : null;
      if (under) void under.then((item) => item.frameAt(0)).then((bitmap) => bitmap?.close(), () => undefined);
    }
  }

  // A picture that failed or took too long: the clips are closed and opened again by the next picture, and the reason is logged
  // once per kind, so a frozen preview never fails silently.
  private repair(reason: string): void {
    if (reason !== this.lastReported) console.warn(`[preview] ${reason}; reopening the videos and trying again.`);
    this.lastReported = reason;
    for (const clip of this.clips.values()) void clip.then((item) => item.dispose(), () => undefined);
    this.clips.clear();
    for (const bitmap of this.stills.values()) bitmap.close();
    this.stills.clear();
    this.dropHeld();
  }

  private lastReported = "";

  private preparing = new Set<string>();
  // A part that plays backwards is read by a reader of its own (the second one), made ready in the second before it starts, so neither
  // the part before it (read in order by the first reader) nor its own first picture has to wait.
  private prepare(key: string, media: Pick<MediaLayer, "duration">, plan: readonly VideoSegment[], time: number, width: number | undefined): void {
    const last = Math.max(...plan.map((part) => part.to));
    const at = last > 0 ? ((time % last) + last) % last : 0;
    const next = plan.find((part) => part.from > at && part.from - at <= 1.2);
    if (!next || !(next.end < next.start) || this.preparing.has(key)) return;
    this.preparing.add(key);
    void this.clip(key, true)?.then((clip) => clip.prepareBackwards?.(Math.min(Math.max(0, media.duration - 1e-3), next.start), width)).catch(() => undefined).finally(() => this.preparing.delete(key));
  }

  // The picture the part before ended on, kept while the next part dissolves in over it.
  // Preview with the videos held on one picture (Static): each clip's first picture is decoded once (per width) and a copy is used for every frame.
  private stills = new Map<string, ImageBitmap>();
  private async stillOf(key: string, reader: MediaClip | Promise<MediaClip> | null | undefined, at: number, width: number | undefined): Promise<ImageBitmap | null> {
    const id = `${key}|${at}|${width}`;
    let still = this.stills.get(id);
    if (!still) {
      const made = await (await reader)?.frameAt(at, width);
      if (!made) return null;
      for (const [other, bitmap] of this.stills) {
        if (other.startsWith(`${key}|`)) {
          bitmap.close();
          this.stills.delete(other);
        }
      }
      still = made;
      this.stills.set(id, still);
    }
    return createImageBitmap(still);
  }
  private held = new Map<string, { bitmap: ImageBitmap; time: number }>();
  private dropHeld(key?: string): void {
    for (const [id, item] of [...this.held]) if (key === undefined || id === key) { item.bitmap.close(); this.held.delete(id); }
  }

  // `second` opens another reader on the same file: while one part dissolves in over another, each picture is read in order by its own
  // reader (one reader asked for two places in turn would have to seek every time).
  private clip(id: string, second = false): Promise<MediaClip> | null {
    const layer = this.spec.media?.[id] ?? this.spec.assetMedia?.[id];
    const dataUrl = layer ? this.spec.assets[layer.asset] : undefined;
    if (!layer || !dataUrl) return null;
    const slot = second ? `${id}#under` : id;
    let clip = this.clips.get(slot);
    if (!clip) {
      clip = dataUrlToBlob(dataUrl).then((blob) => openMediaClip(blob, layer.kind));
      this.clips.set(slot, clip);
    }
    return clip;
  }

  // The pictures of the video and GIF layers in the frame's stack at its time, placed by the runtime.
  private async withMedia(frame: SandboxFrame): Promise<{ frame: SandboxFrame & { assetFrames?: unknown; media?: unknown }; transfer: Transferable[] }> {
    const media = this.spec.media ?? {};
    const pictures: { bitmap: ImageBitmap; key: string }[] = [];
    for (const key of Object.keys(this.spec.assetMedia ?? {})) {
      try {
        const media = this.spec.assetMedia?.[key];
        const settings = readVideoSettings(frame.params, key);
        const time = frame.mediaTimeSeconds ?? frame.timeSeconds;
        const clip = await this.clip(key);
        const width = previewWidth(frame, media);
        // Static (preview): no picture is sent for the video, so the design draws the still picture it carries for it (its poster).
        // Nothing is decoded and nothing extra travels with each frame, so the rest of the motion keeps its full speed.
        if (frame.params.__videoStill === true) continue;
        // Just before a part that runs backwards or dissolves in, what it will need is made ready, so its first picture is not waited for.
        if (media && settings.segments && settings.segments.length > 0) this.prepare(key, media, settings.segments, time, width);
        // A part of a plan that dissolves in over the part before it: the picture the part before ended on is laid under the new part's
        // picture, which comes in over it, into one picture. A part that plays backwards has its own reader.
        const blend = media && settings.segments && settings.segments.length > 0 ? planBlend(media, settings.segments, time, settings.fit === true ? (frame.mediaDurationSeconds ?? frame.durationSeconds) : undefined) : null;
        const reader = blend?.reverse ? await this.clip(key, true) : clip;
        if (blend && blend.under !== undefined && blend.mix < 1) {
          let kept = this.held.get(key);
          if (!kept || Math.abs(kept.time - blend.under) > 1e-6) {
            this.dropHeld(key);
            const still = await clip?.frameAt(blend.under, width);
            if (still) {
              kept = { bitmap: still, time: blend.under };
              this.held.set(key, kept);
            } else kept = undefined;
          }
          const over = await reader?.frameAt(blend.at, width);
          if (kept && over) {
            const surface = new OffscreenCanvas(over.width, over.height);
            const context = surface.getContext("2d");
            if (context) {
              context.drawImage(kept.bitmap, 0, 0, over.width, over.height);
              context.globalAlpha = blend.mix;
              context.drawImage(over, 0, 0);
            }
            over.close();
            pictures.push({ bitmap: await shade(await createImageBitmap(surface), blend), key });
            continue;
          }
          if (over) pictures.push({ bitmap: await shade(over, blend), key });
          continue;
        }
        if (this.held.has(key)) this.dropHeld(key);
        if (blend) {
          const bitmap = await reader?.frameAt(blend.at, width);
          if (bitmap) pictures.push({ bitmap: await shade(bitmap, blend), key });
          continue;
        }
        const at = media ? clipTime(media, settings, time, frame.mediaDurationSeconds ?? frame.durationSeconds) : frame.timeSeconds;
        const bitmap = await clip?.frameAt(at, width);
        if (bitmap) pictures.push({ bitmap, key });
      } catch {
        // The still first frame stays when the clip cannot be decoded.
      }
    }
    const styles = (frame.params[LAYER_STYLE_KEY] ?? {}) as Readonly<Record<string, LayerStyle>>;
    const items: { bitmap: ImageBitmap; blend: string; fit: string; id: string; opacity: number }[] = [];
    for (const id of frame.layerStack) {
      const layer = media[id];
      const clip = layer ? this.clip(id) : null;
      if (!layer || !clip) continue;
      try {
        const at = clipTime(layer, readVideoSettings(frame.params, id), frame.mediaTimeSeconds ?? frame.timeSeconds, frame.mediaDurationSeconds ?? frame.durationSeconds);
        const bitmap = frame.params.__videoStill === true ? await this.stillOf(id, clip, clipTime(layer, readVideoSettings(frame.params, id), 0, frame.mediaDurationSeconds ?? frame.durationSeconds), previewWidth(frame, layer)) : await (await clip).frameAt(at, previewWidth(frame, layer));
        if (!bitmap) continue;
        const style = styles[id] ?? {};
        const blend = typeof style.blend === "string" && style.blend !== "design" ? style.blend : "source-over";
        const opacity = typeof style.opacity === "number" ? Math.min(1, Math.max(0, style.opacity / 100)) : 1;
        items.push({ bitmap, blend, fit: layer.fit, id, opacity });
      } catch {
        // A file that cannot be decoded draws nothing; the rest of the picture still renders.
      }
    }
    if (items.length === 0 && pictures.length === 0) return { frame, transfer: [] };
    return {
      frame: { ...frame, ...(pictures.length > 0 ? { assetFrames: pictures } : {}), ...(items.length > 0 ? { media: items } : {}) },
      transfer: [...items.map((item) => item.bitmap), ...pictures.map((item) => item.bitmap)],
    };
  }

  // One picture and, when the frame names a layer to track, where that layer is. The bitmap must be closed.
  async renderTracked(frame: SandboxFrame): Promise<{ bitmap: ImageBitmap; tracked: DesignBounds | null }> {
    await this.ready;
    const prepared = await this.withMedia(frame);
    return (await this.request({ frame: prepared.frame, type: "render" }, prepared.transfer, PICTURE_TIMEOUT_MS)) as { bitmap: ImageBitmap; tracked: DesignBounds | null };
  }

  // One picture; resolves with an ImageBitmap the caller must close.
  async render(frame: SandboxFrame): Promise<ImageBitmap> {
    return (await this.renderTracked(frame)).bitmap;
  }

  // Every text the given frame's layers draw at the given times, in no particular order.
  async probeTexts(frame: SandboxFrame, times: readonly number[]): Promise<string[]> {
    await this.ready;
    return ((await this.request({ frame, times, type: "probe" })) as string[] | undefined) ?? [];
  }

  // The box around everything the frame draws, or null when it draws nothing.
  async measureBounds(frame: SandboxFrame): Promise<DesignBounds | null> {
    await this.ready;
    const prepared = await this.withMedia(frame);
    return ((await this.request({ frame: prepared.frame, type: "bounds" }, prepared.transfer)) as DesignBounds | null | undefined) ?? null;
  }

  // The segments the animation reports for these settings, or an empty list when it does not report any.
  async measureSegments(params: Readonly<Record<string, unknown>>): Promise<readonly SandboxSegment[]> {
    await this.ready;
    return ((await this.request({ params, type: "segments" })) as readonly SandboxSegment[] | null | undefined) ?? [];
  }

  // Which of these font families the drawing can use (installed on this computer, or carried by the design).
  async checkFonts(families: readonly string[]): Promise<Record<string, boolean>> {
    await this.ready;
    return ((await this.request({ families, type: "fonts" })) as Record<string, boolean> | undefined) ?? {};
  }

  async measureMemory(): Promise<SandboxMemoryStats | null> {
    await this.ready;
    return ((await this.request({ type: "stats" })) as SandboxMemoryStats | null | undefined) ?? null;
  }

  // Live preview: only the newest request is drawn, older ones are skipped.
  schedule(
    frame: SandboxFrame,
    onBitmap: (bitmap: ImageBitmap, tracked: DesignBounds | null) => void,
    onSettled?: (sample: LatestFrameSample) => void,
  ): void {
    this.scheduler.schedule(frame, frame.timeSeconds, ({ bitmap, tracked }) => onBitmap(bitmap, tracked), onSettled);
  }

  getScheduleStats(): LatestFrameStats {
    return this.scheduler.getStats();
  }

  dispose(): void {
    this.frame.contentWindow?.postMessage({ type: "dispose" }, "*");
    this.disposed = true;
    this.scheduler.dispose();
    window.removeEventListener("message", this.onMessage);
    for (const request of this.pending.values()) request.reject(new Error("The animation was closed."));
    this.pending.clear();
    for (const clip of this.clips.values()) void clip.then((item) => item.dispose(), () => undefined);
    this.clips.clear();
    this.dropHeld();
    globalThis.setTimeout(() => this.frame.remove(), 0);
  }
}
