import type { Box } from "./layer-geometry";

// While a layer is dragged or resized on the artboard the whole design is not drawn again for every move (that is what made a
// fast drag lag). The picture is drawn three times once, when the drag starts: everything below the moved layers, the moved
// layers alone, and everything above them. Then every move only slides (or stretches) the middle picture over the others, which
// is a few image copies. When the pointer is let go the real values are written and the design is drawn in full.

export type DragParts = Readonly<{
  // Pictures of the design's size, `scale` pixels per design unit. `above` and `below` are null when nothing is there.
  above: ImageBitmap | null;
  below: ImageBitmap | null;
  height: number;
  scale: number;
  selected: ImageBitmap;
  width: number;
}>;

// Where the moved layers' outline was, and where it is now (design units). The picture of the layers follows the same mapping.
export type DragLive = Readonly<{ from: Box; to: Box }>;

type Host = Readonly<{ prepare: (layerIds: readonly string[]) => Promise<DragParts | null> }>;

let host: Host | null = null;
let parts: DragParts | null = null;
let live: DragLive | null = null;
// Each drag has a number; a picture that arrives for a drag that is over is dropped.
let token = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export function registerDragPreviewHost(next: Host | null): void {
  host = next;
}

export function subscribeDragPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDragPreview(): { live: DragLive | null; parts: DragParts | null } {
  return { live, parts };
}

function release(): void {
  const old = parts;
  parts = null;
  live = null;
  token += 1;
  if (old) {
    old.above?.close();
    old.below?.close();
    old.selected.close();
  }
}

// Starts drawing the three pictures for a drag. Resolves when they are ready (or null when the design cannot be split, in which
// case the caller falls back to writing every move).
export async function beginDragPreview(layerIds: readonly string[]): Promise<boolean> {
  release();
  const mine = token;
  if (!host) return false;
  let made: DragParts | null = null;
  try {
    made = await host.prepare(layerIds);
  } catch {
    made = null;
  }
  if (!made) return false;
  if (mine !== token) {
    made.above?.close();
    made.below?.close();
    made.selected.close();
    return false;
  }
  parts = made;
  emit();
  return true;
}

export function setDragLive(next: DragLive | null): void {
  live = next;
  emit();
}

export function endDragPreview(): void {
  release();
  emit();
}

// Puts the three pictures together on `target` (sized like the design's picture): the moved layers are mapped from where they
// were to where they are now (a move or a stretch of their outline), over everything below and under everything above.
export function composeDragPreview(target: HTMLCanvasElement | OffscreenCanvas, drag: DragParts, now: DragLive): void {
  const width = Math.max(1, drag.selected.width);
  const height = Math.max(1, drag.selected.height);
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const context = target.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  if (drag.below) context.drawImage(drag.below, 0, 0);
  const sx = now.from.w > 0 ? now.to.w / now.from.w : 1;
  const sy = now.from.h > 0 ? now.to.h / now.from.h : 1;
  const s = drag.scale;
  // A point of the layers' picture, design unit d at pixel s*d, lands at s * (to + (d - from) * sx).
  context.setTransform(sx, 0, 0, sy, s * (now.to.x - now.from.x * sx), s * (now.to.y - now.from.y * sy));
  context.drawImage(drag.selected, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (drag.above) context.drawImage(drag.above, 0, 0);
}

// The ids drawn below, with and above the moved layers, from the bottom up. Layers between the moved ones count as below.
export function splitStack(stack: readonly string[], moved: ReadonlySet<string>): { above: string[]; below: string[]; selected: string[] } | null {
  const selected = stack.filter((id) => moved.has(id));
  if (selected.length === 0) return null;
  const top = stack.reduce((last, id, index) => (moved.has(id) ? index : last), -1);
  return {
    above: stack.filter((_, index) => index > top),
    below: stack.filter((id, index) => index < top && !moved.has(id)),
    selected,
  };
}
