import * as React from "react";

// What the bottom timeline shows: All (the full motion, scene by scene, with a row each for the camera, the Reactor, the video and the
// music) or one scene (its layer effects, camera and Reactor items, each on a row that can be dragged to retime).
export type TimelineView = "all" | "scene";

let view: TimelineView = "all";
const listeners = new Set<() => void>();

export function setTimelineView(next: TimelineView): void {
  if (next === view) return;
  view = next;
  // A new view starts fully zoomed out, with no scene picked on the All timeline.
  zoom = ZOOM_OUT;
  sceneFilter = false;
  for (const listener of listeners) listener();
  for (const listener of zoomListeners) listener();
}

export function useTimelineView(): TimelineView {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
    () => "all" as const,
  );
}

// Sent while the timeline is being resized, so what sits above it (the scenes strip) follows at once.
export const TIMELINE_LAYOUT_EVENT = "mo-timeline-layout";

// Zoom of the time shown in the timeline's keyframe area and the scenes strip: the visible window is `1 / zoom` of the whole range and
// starts at `start` (a fraction of the range, 0 to 1 - 1 / zoom). Both read it from here, so they always show the same time.
export type TimelineZoom = Readonly<{ start: number; zoom: number }>;
const ZOOM_OUT: TimelineZoom = { start: 0, zoom: 1 };
export const MAX_ZOOM = 40;
let zoom: TimelineZoom = ZOOM_OUT;
const zoomListeners = new Set<() => void>();

function setZoom(next: TimelineZoom): void {
  if (Math.abs(next.zoom - zoom.zoom) < 1e-6 && Math.abs(next.start - zoom.start) < 1e-6) return;
  zoom = next;
  for (const listener of zoomListeners) listener();
}

export function resetTimelineZoom(): void {
  setZoom(ZOOM_OUT);
}

// Zooms by `factor` keeping the time under the pointer (`at`: 0 to 1 across the visible window) where it is.
export function zoomTimelineAt(at: number, factor: number): void {
  const nextZoom = Math.min(MAX_ZOOM, Math.max(1, zoom.zoom * factor));
  const anchor = zoom.start + Math.min(1, Math.max(0, at)) / zoom.zoom;
  const start = Math.min(1 - 1 / nextZoom, Math.max(0, anchor - Math.min(1, Math.max(0, at)) / nextZoom));
  setZoom({ start: nextZoom <= 1 ? 0 : start, zoom: nextZoom });
}

// Puts the window's start at a fraction of the whole range (the sideways scroll bar).
export function setTimelineStart(start: number): void {
  setZoom({ start: Math.min(1 - 1 / zoom.zoom, Math.max(0, start)), zoom: zoom.zoom });
}

// Slides the visible window by a fraction of itself.
export function panTimeline(byWindows: number): void {
  if (zoom.zoom <= 1) return;
  setZoom({ start: Math.min(1 - 1 / zoom.zoom, Math.max(0, zoom.start + byWindows / zoom.zoom)), zoom: zoom.zoom });
}

export function useTimelineZoom(): TimelineZoom {
  return React.useSyncExternalStore(
    (listener) => {
      zoomListeners.add(listener);
      return () => zoomListeners.delete(listener);
    },
    () => zoom,
    () => ZOOM_OUT,
  );
}

// Ctrl / Cmd + wheel (a pinch on a trackpad) zooms around the pointer; a sideways wheel or Shift + wheel slides the window.
export function handleTimelineWheel(event: WheelEvent, windowBox: DOMRect): void {
  const at = windowBox.width > 0 ? (event.clientX - windowBox.left) / windowBox.width : 0;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    zoomTimelineAt(at, Math.exp(-event.deltaY * 0.005));
  } else if (zoom.zoom > 1 && (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey)) {
    event.preventDefault();
    panTimeline((Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) / Math.max(1, windowBox.width));
  }
}

// The Animations tab card that goes with the bar picked in the timeline (its name, e.g. "Step 2 · Slide in"): it opens while the bar is
// picked and folds again when the bar is let go.
let pickedCard: string | null = null;
const cardListeners = new Set<() => void>();

export function setPickedCard(next: string | null): void {
  if (next === pickedCard) return;
  pickedCard = next;
  for (const listener of cardListeners) listener();
}

export function usePickedCard(): string | null {
  return React.useSyncExternalStore(
    (listener) => {
      cardListeners.add(listener);
      return () => cardListeners.delete(listener);
    },
    () => pickedCard,
    () => null,
  );
}

export const CAMERA_CARD = "Camera · Zoom, angle, tilt";

// With All shown, a scene picked on the timeline (one click on its bar) narrows the Motion Plan (Interaction Segment and Animations) to that scene.
let sceneFilter = false;
const filterListeners = new Set<() => void>();

export function setSceneFilter(next: boolean): void {
  if (next === sceneFilter) return;
  sceneFilter = next;
  for (const listener of filterListeners) listener();
}

export function useSceneFilter(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      filterListeners.add(listener);
      return () => filterListeners.delete(listener);
    },
    () => sceneFilter,
    () => false,
  );
}

// Preview only: the video layers show one still picture (no decoding while it plays or is scrubbed) or play. Kept for the viewer (this browser).
const VIDEO_STILL_KEY = "mo.preview.videoStill";
let videoStill = ((): boolean => {
  try {
    return window.localStorage.getItem(VIDEO_STILL_KEY) === "1";
  } catch {
    return false;
  }
})();
const stillListeners = new Set<() => void>();

export function setVideoStill(next: boolean): void {
  if (next === videoStill) return;
  videoStill = next;
  try {
    window.localStorage.setItem(VIDEO_STILL_KEY, next ? "1" : "0");
  } catch {
    // The choice just is not kept.
  }
  for (const listener of stillListeners) listener();
}

export function useVideoStill(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      stillListeners.add(listener);
      return () => stillListeners.delete(listener);
    },
    () => videoStill,
    () => false,
  );
}
