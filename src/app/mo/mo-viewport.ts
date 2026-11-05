import * as React from "react";
import { useToolcraftDispatch } from "@/toolcraft/runtime/react";

import { getSceneRect, type SceneRect as MoSceneRect } from "../animation/scene-rect";

const VIEWPORT_SELECTOR = '[data-slot="toolcraft-runtime-canvas"]';
const CONTROLS_PANEL_SELECTOR = '[data-slot="toolcraft-runtime-panel-host"][data-panel-type="controls"]';
const SIDEBAR_SELECTOR = '[data-mo-app-sidebar]';
const CENTER_BUTTON_SELECTOR = 'button[aria-label="Center canvas"]';
const CENTERED_PANEL_IDS = ["timeline", "toolbar", "controls"] as const;
type CenteredPanelId = (typeof CENTERED_PANEL_IDS)[number];
// Breathing room between the scene and whatever surrounds it.
const FIT_MARGIN = 24;
const PANEL_SETTLE_FRAMES = 30;
// Height of the ratio bar plus its gap above the artboard.
export const RATIO_BAR_BAND = 52;
const ZOOM_MIN = 25;
const ZOOM_MAX = 800;

type Viewport = { offset: { x: number; y: number }; zoom: number };

type FreeArea = { bottom: number; bounds: DOMRect; left: number; right: number; top: number };

// Below this width or height the panels would leave no room, so they are ignored (small screens).
const MIN_FREE_SIZE = 160;

function overlaps(rect: DOMRect, bounds: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
}

// The part of the viewport that no panel covers: clear of the project sidebar and the inspector
// on whichever side they sit, and of the toolbar above and the playback bar below.
function getFreeArea(viewport: HTMLElement): FreeArea | null {
  const bounds = viewport.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const document = viewport.ownerDocument;
  let left = bounds.left;
  let right = bounds.right;
  const middle = bounds.left + bounds.width / 2;
  const sides = [
    document.querySelector(SIDEBAR_SELECTOR)?.getBoundingClientRect(),
    document.querySelector(CONTROLS_PANEL_SELECTOR)?.getBoundingClientRect(),
  ];
  for (const panel of sides) {
    if (!panel || !overlaps(panel, bounds)) continue;
    // A side panel pushes the free area away from the edge it is nearest to.
    if (panel.left + panel.width / 2 > middle) right = Math.min(right, panel.left - PANEL_EDGE_MARGIN);
    else left = Math.max(left, panel.right + PANEL_EDGE_MARGIN);
  }
  // On a narrow screen the panels can cover everything; then the whole viewport is used.
  if (right - left < MIN_FREE_SIZE) {
    left = bounds.left;
    right = bounds.right;
  }
  let top = bounds.top;
  let bottom = bounds.bottom;
  const timeline = findPanel(viewport, "timeline")?.getBoundingClientRect();
  // The ratio bar sits just above the artboard, so the fitted scene leaves room for it at the top.
  top = bounds.top + RATIO_BAR_BAND;
  // The playback bar sits on the bottom edge, so its height sets the margin whatever its offset is.
  // The toolbar sits at the top right beside the inspector, level with the ratio bar, and reserves nothing.
  if (timeline && timeline.height > 0) bottom = bounds.bottom - timeline.height - PANEL_EDGE_MARGIN;
  // The scenes strip sits just above the playback bar, so the scene leaves room for it too.
  const strip = viewport.ownerDocument.querySelector<HTMLElement>("[data-mo-scenes-strip]")?.getBoundingClientRect();
  if (strip && strip.height > 0) bottom -= strip.height + PANEL_EDGE_MARGIN;
  if (bottom - top < MIN_FREE_SIZE) {
    top = bounds.top;
    bottom = bounds.bottom;
  }
  return { bottom, bounds, left, right, top };
}

// Fits the scene into the free area and centers it there.
function getFittedViewport(viewport: HTMLElement, rect: MoSceneRect): Viewport | null {
  const area = getFreeArea(viewport);
  if (!area || rect.width <= 0 || rect.height <= 0) return null;
  const { bottom, bounds, left, right, top } = area;
  const freeWidth = Math.max(1, right - left - FIT_MARGIN * 2);
  const freeHeight = Math.max(1, bottom - top - FIT_MARGIN * 2);
  const fit = Math.floor(Math.min(freeWidth / rect.width, freeHeight / rect.height) * 100);
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit));
  const scale = zoom / 100;
  // World origin sits at the viewport center; offsets are screen pixels from there.
  return {
    offset: {
      x: (left + right) / 2 - (bounds.left + bounds.width / 2) - (rect.x + rect.width / 2) * scale,
      y: (top + bottom) / 2 - (bounds.top + bounds.height / 2) - (rect.y + rect.height / 2) * scale,
    },
    zoom,
  };
}

// The inspector keeps the edge it is snapped to (its patch has no snap edge).
function placementPatch(placement: PanelPlacement): { offset: PanelPlacement["offset"]; snapEdge?: PanelPlacement["snapEdge"] } {
  return placement.panelId === "controls" ? { offset: placement.offset } : { offset: placement.offset, snapEdge: placement.snapEdge };
}

type PanelPlacement = {
  offset: Viewport["offset"];
  panelId: CenteredPanelId;
  snapEdge: "bottom" | "top" | undefined;
};

const PANEL_EDGE_MARGIN = 10;
const PANEL_SNAP_EDGE: Record<CenteredPanelId, "bottom" | "top"> = { controls: "top", timeline: "bottom", toolbar: "top" };
// The toolbar used to sit above the inspector in its column, which started this far below the top edge. The toolbar is hidden now (its
// zoom, theme and Center canvas are in the left rail), so the inspector starts at the top, level with the left panels.
const TOOLBAR_BAND = 0;

function findPanel(viewport: HTMLElement, panelId: CenteredPanelId): HTMLElement | null {
  return viewport.ownerDocument.querySelector<HTMLElement>(
    `[data-slot="toolcraft-runtime-panel-host"][data-panel-type="${panelId}"]`,
  );
}

// Playback sits on the bottom edge and the toolbar (undo, redo, zoom) on the top edge at the right, both in the
// area beside the inspector. Offsets are relative to each panel's default position.
function getPanelPlacement(
  viewport: HTMLElement,
  area: FreeArea,
  panelId: CenteredPanelId,
): PanelPlacement | null {
  const panel = findPanel(viewport, panelId);
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const currentY = Number(panel.dataset.panelOffsetY);
  const offsetY = Number.isFinite(currentY) ? currentY : 0;
  const defaultTop = rect.top - area.bounds.top - offsetY;
  const snapEdge = PANEL_SNAP_EDGE[panelId];
  const desiredTop =
    snapEdge === "bottom" ? area.bounds.height - rect.height : PANEL_EDGE_MARGIN;
  if (panelId === "controls") {
    // The inspector starts below the toolbar when it is on the right; its height follows (styles.css, --mo-toolbar-band).
    const currentX = Number(panel.dataset.panelOffsetX);
    const onRight = rect.left + rect.width / 2 > area.bounds.left + area.bounds.width / 2;
    viewport.ownerDocument.documentElement.style.setProperty("--mo-toolbar-band", onRight ? `${TOOLBAR_BAND}px` : "0px");
    viewport.ownerDocument.documentElement.style.setProperty("--mo-column-width", onRight ? `${Math.round(rect.width)}px` : "auto");
    return { offset: { x: Number.isFinite(currentX) ? currentX : 0, y: onRight ? TOOLBAR_BAND : 0 }, panelId, snapEdge: undefined };
  }
  if (panelId === "toolbar") {
    // Top edge, right-aligned in the free area (just left of the inspector). A free placement:
    // an edge snap would pull it back to the middle.
    const currentX = Number(panel.dataset.panelOffsetX);
    const defaultLeft = rect.left - (Number.isFinite(currentX) ? currentX : 0);
    // Above the inspector, in its column, when the inspector is on the right; otherwise just left of it.
    const inspector = viewport.ownerDocument.querySelector<HTMLElement>(CONTROLS_PANEL_SELECTOR)?.getBoundingClientRect();
    const above = inspector !== undefined && inspector.width > 0 && inspector.left + inspector.width / 2 > area.bounds.left + area.bounds.width / 2;
    // Over the inspector it is as wide as the inspector (styles.css, --mo-column-width), so its left edge is the inspector's.
    const x = above && inspector ? inspector.left - defaultLeft : area.right - rect.width - defaultLeft;
    return { offset: { x, y: PANEL_EDGE_MARGIN - defaultTop }, panelId, snapEdge: undefined };
  }
  // Playback sits at the bottom, in the middle of the free area between the project sidebar and the inspector.
  const defaultLeft = rect.left - (Number.isFinite(Number(panel.dataset.panelOffsetX)) ? Number(panel.dataset.panelOffsetX) : 0);
  const x = (area.left + area.right) / 2 - rect.width / 2 - defaultLeft;
  return { offset: { x, y: desiredTop - defaultTop }, panelId, snapEdge };
}

function getPanelPlacements(viewport: HTMLElement): PanelPlacement[] {
  const area = getFreeArea(viewport);
  if (!area) return [];
  return CENTERED_PANEL_IDS.flatMap((panelId) => {
    const placement = getPanelPlacement(viewport, area, panelId);
    return placement ? [placement] : [];
  });
}

/** Fits and centers the scene on open/reload, puts the toolbar on top and playback at the bottom beside the inspector, and pans the canvas while the middle mouse button is held. */
export function useMoViewport(
  anchorRef: React.RefObject<HTMLElement | null>,
  rect: MoSceneRect | null,
): void {
  const dispatch = useToolcraftDispatch();
  const fittedRef = React.useRef(false);
  // Set once the user pans or zooms themselves; until then the scene is kept centered on resize.
  const movedRef = React.useRef(false);

  const rectRef = React.useRef(rect);
  rectRef.current = rect;
  const rectReady = rect !== null;

  React.useEffect(() => {
    if (fittedRef.current || !rectReady) return;
    const viewport = anchorRef.current?.closest<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;
    // The inspector mounts and settles at its restored position a few frames after the canvas.
    let frame = 0;
    let attempts = 0;
    let lastPanelLeft: number | null = null;
    const tryFit = (): void => {
      attempts += 1;
      const panel = viewport.ownerDocument.querySelector(CONTROLS_PANEL_SELECTOR);
      const panelLeft = panel ? panel.getBoundingClientRect().left : null;
      const settled = panelLeft !== null && panelLeft === lastPanelLeft;
      lastPanelLeft = panelLeft;
      if (!settled && attempts < PANEL_SETTLE_FRAMES) {
        frame = requestAnimationFrame(tryFit);
        return;
      }
      const fitted = rectRef.current ? getFittedViewport(viewport, rectRef.current) : null;
      if (!fitted) return;
      fittedRef.current = true;
      dispatch({ ...fitted, type: "canvas.setViewport" });
      const place = (): void => {
        for (const placement of getPanelPlacements(viewport)) {
          dispatch({
            panelId: placement.panelId,
            patch: placementPatch(placement),
            type: "panels.update",
          });
        }
      };
      place();
      // The panels settle a moment after the canvas (the toolbar is measured where it stands), so they are placed again once they have.
      for (const delay of [250, 700, 1200, 2000, 3200]) later.push(window.setTimeout(place, delay));
    };
    const later: number[] = [];
    frame = requestAnimationFrame(tryFit);
    return () => {
      cancelAnimationFrame(frame);
      for (const timer of later) window.clearTimeout(timer);
    };
  }, [anchorRef, dispatch, rectReady]);

  // Keeps playback on the bottom edge, in the middle, when it grows (extended timeline) or the window resizes.
  // Panels the user has dragged to another edge are left alone.
  React.useEffect(() => {
    const viewport = anchorRef.current?.closest<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;
    // The timeline sits on the bottom edge by CSS (styles.css); only its place across is worked out here: the middle of the free area
    // between the project sidebar and the inspector, as a CSS variable.
    const centre = (): void => {
      const panel = findPanel(viewport, "timeline");
      const area = getFreeArea(viewport);
      if (!panel || !area) return;
      const root = viewport.ownerDocument.documentElement;
      const rect = panel.getBoundingClientRect();
      if (rect.width <= 0) return;
      const applied = Number.parseFloat(root.style.getPropertyValue("--mo-timeline-x")) || 0;
      const x = Math.round((area.left + area.right) / 2 - rect.width / 2 - (rect.left - applied));
      if (Math.abs(x - applied) > 0.5 || !root.style.getPropertyValue("--mo-timeline-x")) root.style.setProperty("--mo-timeline-x", `${x}px`);
    };
    // The toolbar (undo, redo, zoom) sits on the top edge by CSS as well; across, it is over the inspector (as wide as it) or, when the
    // inspector is on the left half, just left of it. Worked out here so a window resize needs no jump to a default place and back.
    const placeToolbar = (): void => {
      const toolbar = findPanel(viewport, "toolbar");
      const area = getFreeArea(viewport);
      const inspector = viewport.ownerDocument.querySelector<HTMLElement>(CONTROLS_PANEL_SELECTOR)?.getBoundingClientRect();
      if (!toolbar || !area) return;
      const root = viewport.ownerDocument.documentElement;
      const rect = toolbar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const over = inspector !== undefined && inspector.width > 0 && inspector.left + inspector.width / 2 > area.bounds.left + area.bounds.width / 2;
      root.style.setProperty("--mo-column-width", over && inspector ? `${Math.round(inspector.width)}px` : "auto");
      root.style.setProperty("--mo-toolbar-band", over ? `${TOOLBAR_BAND}px` : "0px");
      const applied = Number.parseFloat(root.style.getPropertyValue("--mo-toolbar-x")) || 0;
      const wanted = over && inspector ? inspector.left : area.right - rect.width;
      const x = Math.round(wanted - (rect.left - applied));
      if (Math.abs(x - applied) > 0.5 || !root.style.getPropertyValue("--mo-toolbar-x")) root.style.setProperty("--mo-toolbar-x", `${x}px`);
    };
    const place = (): void => {
      centre();
      placeToolbar();
    };
    place();
    window.addEventListener("resize", place);
    const timer = window.setInterval(place, 250);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, dispatch]);

  // The toolbar's Center canvas button only resets the offset; refit and recenter after it.
  React.useEffect(() => {
    const viewport = anchorRef.current?.closest<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;
    const document = viewport.ownerDocument;
    const handleClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest(CENTER_BUTTON_SELECTOR)) return;
      movedRef.current = false;
      const fitted = rectRef.current ? getFittedViewport(viewport, rectRef.current) : null;
      if (fitted) dispatch({ ...fitted, type: "canvas.setViewport" });
      for (const placement of getPanelPlacements(viewport)) {
        dispatch({
          panelId: placement.panelId,
          patch: placementPatch(placement),
          type: "panels.update",
        });
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [anchorRef, dispatch]);

  // Keeps the scene centered when the window is resized or a device is rotated, until the user
  // moves the canvas themselves.
  React.useEffect(() => {
    const viewport = anchorRef.current?.closest<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;
    const markMoved = (): void => {
      movedRef.current = true;
    };
    viewport.addEventListener("pointerdown", markMoved);
    viewport.addEventListener("wheel", markMoved, { passive: true });
    let frame = 0;
    let settleTimer = 0;
    // Only the scene is fitted here: the panels are placed by CSS (styles.css) and follow a resize by themselves.
    const apply = (): void => {
      if (!fittedRef.current || movedRef.current || !rectRef.current) return;
      const fitted = getFittedViewport(viewport, rectRef.current);
      if (fitted) dispatch({ ...fitted, type: "canvas.setViewport" });
    };
    // While the window or the chat area is being dragged, the scene is fitted on every frame (not after the dragging stops), so it
    // moves with the bars around it instead of standing still and then jumping.
    const refit = (): void => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          apply();
        });
      }
      window.clearTimeout(settleTimer);
      // Once more when it has stopped, with the final positions of the bars.
      settleTimer = window.setTimeout(apply, 300);
    };
    const observer = new ResizeObserver(refit);
    observer.observe(viewport);
    window.addEventListener("orientationchange", refit);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer.disconnect();
      window.removeEventListener("orientationchange", refit);
      viewport.removeEventListener("pointerdown", markMoved);
      viewport.removeEventListener("wheel", markMoved);
    };
  }, [anchorRef, dispatch]);

  React.useEffect(() => {
    const viewport = anchorRef.current?.closest<HTMLElement>(VIEWPORT_SELECTOR);
    if (!viewport) return;
    let drag: { pointerId: number; x: number; y: number } | null = null;
    // The runtime styles every element inside the canvas with the grabbing cursor while this
    // attribute reads "dragging"; setting only the viewport's own cursor lets the artboard and the
    // design on top keep theirs.
    const PAN_ATTRIBUTE = "data-canvas-pan-state";
    let previousState: string | null = null;

    const endDrag = (): void => {
      if (!drag) return;
      if (viewport.hasPointerCapture(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId);
      drag = null;
      if (previousState === null) viewport.removeAttribute(PAN_ATTRIBUTE);
      else viewport.setAttribute(PAN_ATTRIBUTE, previousState);
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 1 || event.pointerType !== "mouse" || drag) return;
      event.preventDefault();
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone; the drag still ends on pointerup.
      }
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      previousState = viewport.getAttribute(PAN_ATTRIBUTE);
      viewport.setAttribute(PAN_ATTRIBUTE, "dragging");
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y };
      if (delta.x === 0 && delta.y === 0) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      dispatch({ delta, type: "canvas.panBy" });
    };
    const handlePointerEnd = (event: PointerEvent): void => {
      if (drag?.pointerId === event.pointerId) endDrag();
    };
    // Stops the browser's middle-click autoscroll from taking over the drag.
    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button === 1) event.preventDefault();
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", handlePointerEnd);
    viewport.addEventListener("pointercancel", handlePointerEnd);
    viewport.addEventListener("lostpointercapture", handlePointerEnd);
    viewport.addEventListener("mousedown", handleMouseDown);
    return () => {
      endDrag();
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerup", handlePointerEnd);
      viewport.removeEventListener("pointercancel", handlePointerEnd);
      viewport.removeEventListener("lostpointercapture", handlePointerEnd);
      viewport.removeEventListener("mousedown", handleMouseDown);
    };
  }, [anchorRef, dispatch]);
}

// Zooms and centers the view so the whole artboard of the given size is visible, as on open.
export function fitCanvasView(
  dispatch: ReturnType<typeof useToolcraftDispatch>,
  size: Readonly<{ height: number; width: number }>,
): void {
  const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
  if (!viewport) return;
  const fitted = getFittedViewport(viewport, getSceneRect(size));
  if (fitted) dispatch({ ...fitted, type: "canvas.setViewport" });
}
