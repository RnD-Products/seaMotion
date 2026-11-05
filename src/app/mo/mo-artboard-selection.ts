import * as React from "react";

// The colour of the artboard's selection (outline, corner handles and the ratio label above it).
export const ARTBOARD_SELECT_COLOR = "#14B8A6";

// Whether the artboard itself is selected on the canvas (a click on empty artboard space). The canvas sets it; the inspector follows it.
let selected = false;
const listeners = new Set<() => void>();

export function setArtboardSelected(next: boolean): void {
  if (selected === next) return;
  selected = next;
  for (const listener of listeners) listener();
}

export function useArtboardSelected(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => selected,
    () => false,
  );
}
