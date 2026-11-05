import { GROW_KEY, POSITION_KEY, readFigmaDesign } from "../mo/figma-paste-import";
import type { AnimationSpec } from "./animation-spec";

// The maths behind editing a pasted design directly on the artboard: where every layer sits, which one is under a point,
// how a drag moves or resizes a selection, and where it snaps. All of it is plain data in, plain data out, in the design's
// own pixels (the picture the drawing script makes), so it can be tested without a browser.

export type Box = Readonly<{ h: number; w: number; x: number; y: number }>;
export type Point = Readonly<{ x: number; y: number }>;

// How far a layer is from where it was pasted is params.__pos (in the pasted block's own units) and how much it has been
// stretched from its top-left corner is params.__grow; the drawing script reads both.

export type Placed = Readonly<{
  id: string;
  // The block's scale: one block unit is this many design pixels.
  k: number;
  // The layer's box as pasted, in the picture's pixels.
  nat: Box;
  // Whether the layer draws anything. A frame with no fill or stroke is only a container: clicking its area selects nothing.
  painted: boolean;
}>;

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

// Every drawn layer of a pasted design with the box it was pasted at. Mask layers draw nothing, so they are left out.
// `renderSize` is the picture's size; the design is centred in it, exactly as the drawing script does.
const paints = (paint: unknown): boolean => typeof paint === "object" && paint !== null && (paint as { opacity?: unknown; visible?: unknown }).visible !== false && (paint as { opacity?: unknown }).opacity !== 0;

// Whether a pasted layer puts anything on the picture: text, an icon or picture, a fill, a stroke or an effect.
export function drawsSomething(item: Readonly<{ effects?: readonly unknown[]; fillAsset?: string; fills: readonly unknown[]; kind: string; pic?: unknown; strokes: readonly unknown[]; sw: number }>): boolean {
  if (item.kind === "text" || item.kind === "svg" || item.kind === "png" || item.pic || item.fillAsset) return true;
  if (item.fills.some(paints)) return true;
  if (item.sw > 0 && item.strokes.some(paints)) return true;
  return false;
}

export function readPlaced(spec: AnimationSpec, renderSize: Readonly<{ height: number; width: number }>): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  const design = readFigmaDesign(spec);
  if (!design) return placed;
  const ox = (renderSize.width - design.width) / 2;
  const oy = (renderSize.height - design.height) / 2;
  for (const block of design.blocks) {
    const k = block.s || 1;
    for (const item of block.items) {
      if (item.isMask || !(item.w > 0) || !(item.h > 0)) continue;
      // A layer that Figma turned or skewed carries a matrix (m: a, b, c, d, e, f): its box is the box around the four corners where it is drawn.
      let box = { h: item.h, w: item.w, x: item.x, y: item.y };
      if (item.m) {
        const [a, b, c, d, e, f] = item.m;
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [px, py] of [[item.x, item.y], [item.x + item.w, item.y], [item.x, item.y + item.h], [item.x + item.w, item.y + item.h]] as const) {
          xs.push(a * px + c * py + e);
          ys.push(b * px + d * py + f);
        }
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        box = { h: Math.max(...ys) - top, w: Math.max(...xs) - left, x: left, y: top };
      }
      placed.set(item.id, {
        id: item.id,
        k,
        nat: { h: box.h * k, w: box.w * k, x: ox + block.x + box.x * k, y: oy + block.y + box.y * k },
        painted: drawsSomething(item),
      });
    }
  }
  return placed;
}

export function readMoves(params: Readonly<Record<string, unknown>>): Readonly<Record<string, Point>> {
  const raw = params[POSITION_KEY];
  const out: Record<string, Point> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) if (isRecord(value)) out[id] = { x: finite(value.x, 0), y: finite(value.y, 0) };
  return out;
}

export type Grow = Readonly<{ sx: number; sy: number }>;

export function readGrows(params: Readonly<Record<string, unknown>>): Readonly<Record<string, Grow>> {
  const raw = params[GROW_KEY];
  const out: Record<string, Grow> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) if (isRecord(value)) out[id] = { sx: Math.max(0.001, finite(value.sx, 1)), sy: Math.max(0.001, finite(value.sy, 1)) };
  return out;
}

// Where a layer is drawn now: as pasted, moved by params.__pos and stretched by params.__grow from its top-left corner.
export function currentBox(placed: Placed, moves: Readonly<Record<string, Point>>, grows: Readonly<Record<string, Grow>>): Box {
  const move = moves[placed.id];
  const grow = grows[placed.id];
  return {
    h: placed.nat.h * (grow?.sy ?? 1),
    w: placed.nat.w * (grow?.sx ?? 1),
    x: placed.nat.x + (move?.x ?? 0) * placed.k,
    y: placed.nat.y + (move?.y ?? 0) * placed.k,
  };
}

export function currentBoxes(placed: ReadonlyMap<string, Placed>, params: Readonly<Record<string, unknown>>): Map<string, Box> {
  const moves = readMoves(params);
  const grows = readGrows(params);
  const boxes = new Map<string, Box>();
  for (const item of placed.values()) boxes.set(item.id, currentBox(item, moves, grows));
  return boxes;
}

type LayerLike = Readonly<{ id: string; kind?: string; parentGroupId?: string }>;

// The drawn layers a selection stands for: a group stands for everything inside it.
export function leavesOf(layers: readonly LayerLike[], ids: readonly string[], drawn: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const walk = (id: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const layer = layers.find((item) => item.id === id);
    if (layer?.kind === "group") {
      // A frame is drawn too (its own fill); a plain group is not.
      if (drawn.has(id)) out.add(id);
      for (const child of layers) if (child.parentGroupId === id) walk(child.id, seen);
      return;
    }
    if (drawn.has(id)) out.add(id);
  };
  for (const id of ids) walk(id, new Set());
  return [...out];
}

export function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const box of boxes) {
    x0 = Math.min(x0, box.x);
    y0 = Math.min(y0, box.y);
    x1 = Math.max(x1, box.x + box.w);
    y1 = Math.max(y1, box.y + box.h);
  }
  return { h: y1 - y0, w: x1 - x0, x: x0, y: y0 };
}

export const contains = (box: Box, point: Point): boolean => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

// The layer drawn on top at a point. `topFirst` lists the drawn layers from the top down.
// The layers (top first) whose box touches the given rectangle: what a marquee drag around part of the artboard selects.
export function layersInRect(topFirst: readonly string[], boxes: ReadonlyMap<string, Box>, area: Box): string[] {
  const out: string[] = [];
  for (const id of topFirst) {
    const box = boxes.get(id);
    if (box && box.x < area.x + area.w && box.x + box.w > area.x && box.y < area.y + area.h && box.y + box.h > area.y) out.push(id);
  }
  return out;
}

export function hitTest(topFirst: readonly string[], boxes: ReadonlyMap<string, Box>, point: Point): string | null {
  for (const id of topFirst) {
    const box = boxes.get(id);
    if (box && contains(box, point)) return id;
  }
  return null;
}

// Moves or stretches each layer so it ends in the box given for it, and returns the new params. A layer back at its pasted place
// and size leaves no entry behind.
export function withBoxes(
  params: Readonly<Record<string, unknown>>,
  placed: ReadonlyMap<string, Placed>,
  targets: ReadonlyMap<string, Box>,
): Record<string, unknown> {
  const moves: Record<string, Point> = { ...readMoves(params) };
  const grows: Record<string, Grow> = { ...readGrows(params) };
  const round = (value: number): number => Math.round(value * 100) / 100;
  for (const [id, box] of targets) {
    const base = placed.get(id);
    if (!base) continue;
    const move = { x: round((box.x - base.nat.x) / base.k), y: round((box.y - base.nat.y) / base.k) };
    if (move.x === 0 && move.y === 0) delete moves[id];
    else moves[id] = move;
    const grow = { sx: Math.round((box.w / base.nat.w) * 10000) / 10000, sy: Math.round((box.h / base.nat.h) * 10000) / 10000 };
    if (grow.sx === 1 && grow.sy === 1) delete grows[id];
    else grows[id] = grow;
  }
  const { [POSITION_KEY]: _moves, [GROW_KEY]: _grows, ...rest } = params;
  return {
    ...rest,
    ...(Object.keys(moves).length > 0 ? { [POSITION_KEY]: moves } : {}),
    ...(Object.keys(grows).length > 0 ? { [GROW_KEY]: grows } : {}),
  };
}

export type Corner = "ne" | "nw" | "se" | "sw";

export const MIN_SIZE = 4;

// The box a corner drag makes: the opposite corner stays where it is. `lock` keeps the proportions.
export function resizedBox(start: Box, corner: Corner, point: Point, lock: boolean): Box {
  const left = corner === "nw" || corner === "sw";
  const top = corner === "nw" || corner === "ne";
  const anchorX = left ? start.x + start.w : start.x;
  const anchorY = top ? start.y + start.h : start.y;
  let w = Math.max(MIN_SIZE, left ? anchorX - point.x : point.x - anchorX);
  let h = Math.max(MIN_SIZE, top ? anchorY - point.y : point.y - anchorY);
  if (lock && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
  }
  return { h, w, x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY };
}

// Maps boxes from one outline to another: each box keeps its place and size relative to the outline.
export function scaleBoxes(boxes: ReadonlyMap<string, Box>, from: Box, to: Box): Map<string, Box> {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const out = new Map<string, Box>();
  for (const [id, box] of boxes) out.set(id, { h: box.h * sy, w: box.w * sx, x: to.x + (box.x - from.x) * sx, y: to.y + (box.y - from.y) * sy });
  return out;
}

export function shiftBoxes(boxes: ReadonlyMap<string, Box>, dx: number, dy: number): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const [id, box] of boxes) out.set(id, { ...box, x: box.x + dx, y: box.y + dy });
  return out;
}

export type Guides = Readonly<{ x: readonly number[]; y: readonly number[] }>;
export const NO_GUIDES: Guides = { x: [], y: [] };

const linesOf = (start: number, size: number): number[] => [start, start + size / 2, start + size];

function closest(edges: readonly number[], lines: readonly number[], threshold: number): { guide: number | null; offset: number } {
  let best: { guide: number | null; offset: number } = { guide: null, offset: 0 };
  let distance = threshold;
  for (const edge of edges) {
    for (const line of lines) {
      const gap = Math.abs(line - edge);
      if (gap <= distance) {
        distance = gap;
        best = { guide: line, offset: line - edge };
      }
    }
  }
  return best;
}

// The lines a moving box can snap to: the edges and middles of the other layers and of the artboard.
export function snapLines(others: readonly Box[], artboard: Box): { x: number[]; y: number[] } {
  const x = [...linesOf(artboard.x, artboard.w)];
  const y = [...linesOf(artboard.y, artboard.h)];
  for (const box of others) {
    x.push(...linesOf(box.x, box.w));
    y.push(...linesOf(box.y, box.h));
  }
  return { x, y };
}

// A moving box lands on a line when one of its edges or its middle is within `threshold`.
export function snapMove(box: Box, lines: Readonly<{ x: readonly number[]; y: readonly number[] }>, threshold: number): { dx: number; dy: number; guides: Guides } {
  const snapX = closest(linesOf(box.x, box.w), lines.x, threshold);
  const snapY = closest(linesOf(box.y, box.h), lines.y, threshold);
  return {
    dx: snapX.offset,
    dy: snapY.offset,
    guides: { x: snapX.guide === null ? [] : [snapX.guide], y: snapY.guide === null ? [] : [snapY.guide] },
  };
}

// While a corner is dragged only the two edges that move can snap.
export function snapResize(
  box: Box,
  corner: Corner,
  lines: Readonly<{ x: readonly number[]; y: readonly number[] }>,
  threshold: number,
  lock: boolean,
): { box: Box; guides: Guides } {
  const left = corner === "nw" || corner === "sw";
  const top = corner === "nw" || corner === "ne";
  const snapX = closest([left ? box.x : box.x + box.w], lines.x, threshold);
  const snapY = closest([top ? box.y : box.y + box.h], lines.y, threshold);
  let next = { ...box };
  if (!lock) {
    if (snapX.guide !== null) next = left ? { ...next, w: next.w - snapX.offset, x: next.x + snapX.offset } : { ...next, w: next.w + snapX.offset };
    if (snapY.guide !== null) next = top ? { ...next, h: next.h - snapY.offset, y: next.y + snapY.offset } : { ...next, h: next.h + snapY.offset };
  } else if (snapX.guide !== null || snapY.guide !== null) {
    // With the proportions locked one edge decides; the other follows.
    const useX = snapX.guide !== null && (snapY.guide === null || Math.abs(snapX.offset) <= Math.abs(snapY.offset));
    const ratio = box.h > 0 ? box.w / box.h : 1;
    const w = useX ? (left ? box.w - snapX.offset : box.w + snapX.offset) : (top ? box.h - snapY.offset : box.h + snapY.offset) * ratio;
    const h = w / ratio;
    next = { h, w, x: left ? box.x + box.w - w : box.x, y: top ? box.y + box.h - h : box.y };
  }
  return { box: { ...next, h: Math.max(MIN_SIZE, next.h), w: Math.max(MIN_SIZE, next.w) }, guides: { x: snapX.guide === null ? [] : [snapX.guide], y: snapY.guide === null ? [] : [snapY.guide] } };
}

export type Distance = Readonly<{ from: Point; label: string; to: Point }>;

const overlapRange = (a0: number, a1: number, b0: number, b1: number): [number, number] | null => {
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  return end > start ? [start, end] : null;
};

// The gap from the selection to the nearest layer on each side, where the two face each other.
export function distances(selection: Box, others: readonly Box[]): Distance[] {
  const out: Distance[] = [];
  const nearest = (side: "bottom" | "left" | "right" | "top"): void => {
    let best: { gap: number; line: [Point, Point] } | null = null;
    for (const box of others) {
      if (side === "left" || side === "right") {
        const shared = overlapRange(selection.y, selection.y + selection.h, box.y, box.y + box.h);
        if (!shared) continue;
        const gap = side === "left" ? selection.x - (box.x + box.w) : box.x - (selection.x + selection.w);
        if (gap < 0.5 || (best && gap >= best.gap)) continue;
        const y = (shared[0] + shared[1]) / 2;
        const x0 = side === "left" ? box.x + box.w : selection.x + selection.w;
        best = { gap, line: [{ x: x0, y }, { x: x0 + gap, y }] };
      } else {
        const shared = overlapRange(selection.x, selection.x + selection.w, box.x, box.x + box.w);
        if (!shared) continue;
        const gap = side === "top" ? selection.y - (box.y + box.h) : box.y - (selection.y + selection.h);
        if (gap < 0.5 || (best && gap >= best.gap)) continue;
        const x = (shared[0] + shared[1]) / 2;
        const y0 = side === "top" ? box.y + box.h : selection.y + selection.h;
        best = { gap, line: [{ x, y: y0 }, { x, y: y0 + gap }] };
      }
    }
    if (best) out.push({ from: best.line[0], label: String(Math.round(best.gap)), to: best.line[1] });
  };
  for (const side of ["left", "right", "top", "bottom"] as const) nearest(side);
  return out;
}
