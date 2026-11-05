import * as React from "react";

export type PreviewMemoryPhase = "idle" | "playing" | "reopen" | "scrubbing";

export type PreviewMemorySample = Readonly<{
  averageRenderMs: number;
  budgetBytes: number | null;
  cacheBytes: number;
  effectBytes: number;
  evictions: number;
  heapBytes: number | null;
  maxRenderMs: number;
  peakBytes: number;
  phase: PreviewMemoryPhase;
  sampledAt: number;
  totalBytes: number;
}>;

let current: PreviewMemorySample | null = null;
let history: readonly PreviewMemorySample[] = [];
const listeners = new Set<() => void>();

export function getPreviewMemorySample(): PreviewMemorySample | null {
  return current;
}

export function recordPreviewMemorySample(sample: PreviewMemorySample): void {
  current = sample;
  history = [...history.slice(-119), sample];
  for (const listener of listeners) listener();
}

export function getPreviewMemoryHistory(): readonly PreviewMemorySample[] {
  return history;
}

export function subscribePreviewMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreviewMemorySample(): PreviewMemorySample | null {
  return React.useSyncExternalStore(subscribePreviewMemory, getPreviewMemorySample, getPreviewMemorySample);
}

export function readBrowserHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}
