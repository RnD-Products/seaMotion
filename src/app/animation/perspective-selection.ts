import * as React from "react";

import type { PerspectiveCorner } from "./frame-transform";

let selectedCorner: PerspectiveCorner = "topLeft";
const listeners = new Set<() => void>();
let pinsVisible = false;
const visibilityListeners = new Set<() => void>();

export function selectPerspectiveCorner(corner: PerspectiveCorner): void {
  if (corner === selectedCorner) return;
  selectedCorner = corner;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PerspectiveCorner {
  return selectedCorner;
}

export function useSelectedPerspectiveCorner(): PerspectiveCorner {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setPerspectivePinsVisible(visible: boolean): void {
  if (visible === pinsVisible) return;
  pinsVisible = visible;
  for (const listener of visibilityListeners) listener();
}

function subscribeVisibility(listener: () => void): () => void {
  visibilityListeners.add(listener);
  return () => visibilityListeners.delete(listener);
}

function getVisibilitySnapshot(): boolean {
  return pinsVisible;
}

export function usePerspectivePinsVisible(): boolean {
  return React.useSyncExternalStore(subscribeVisibility, getVisibilitySnapshot, getVisibilitySnapshot);
}
