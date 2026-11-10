import * as React from "react";

// The video part picked on the timeline (a bar of the Video row): its card in the Layer section is shown as picked.
export type VideoPartPick = Readonly<{ clip: string; index: number }>;

let picked: VideoPartPick | null = null;
let fresh = false;
const listeners = new Set<() => void>();

export function pickVideoPart(next: VideoPartPick | null): void {
  picked = next;
  fresh = next !== null;
  for (const listener of listeners) listener();
}

// True once after a part is picked: the panel brings its card into view then, and never again (it must stay free to scroll).
export function takeFreshPick(): boolean {
  const was = fresh;
  fresh = false;
  return was;
}

export function useVideoPartPick(): VideoPartPick | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => picked,
    () => null,
  );
}
