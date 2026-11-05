import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";
import { createControlHistoryGroupId } from "@/toolcraft/ui";

import { ARTBOARD_SELECT_COLOR, setArtboardSelected, useArtboardSelected } from "../mo/mo-artboard-selection";
import { dismissLayerSelection, notePickedLayer, useActiveLayerId } from "../mo/mo-layer-selection";
import { frameClips } from "./group-box";
import { withLayerEffects } from "./layer-effect-boxes";
import { hasFloat, withMotionOffsets } from "./layer-motion-boxes";
import { resolveProjectScenes } from "./scenes";
import { lockedLayers, readLocked } from "./layer-lock";
import { findFigmaItem, fontKey, TEXT_EDITS_KEY, textFonts, type TextEdit } from "../mo/figma-paste-import";
import { ANIMATION_PARAMS_TARGET, getActiveAnimation, getLayerStack, resolveParams } from "./animation-spec";
import {
  currentBoxes,
  distances,
  hitTest,
  leavesOf,
  NO_GUIDES,
  readPlaced,
  resizedBox,
  scaleBoxes,
  shiftBoxes,
  snapLines,
  snapMove,
  snapResize,
  union,
  withBoxes,
  type Box,
  type Corner,
  type Distance,
  type Guides,
  type Placed,
  type Point,
  layersInRect,
} from "./layer-geometry";
import { beginDragPreview, endDragPreview, setDragLive } from "./drag-preview";
import styles from "./canvas-edit.module.css";

// Editing a pasted design straight on the artboard: click a layer to select it, Shift-click to add more, drag to move, drag a
// corner to resize, see snap guides and the gaps to neighbours, press Delete to remove, double-click a text to retype it.
// Everything it changes is the same project data the Layer section already writes (params.__pos, __grow, __text), so the
// sliders and the artboard always agree, and undo takes a whole drag back in one step.

type Transform = Readonly<{ rotation: number; scale: number; x: number; y: number }>;

type Props = Readonly<{
  drawSize: Readonly<{ height: number; width: number }>;
  // Off while the picture is not a plain, still view of the design (it plays, scrolls, has a camera, a mockup, ...).
  enabled: boolean;
  frameTransform: Transform;
  rect: Readonly<{ height: number; width: number }>;
}>;

const CORNERS: readonly Corner[] = ["nw", "ne", "se", "sw"];
const HANDLE = 8;
// How near (screen px) a moving edge must come to a line before it snaps.
const SNAP_SCREEN_PX = 6;
const CLICK_SLOP_PX = 3;
const GUIDE = "#F24822";
const SELECT = "#0D99FF";
// The selected artboard: a thin violet outline with a square handle on each corner.
const ARTBOARD_SELECT = ARTBOARD_SELECT_COLOR;

type Drag = {
  corner: Corner | null;
  lines: { x: number[]; y: number[] };
  moved: boolean;
  params: Record<string, unknown>;
  pointerId: number;
  // Shift-click on a layer already selected removes it, unless it turned out to be a drag.
  removeOnUp: string | null;
  // A click that did not drag selects just the layer that was pressed (when it was one of several).
  soloOnUp: string | null;
  start: Point;
  startBoxes: Map<string, Box>;
  startBBox: Box;
  startClient: Point;
  group: string;
  // Whether the picture follows from pieces put together (ready), is still being drawn (pending) or falls back to writing every move (off).
  preview: "off" | "pending" | "ready";
  lastResult: Box | null;
  lastTargets: Map<string, Box> | null;
};

type Editing = Readonly<{ box: { h: number; w: number; x: number; y: number }; id: string; initial: string; multiline: boolean; style: React.CSSProperties }>;

// A light text is edited on a dark box and a dark one on a light box, so what is typed can always be read.
function editorColors(hex: string | undefined): { background: string; color: string } {
  const value = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? Number.parseInt((hex as string).slice(1), 16) : 0x111111;
  const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return { background: luminance > 0.6 ? "rgba(20, 20, 24, 0.96)" : "rgba(255, 255, 255, 0.96)", color: hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#111111" };
}

const intersect = (a: Box, b: Box): Box | null => {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { h: y1 - y0, w: x1 - x0, x: x0, y: y0 } : null;
};

const KEY_OWNERS = '[data-panel-type], [data-mo-app-sidebar], [data-slot^="layers-panel"], [data-layer-list]';

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;

// A layer picked on the artboard opens the Layers panel on it: the Layers tab shows, the groups around the layer open (outermost first;
// each opens after the one above it has drawn its rows) and its row scrolls into view.
function revealInLayersPanel(id: string, layers: readonly { id: string; parentGroupId?: string }[]): void {
  window.dispatchEvent(new Event("mo-show-layers"));
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const chain: string[] = [];
  for (let at = byId.get(id)?.parentGroupId, guard = 0; at && guard < 1000; at = byId.get(at)?.parentGroupId, guard += 1) chain.unshift(at);
  const row = (layerId: string): HTMLElement | null => document.querySelector<HTMLElement>(`li[data-layer-id="${CSS.escape(layerId)}"]`);
  let pass = 0;
  const step = (): void => {
    pass += 1;
    let opened = false;
    for (const parent of chain) {
      const toggle = row(parent)?.querySelector<HTMLElement>('span[data-layer-row-icon-hit-area="group"][data-layer-row-icon-label^="Expand"]');
      if (toggle) {
        toggle.click();
        opened = true;
        break;
      }
    }
    if (opened && pass < chain.length + 2) requestAnimationFrame(step);
    else requestAnimationFrame(() => row(id)?.scrollIntoView({ block: "center" }));
  };
  requestAnimationFrame(() => requestAnimationFrame(step));
}

// The boxes shown are where the layers are drawn now (aligned, sized, floating); what is saved is where they rest. A dragged box goes back by the
// distance its layer was shown away from rest, so moving a layer never saves its alignment or its float as its position.
function atRest(targets: ReadonlyMap<string, Box>, shown: ReadonlyMap<string, Box>, resting: ReadonlyMap<string, Box>): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const [id, box] of targets) {
    const now = shown.get(id);
    const rest = resting.get(id);
    out.set(id, now && rest ? { ...box, x: box.x - (now.x - rest.x), y: box.y - (now.y - rest.y) } : box);
  }
  return out;
}

export function CanvasEdit({ drawSize, enabled, frameTransform, rect }: Props): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const selectedLayerId = useToolcraftSelector((state) => state.selectedLayerId);
  const zoom = useToolcraftSelector((state) => state.canvas.zoom);
  const activeId = useActiveLayerId(selectedLayerId);
  // The artboard and the main layer (the first top-level group of the Layers panel) are one thing: selecting either selects both.
  const mainId = React.useMemo(() => layers.find((layer) => layer.kind === "group" && !layer.parentGroupId)?.id ?? null, [layers]);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);

  const spec = React.useMemo(() => getActiveAnimation(values), [values]);
  const params = React.useMemo(() => (spec ? resolveParams(spec, values[ANIMATION_PARAMS_TARGET]) : {}), [spec, values]);
  const placed = React.useMemo(() => (spec ? readPlaced(spec, drawSize) : new Map<string, Placed>()), [spec, drawSize]);
  // Locked layers (Layers panel) are not picked or moved on the artboard.
  const locked = React.useMemo(() => lockedLayers(layers, readLocked(params)), [layers, params]);
  // The playhead, in seconds into the open scene, only while a Float loop moves a layer (so the outline can follow it); 0 otherwise.
  const floating = React.useMemo(() => hasFloat(params), [params]);
  const sceneSeconds = useToolcraftSelector((state) => {
    if (!floating) return 0;
    const scenes = resolveProjectScenes(state.values, state.timeline.durationSeconds);
    return Math.max(0, state.timeline.currentTimeSeconds - (scenes.items[scenes.activeIndex]?.start ?? 0));
  });
  const resting = React.useMemo(() => currentBoxes(placed, params), [placed, params]);
  const boxes = React.useMemo(() => {
    const settled = withLayerEffects(resting, layers, params, spec, drawSize);
    return floating ? withMotionOffsets(settled, layers, params, sceneSeconds) : settled;
  }, [resting, params, layers, spec, drawSize, floating, sceneSeconds]);
  // What shows of each layer: its box cut by the frames around it that clip what they hold (what sticks out of such a frame is not there).
  // Clicks pick by this, and a selection is outlined by it.
  const visible = React.useMemo(() => {
    const out = new Map<string, Box>();
    if (!spec) return out;
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const clipping = new Map<string, boolean>();
    const clips = (id: string): boolean => {
      const known = clipping.get(id);
      if (known !== undefined) return known;
      const answer = frameClips(spec, id, params);
      clipping.set(id, answer);
      return answer;
    };
    for (const [id, box] of boxes) {
      let shown: Box | null = box;
      for (let at = byId.get(id)?.parentGroupId, guard = 0; at && shown && guard < 1000; at = byId.get(at)?.parentGroupId, guard += 1) {
        const frame = clips(at) ? boxes.get(at) : undefined;
        if (frame) shown = intersect(shown, frame);
      }
      if (shown) out.set(id, shown);
    }
    return out;
  }, [spec, layers, params, boxes]);

  // Drawn layers from the top down: the picture draws them bottom to top.
  const topFirst = React.useMemo(() => (spec ? getLayerStack(spec, layers).filter((id) => placed.has(id)).reverse() : []), [spec, layers, placed]);
  const drawn = React.useMemo(() => new Set(topFirst), [topFirst]);
  // Only layers that paint something can be picked with a click, and not one that covers (nearly) the whole artboard: that is the
  // background, and clicking empty space should let go of the selection. Both are reached from the Layers panel.
  const pickable = React.useMemo(
    () =>
      topFirst.filter((id) => {
        const box = visible.get(id);
        if (!placed.get(id)?.painted || !box || locked.has(id)) return false;
        return !(box.w >= drawSize.width * 0.9 && box.h >= drawSize.height * 0.9);
      }),
    [topFirst, placed, visible, locked, drawSize.height, drawSize.width],
  );

  const [selection, setSelection] = React.useState<string[]>([]);
  const [hover, setHover] = React.useState<string | null>(null);
  const [guides, setGuides] = React.useState<Guides>(NO_GUIDES);
  const [gaps, setGaps] = React.useState<Distance[]>([]);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [cursor, setCursor] = React.useState<string>("default");
  // The boxes while a drag is under way: the outline follows the pointer at once, without waiting for the new values to come back.
  const [live, setLive] = React.useState<Map<string, Box> | null>(null);
  const dragRef = React.useRef<Drag | null>(null);
  // The artboard itself is selected (a click on empty artboard space); its settings show in the Modifier tab.
  const artboardSelected = useArtboardSelected();
  // Letting go of the artboard also lets go of the main layer, which is the same thing.
  const letGoOfArtboard = (): void => {
    setArtboardSelected(false);
    if (mainId !== null && selectedLayerIdRef.current === mainId) dismissLayerSelection(mainId);
  };
  // The artboard lets go when Escape is pressed (not while typing) or when the empty canvas around it is clicked.
  React.useEffect(() => {
    if (!artboardSelected) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented && !isTyping(event.target)) letGoOfArtboard();
    };
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || surfaceRef.current?.contains(target) || target.closest("[data-mo-layer-selection]")) return;
      // Only a click on the canvas area itself counts; panels, the bars and the artboard's own bits keep it.
      if (target.closest('[data-slot="toolcraft-runtime-canvas"]') && !target.closest("[data-panel-type], [data-mo-app-sidebar], [data-mo-canvas-edit], button, input, textarea, select, [role='menu'], [role='dialog']")) letGoOfArtboard();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [artboardSelected]);

  // The canvas clips everything to the artboard, which would cut half of an outline that sits on the artboard's edge and its corner handles. The
  // artboard's and the layers' outlines are drawn in the canvas's world instead, which is not clipped, at the same place and scale.
  const [world, setWorld] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    setWorld(surfaceRef.current?.closest<HTMLElement>("[data-toolcraft-canvas-world]") ?? null);
  }, []);
  // A marquee drag started on empty artboard space: the rectangle (artboard px) and what is needed to finish it.
  const [marquee, setMarquee] = React.useState<Readonly<{ x0: number; x1: number; y0: number; y1: number }> | null>(null);
  const marqueeRef = React.useRef<{ base: string[]; moved: boolean; pointerId: number; shift: boolean; startClient: Point } | null>(null);

  // A layer picked in the Layers panel becomes the selection; letting go of it there clears this one too. The main layer is the artboard:
  // picking it shows the artboard's outline, not a layer's, and letting go of it lets go of the artboard.
  const mainPicked = React.useRef(false);
  React.useEffect(() => {
    if (activeId === null) {
      setSelection((current) => (current.length === 0 ? current : []));
      if (mainPicked.current) {
        mainPicked.current = false;
        setArtboardSelected(false);
      }
    } else if (activeId === mainId) {
      mainPicked.current = true;
      setSelection((current) => (current.length === 0 ? current : []));
      setArtboardSelected(true);
    } else {
      mainPicked.current = false;
      setSelection((current) => (current.includes(activeId) ? current : [activeId]));
      setArtboardSelected(false);
    }
  }, [activeId, mainId]);

  const latest = React.useRef({ boxes, resting, drawn, enabled, mainId, layers, locked, params, pickable, placed, selection, spec, topFirst, visible, zoom, frameTransform, drawSize, rect });
  latest.current = { boxes, resting, drawn, enabled, mainId, layers, locked, params, pickable, placed, selection, spec, topFirst, visible, zoom, frameTransform, drawSize, rect };

  const leaves = React.useMemo(() => leavesOf(layers, selection, drawn), [layers, selection, drawn]);
  const selectionBoxes = React.useMemo(() => {
    const out = new Map<string, Box>();
    for (const id of leaves) {
      const box = live?.get(id) ?? visible.get(id);
      if (box) out.set(id, box);
    }
    return out;
  }, [leaves, visible, live]);
  // The outline: what shows of the selection (a clipping frame is its own box); while a drag is under way it is the moving box itself.
  const [liveOutline, setLiveOutline] = React.useState<Box | null>(null);
  const outline = React.useMemo(() => {
    if (liveOutline) return liveOutline;
    const shown: Box[] = [];
    for (const id of leaves) {
      const box = visible.get(id);
      if (box) shown.push(box);
    }
    return union(shown);
  }, [leaves, visible, liveOutline]);

  // Design pixels <-> artboard pixels (the picture is placed on the artboard by the frame's scale, turn and offset).
  const toCss = React.useCallback(
    (point: Point): Point => {
      const k = frameTransform.scale / 100;
      const a = (frameTransform.rotation * Math.PI) / 180;
      const dx = point.x - drawSize.width / 2;
      const dy = point.y - drawSize.height / 2;
      return {
        x: rect.width / 2 + frameTransform.x + k * (dx * Math.cos(a) - dy * Math.sin(a)),
        y: rect.height / 2 + frameTransform.y + k * (dx * Math.sin(a) + dy * Math.cos(a)),
      };
    },
    [drawSize.height, drawSize.width, frameTransform.rotation, frameTransform.scale, frameTransform.x, frameTransform.y, rect.height, rect.width],
  );

  const fromClient = React.useCallback((clientX: number, clientY: number): Point | null => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const { drawSize: draw, frameTransform: t, rect: size } = latest.current;
    const css = { x: ((clientX - bounds.left) * size.width) / bounds.width, y: ((clientY - bounds.top) * size.height) / bounds.height };
    const k = t.scale / 100 || 1;
    const a = (t.rotation * Math.PI) / 180;
    const vx = (css.x - size.width / 2 - t.x) / k;
    const vy = (css.y - size.height / 2 - t.y) / k;
    return { x: vx * Math.cos(a) + vy * Math.sin(a) + draw.width / 2, y: -vx * Math.sin(a) + vy * Math.cos(a) + draw.height / 2 };
  }, []);

  const write = React.useCallback(
    (next: Record<string, unknown>, label: string, group: string): void => {
      dispatch({ history: "merge", historyGroup: group, label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: next });
    },
    [dispatch],
  );

  const selectedLayerIdRef = React.useRef(selectedLayerId);
  selectedLayerIdRef.current = selectedLayerId;
  const select = React.useCallback(
    (ids: string[], primary: string | null): void => {
      setSelection(ids);
      if (primary !== null) setArtboardSelected(false);
      if (primary === null) {
        dismissLayerSelection(selectedLayerIdRef.current);
        return;
      }
      notePickedLayer();
      dispatch({ layerId: primary, type: "layers.select" });
      revealInLayersPanel(primary, latest.current.layers);
    },
    [dispatch],
  );

  const threshold = (): number => {
    const { frameTransform: t, zoom: z } = latest.current;
    return SNAP_SCREEN_PX / (Math.max(0.01, z / 100) * Math.max(0.01, t.scale / 100));
  };

  const othersOf = (exclude: ReadonlySet<string>): Box[] => {
    const out: Box[] = [];
    for (const id of latest.current.topFirst) {
      const box = latest.current.visible.get(id);
      if (box && !exclude.has(id)) out.push(box);
    }
    return out;
  };

  const artboardBox = (): Box => ({ h: latest.current.drawSize.height, w: latest.current.drawSize.width, x: 0, y: 0 });

  // One frame of a drag: the pointer's latest place decides the new boxes; they are written, and the guides shown.
  const pending = React.useRef<{ alt: boolean; client: Point; shift: boolean } | null>(null);
  const frame = React.useRef(0);
  const apply = (): void => {
    frame.current = 0;
    const drag = dragRef.current;
    const input = pending.current;
    if (!drag || !input) return;
    const point = fromClient(input.client.x, input.client.y);
    if (!point) return;
    const t = threshold();
    let targets: Map<string, Box>;
    let nextGuides: Guides = NO_GUIDES;
    let result: Box;
    if (drag.corner) {
      const raw = resizedBox(drag.startBBox, drag.corner, point, input.shift);
      const snapped = input.alt ? { box: raw, guides: NO_GUIDES } : snapResize(raw, drag.corner, drag.lines, t, input.shift);
      result = snapped.box;
      nextGuides = snapped.guides;
      targets = scaleBoxes(drag.startBoxes, drag.startBBox, result);
    } else {
      let dx = point.x - drag.start.x;
      let dy = point.y - drag.start.y;
      // Shift keeps a move on one axis.
      if (input.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let moved: Box = { ...drag.startBBox, x: drag.startBBox.x + dx, y: drag.startBBox.y + dy };
      if (!input.alt) {
        const snap = snapMove(moved, drag.lines, t);
        if (!input.shift || Math.abs(snap.dx) > 0) dx += snap.dx;
        if (!input.shift || Math.abs(snap.dy) > 0) dy += snap.dy;
        nextGuides = snap.guides;
      }
      moved = { ...drag.startBBox, x: drag.startBBox.x + dx, y: drag.startBBox.y + dy };
      result = moved;
      targets = shiftBoxes(drag.startBoxes, dx, dy);
    }
    drag.moved = true;
    drag.lastResult = result;
    drag.lastTargets = targets;
    // The outline, handles and guides are put on the page right now, in the same frame as the picture (not a render later), so they never
    // trail the layer, however fast it is dragged.
    const between = distances(result, othersOf(new Set(drag.startBoxes.keys())));
    flushSync(() => {
      setLive(targets);
      setLiveOutline(result);
      setGuides(nextGuides);
      setGaps(between);
    });
    // The picture follows from the pieces; only if the design cannot be split is every move written.
    if (drag.preview === "ready") setDragLive({ from: drag.startBBox, to: result });
    else if (drag.preview === "off") write(withBoxes(drag.params, latest.current.placed, atRest(targets, latest.current.boxes, latest.current.resting)), drag.corner ? "Resize layers" : "Move layers", drag.group);
  };

  // `selected` is passed in because the selection state may not have caught up with a click that has just changed it.
  const begin = (event: React.PointerEvent, selected: readonly string[], corner: Corner | null, soloOnUp: string | null, removeOnUp: string | null): void => {
    const surface = surfaceRef.current;
    const start = fromClient(event.clientX, event.clientY);
    const { boxes: all, layers: list, drawn: set, params: base } = latest.current;
    if (!surface || !start) return;
    const ids = leavesOf(list, selected, set).filter((id) => !latest.current.locked.has(id));
    if (ids.length === 0) return;
    const startBoxes = new Map<string, Box>();
    for (const id of ids) {
      const box = all.get(id);
      if (box) startBoxes.set(id, box);
    }
    const shown: Box[] = [];
    for (const id of startBoxes.keys()) {
      const box = latest.current.visible.get(id);
      if (box) shown.push(box);
    }
    const startBBox = union(shown) ?? union([...startBoxes.values()]);
    if (!startBBox) return;
    dragRef.current = {
      corner,
      group: createControlHistoryGroupId("canvas-edit"),
      lines: snapLines(othersOf(new Set(ids)), artboardBox()),
      moved: false,
      params: base as Record<string, unknown>,
      pointerId: event.pointerId,
      removeOnUp,
      soloOnUp,
      start,
      startBBox,
      startBoxes,
      startClient: { x: event.clientX, y: event.clientY },
      preview: "pending",
      lastResult: null,
      lastTargets: null,
    };
    const started = dragRef.current;
    setHover(null);
    surface.setPointerCapture(event.pointerId);
    void beginDragPreview([...startBoxes.keys()]).then((ready) => {
      const current = dragRef.current;
      if (current !== started) return;
      current.preview = ready ? "ready" : "off";
      if (ready && current.lastResult) setDragLive({ from: current.startBBox, to: current.lastResult });
      else if (!ready && current.lastTargets) write(withBoxes(current.params, latest.current.placed, atRest(current.lastTargets, latest.current.boxes, latest.current.resting)), current.corner ? "Resize layers" : "Move layers", current.group);
    });
  };

  const panning = (): boolean => {
    const viewport = surfaceRef.current?.closest<HTMLElement>('[data-slot="toolcraft-runtime-canvas"]');
    return viewport !== null && viewport !== undefined && viewport.dataset.canvasPanState !== undefined && viewport.dataset.canvasPanState !== "idle";
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || panning() || editing) return;
    const current = latest.current.selection;
    // Where the layers cannot be edited on the artboard (nothing drawn yet, it plays, a camera, a landing page ...) the artboard can still
    // be selected and a marquee drawn on it.
    if (!latest.current.enabled) {
      event.preventDefault();
      marqueeRef.current = { base: event.shiftKey ? current : [], moved: false, pointerId: event.pointerId, shift: event.shiftKey, startClient: { x: event.clientX, y: event.clientY } };
      surfaceRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-corner]") : null;
    if (handle) {
      event.preventDefault();
      begin(event, current, handle.dataset.corner as Corner, null, null);
      return;
    }
    const point = fromClient(event.clientX, event.clientY);
    if (!point) return;
    const { boxes: all, pickable: order, layers: list, drawn: set } = latest.current;
    const hit = hitTest(order, latest.current.visible, point);
    event.preventDefault();
    if (hit === null) {
      // Empty artboard: a click selects the artboard (and lets go of any layers; Shift keeps them), a drag draws a marquee that
      // selects the layers it touches (Shift adds to the ones already selected).
      marqueeRef.current = { base: event.shiftKey ? current : [], moved: false, pointerId: event.pointerId, shift: event.shiftKey, startClient: { x: event.clientX, y: event.clientY } };
      surfaceRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    const inside = leavesOf(list, current, set).includes(hit);
    if (event.shiftKey) {
      if (inside) {
        // Pressed again: a click removes it from the selection; a drag moves the whole selection.
        begin(event, current, null, null, hit);
      } else {
        const next = [...current, hit];
        select(next, hit);
        begin(event, next, null, null, null);
      }
      return;
    }
    if (inside) {
      // Part of the selection: pressing starts moving all of it; a click without a drag keeps just this one.
      begin(event, current, null, current.length > 1 ? hit : null, null);
      return;
    }
    select([hit], hit);
    begin(event, [hit], null, null, null);
  };

  // Right-click: the layer under the pointer (a locked one too) is picked and its menu opens (mo-paste-menu.tsx).
  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (editing || !latest.current.enabled) return;
    const point = fromClient(event.clientX, event.clientY);
    const { pickable: order, visible: shown, topFirst: stack, placed: all } = latest.current;
    // Every layer that paints something, so a locked layer can still be copied or deleted from its menu.
    const everything = point ? stack.filter((id) => all.get(id)?.painted && shown.has(id)) : order;
    const hit = point ? (hitTest(everything, shown, point) ?? hitTest(order, shown, point)) : null;
    const id = hit ?? latest.current.selection[0] ?? null;
    if (id === null) return;
    if (!latest.current.selection.includes(id)) select([id], id);
    window.dispatchEvent(new CustomEvent("mo-layer-menu", { detail: { layerId: id, x: event.clientX, y: event.clientY } }));
  };

  // Artboard px of a pointer place (the surface is as large as the artboard).
  const toArtboard = (clientX: number, clientY: number): Point | null => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const size = latest.current.rect;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return { x: ((clientX - bounds.left) * size.width) / bounds.width, y: ((clientY - bounds.top) * size.height) / bounds.height };
  };

  // The layers a marquee rectangle (artboard px) touches, as design boxes: its four corners are taken into the design's space.
  const marqueeHits = (area: Readonly<{ x0: number; x1: number; y0: number; y1: number }>): string[] => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const size = latest.current.rect;
    if (!bounds) return [];
    const toClient = (x: number, y: number): Point => ({ x: bounds.left + (x * bounds.width) / size.width, y: bounds.top + (y * bounds.height) / size.height });
    const corners = [toClient(area.x0, area.y0), toClient(area.x1, area.y0), toClient(area.x1, area.y1), toClient(area.x0, area.y1)].map((p) => fromClient(p.x, p.y));
    if (corners.some((corner) => corner === null)) return [];
    const points = corners as Point[];
    const x0 = Math.min(...points.map((p) => p.x));
    const y0 = Math.min(...points.map((p) => p.y));
    const x1 = Math.max(...points.map((p) => p.x));
    const y1 = Math.max(...points.map((p) => p.y));
    return layersInRect(latest.current.pickable, latest.current.visible, { h: y1 - y0, w: x1 - x0, x: x0, y: y0 });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const marqueeDrag = marqueeRef.current;
    if (marqueeDrag && marqueeDrag.pointerId === event.pointerId) {
      if (!marqueeDrag.moved && Math.hypot(event.clientX - marqueeDrag.startClient.x, event.clientY - marqueeDrag.startClient.y) < CLICK_SLOP_PX) return;
      marqueeDrag.moved = true;
      const from = toArtboard(marqueeDrag.startClient.x, marqueeDrag.startClient.y);
      const to = toArtboard(event.clientX, event.clientY);
      if (from && to) setMarquee({ x0: Math.min(from.x, to.x), x1: Math.max(from.x, to.x), y0: Math.min(from.y, to.y), y1: Math.max(from.y, to.y) });
      return;
    }
    if (!latest.current.enabled) return;
    const drag = dragRef.current;
    if (drag) {
      if (!drag.moved && Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) < CLICK_SLOP_PX) return;
      pending.current = { alt: event.altKey, client: { x: event.clientX, y: event.clientY }, shift: event.shiftKey };
      if (frame.current === 0) frame.current = requestAnimationFrame(apply);
      return;
    }
    if (editing) return;
    const point = fromClient(event.clientX, event.clientY);
    if (!point) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-corner]") : null;
    if (target) {
      const corner = target.dataset.corner;
      setCursor(corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize");
      setHover(null);
      return;
    }
    const hit = hitTest(latest.current.pickable, latest.current.visible, point);
    setHover(hit);
    setCursor(hit !== null && leavesOf(latest.current.layers, latest.current.selection, latest.current.drawn).includes(hit) ? "move" : "default");
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    const marqueeDrag = marqueeRef.current;
    if (marqueeDrag && marqueeDrag.pointerId === event.pointerId) {
      marqueeRef.current = null;
      surfaceRef.current?.releasePointerCapture(event.pointerId);
      const area = marquee;
      setMarquee(null);
      if (event.type === "pointercancel") return;
      if (marqueeDrag.moved && area) {
        // A marquee: the layers it touches become the selection (added to the old one with Shift); none touched is no layer selected.
        const found = marqueeHits(area);
        const next = [...marqueeDrag.base, ...found.filter((id) => !marqueeDrag.base.includes(id))];
        if (next.length === 0) select([], null);
        else select(next, next[next.length - 1] ?? null);
      } else if (!marqueeDrag.shift) {
        // A click on empty space: the artboard is selected; the inspector then shows the Artboard segment.
        select([], null);
        setArtboardSelected(true);
        // The main layer is the artboard: its row is picked in the Layers panel too.
        if (latest.current.mainId !== null) {
          notePickedLayer();
          dispatch({ layerId: latest.current.mainId, type: "layers.select" });
        }
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // A move still waiting for its frame is applied now, at the pointer's last place, so the layer ends exactly where it was let go.
    if (frame.current !== 0) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = { alt: event.altKey, client: { x: event.clientX, y: event.clientY }, shift: event.shiftKey };
      apply();
    }
    dragRef.current = null;
    surfaceRef.current?.releasePointerCapture(event.pointerId);
    setGuides(NO_GUIDES);
    setGaps([]);
    if (drag.moved) {
      // One write for the whole drag (one undo step), then the design is drawn in full.
      if (drag.lastTargets) write(withBoxes(drag.params, latest.current.placed, atRest(drag.lastTargets, latest.current.boxes, latest.current.resting)), drag.corner ? "Resize layers" : "Move layers", drag.group);
      endDragPreview();
      // The outline hands over from the live boxes to the stored values once those have been drawn.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setLive(null);
          setLiveOutline(null);
        }),
      );
      return;
    }
    endDragPreview();
    // A click, not a drag.
    if (drag.removeOnUp !== null) {
      const next = latest.current.selection.filter((id) => id !== drag.removeOnUp);
      if (next.length === 0) select([], null);
      else select(next, next[next.length - 1] ?? null);
    } else if (drag.soloOnUp !== null) {
      select([drag.soloOnUp], drag.soloOnUp);
    }
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!latest.current.enabled) return;
    const { boxes: all, pickable: order, spec: current, params: base, placed: all2, frameTransform: t } = latest.current;
    const point = fromClient(event.clientX, event.clientY);
    if (!point || !current) return;
    const hit = hitTest(order, latest.current.visible, point);
    const item = hit ? findFigmaItem(current, hit) : null;
    const text = item?.text;
    if (!hit || !item || !text) return;
    // A text whose font this computer does not have shows as a picture and cannot be retyped.
    const missing = new Set(text.missing ?? []);
    if (textFonts(text).some((font) => missing.has(fontKey(font)))) return;
    const edits = (base[TEXT_EDITS_KEY] ?? {}) as Readonly<Record<string, TextEdit>>;
    const edit = edits[hit] ?? {};
    const own = { ...text, ...edit };
    const box = all.get(hit);
    const at = all2.get(hit);
    if (!box || !at) return;
    const corners = [toCss({ x: box.x, y: box.y }), toCss({ x: box.x + box.w, y: box.y }), toCss({ x: box.x + box.w, y: box.y + box.h }), toCss({ x: box.x, y: box.y + box.h })];
    const left = Math.min(...corners.map((c) => c.x));
    const top = Math.min(...corners.map((c) => c.y));
    const right = Math.max(...corners.map((c) => c.x));
    const bottom = Math.max(...corners.map((c) => c.y));
    const size = Math.max(6, own.size * at.k * (t.scale / 100));
    const multiline = own.chars.includes("\n") || (text.resize ? text.resize !== "WIDTH_AND_HEIGHT" : own.chars.length > 48);
    setEditing({
      box: { h: bottom - top, w: right - left, x: left, y: top },
      id: hit,
      initial: own.chars,
      multiline,
      style: {
        ...editorColors(own.color),
        fontFamily: `"${own.family}", system-ui, sans-serif`,
        fontSize: size,
        fontWeight: own.weight,
        letterSpacing: own.ls ? own.ls * at.k * (t.scale / 100) : undefined,
        lineHeight: own.lh ? `${own.lh * at.k * (t.scale / 100)}px` : 1.25,
        textAlign: own.align === "CENTER" ? "center" : own.align === "RIGHT" ? "right" : "left",
      },
    });
    select([hit], hit);
  };

  const commitText = (value: string): void => {
    const current = editing;
    setEditing(null);
    if (!current || value === current.initial) return;
    const { params: base } = latest.current;
    const edits = (base[TEXT_EDITS_KEY] ?? {}) as Readonly<Record<string, TextEdit>>;
    dispatch({
      label: "Edit text",
      target: ANIMATION_PARAMS_TARGET,
      type: "controls.setValue",
      value: { ...base, [TEXT_EDITS_KEY]: { ...edits, [current.id]: { ...(edits[current.id] ?? {}), chars: value } } },
    });
  };

  // Delete or Backspace removes the selected layers; Escape lets go of them.
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      // Keys meant for a panel (a timeline bar, a Layers row, an inspector field) or an open menu or dialog are theirs.
      if (event.target instanceof Element && event.target.closest(KEY_OWNERS)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      const { selection: current } = latest.current;
      if (current.length === 0) return;
      if (event.key === "Escape") {
        select([], null);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      for (const id of current) dispatch({ layerId: id, type: "layers.delete" });
      select([], null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, enabled]);

  React.useEffect(() => {
    if (!enabled) {
      dragRef.current = null;
      setEditing(null);
      setHover(null);
      setGuides(NO_GUIDES);
      setGaps([]);
      setLive(null);
      setLiveOutline(null);
      endDragPreview();
    }
  }, [enabled]);

  // Every project gets the surface: the artboard can be selected and a marquee drawn on it. Editing layers needs a plain, still design.

  const scale = Math.max(0.01, zoom / 100);
  const px = (value: number): number => value / scale;
  const polygon = (box: Box): string => [toCss({ x: box.x, y: box.y }), toCss({ x: box.x + box.w, y: box.y }), toCss({ x: box.x + box.w, y: box.y + box.h }), toCss({ x: box.x, y: box.y + box.h })].map((p) => `${p.x},${p.y}`).join(" ");
  // No hover box while a layer is being dragged: it would stay at the place the layer was hovered at, behind the moving outline.
  const dragging = live !== null || liveOutline !== null || dragRef.current !== null;
  const hoverBox = !dragging && hover !== null && !leaves.includes(hover) ? boxes.get(hover) : undefined;
  const artboard = artboardBox();
  const lineSegment = (axis: "x" | "y", at: number): [Point, Point] =>
    axis === "x" ? [toCss({ x: at, y: artboard.y }), toCss({ x: at, y: artboard.y + artboard.h })] : [toCss({ x: artboard.x, y: at }), toCss({ x: artboard.x + artboard.w, y: at })];

  return (
    <div
      className={styles.surface}
      data-mo-canvas-edit=""
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onPointerCancel={finish}
      onPointerDown={onPointerDown}
      onPointerLeave={() => dragRef.current === null && setHover(null)}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      ref={surfaceRef}
      style={{ cursor }}
    >
      {world ? (
        createPortal(
          <svg
            aria-hidden="true"
            className={styles.svg}
            data-mo-layer-selection=""
            height={rect.height}
            style={{ inset: "auto", left: -rect.width / 2, top: -rect.height / 2, zIndex: 15 }}
            width={rect.width}
          >
        {hoverBox ? <polygon className={styles.hover} points={polygon(hoverBox)} /> : null}
        {[...selectionBoxes.values()].map((box, index) => (selection.length > 1 ? <polygon className={styles.member} key={index} points={polygon(box)} /> : null))}
        {outline ? <polygon className={styles.outline} points={polygon(outline)} /> : null}
        {marquee ? (
          <rect fill="rgba(13, 153, 255, 0.12)" height={marquee.y1 - marquee.y0} stroke={SELECT} strokeWidth={px(1)} width={marquee.x1 - marquee.x0} x={marquee.x0} y={marquee.y0} />
        ) : null}
        {guides.x.map((at) => {
          const [a, b] = lineSegment("x", at);
          return <line className={styles.guide} key={`gx${at}`} stroke={GUIDE} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
        })}
        {guides.y.map((at) => {
          const [a, b] = lineSegment("y", at);
          return <line className={styles.guide} key={`gy${at}`} stroke={GUIDE} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
        })}
        {gaps.map((gap, index) => {
          const a = toCss(gap.from);
          const b = toCss(gap.to);
          const width = px(8 + gap.label.length * 6.5);
          const height = px(16);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={index}>
              <line className={styles.guide} stroke={GUIDE} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
              <rect fill={GUIDE} height={height} rx={px(3)} width={width} x={mid.x - width / 2} y={mid.y - height / 2} />
              <text className={styles.label} fill="#fff" fontSize={px(11)} textAnchor="middle" x={mid.x} y={mid.y + px(4)}>
                {gap.label}
              </text>
            </g>
          );
        })}
        {outline && !editing && enabled
          ? CORNERS.map((corner) => {
              const at = toCss({ x: corner === "nw" || corner === "sw" ? outline.x : outline.x + outline.w, y: corner === "nw" || corner === "ne" ? outline.y : outline.y + outline.h });
              const size = px(HANDLE);
              return (
                <rect
                  className={styles.handle}
                  data-corner={corner}
                  fill="#fff"
                  height={size}
                  key={corner}
                  stroke={SELECT}
                  strokeWidth={px(1)}
                  width={size}
                  x={at.x - size / 2}
                  y={at.y - size / 2}
                />
              );
            })
          : null}
                </svg>,
          world,
        )
      ) : (
        <svg aria-hidden="true" className={styles.svg} height={rect.height} width={rect.width}>
        {hoverBox ? <polygon className={styles.hover} points={polygon(hoverBox)} /> : null}
        {[...selectionBoxes.values()].map((box, index) => (selection.length > 1 ? <polygon className={styles.member} key={index} points={polygon(box)} /> : null))}
        {outline ? <polygon className={styles.outline} points={polygon(outline)} /> : null}
        {marquee ? (
          <rect fill="rgba(13, 153, 255, 0.12)" height={marquee.y1 - marquee.y0} stroke={SELECT} strokeWidth={px(1)} width={marquee.x1 - marquee.x0} x={marquee.x0} y={marquee.y0} />
        ) : null}
        {guides.x.map((at) => {
          const [a, b] = lineSegment("x", at);
          return <line className={styles.guide} key={`gx${at}`} stroke={GUIDE} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
        })}
        {guides.y.map((at) => {
          const [a, b] = lineSegment("y", at);
          return <line className={styles.guide} key={`gy${at}`} stroke={GUIDE} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />;
        })}
        {gaps.map((gap, index) => {
          const a = toCss(gap.from);
          const b = toCss(gap.to);
          const width = px(8 + gap.label.length * 6.5);
          const height = px(16);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={index}>
              <line className={styles.guide} stroke={GUIDE} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
              <rect fill={GUIDE} height={height} rx={px(3)} width={width} x={mid.x - width / 2} y={mid.y - height / 2} />
              <text className={styles.label} fill="#fff" fontSize={px(11)} textAnchor="middle" x={mid.x} y={mid.y + px(4)}>
                {gap.label}
              </text>
            </g>
          );
        })}
        {outline && !editing && enabled
          ? CORNERS.map((corner) => {
              const at = toCss({ x: corner === "nw" || corner === "sw" ? outline.x : outline.x + outline.w, y: corner === "nw" || corner === "ne" ? outline.y : outline.y + outline.h });
              const size = px(HANDLE);
              return (
                <rect
                  className={styles.handle}
                  data-corner={corner}
                  fill="#fff"
                  height={size}
                  key={corner}
                  stroke={SELECT}
                  strokeWidth={px(1)}
                  width={size}
                  x={at.x - size / 2}
                  y={at.y - size / 2}
                />
              );
            })
          : null}
              </svg>
      )}
      {editing ? (
        <EditBox editing={editing} onCancel={() => setEditing(null)} onCommit={commitText} />
      ) : null}
      {artboardSelected && selection.length === 0 && world
        ? createPortal(
            <svg
              aria-hidden="true"
              data-mo-artboard-selection=""
              height={rect.height}
              style={{ left: -rect.width / 2, overflow: "visible", pointerEvents: "none", position: "absolute", top: -rect.height / 2, zIndex: 15 }}
              width={rect.width}
            >
              <rect fill="none" height={rect.height} stroke={ARTBOARD_SELECT} strokeWidth={px(1)} width={rect.width} x={0} y={0} />
              {[
                [0, 0],
                [rect.width, 0],
                [rect.width, rect.height],
                [0, rect.height],
              ].map(([x, y]) => (
                <rect fill="#fff" height={px(HANDLE)} key={`${x}-${y}`} stroke={ARTBOARD_SELECT} strokeWidth={px(1)} width={px(HANDLE)} x={(x ?? 0) - px(HANDLE) / 2} y={(y ?? 0) - px(HANDLE) / 2} />
              ))}
            </svg>,
            world,
          )
        : null}
    </div>
  );
}

function EditBox({ editing, onCancel, onCommit }: Readonly<{ editing: Editing; onCancel: () => void; onCommit: (value: string) => void }>): React.JSX.Element {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = React.useState(editing.initial);
  const done = React.useRef(false);
  React.useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus();
    field.select();
  }, []);
  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <textarea
      className={styles.editor}
      data-mo-canvas-text=""
      onBlur={() => finish(true)}
      onChange={(event) => setValue(event.target.value)}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        } else if (event.key === "Enter" && (!editing.multiline || event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish(true);
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      ref={ref}
      rows={1}
      spellCheck={false}
      style={{ ...editing.style, whiteSpace: editing.multiline ? "pre-wrap" : "pre", height: Math.max(editing.box.h, 24), left: editing.box.x, minWidth: 40, top: editing.box.y, width: Math.max(editing.box.w, 40) }}
      value={value}
    />
  );
}
