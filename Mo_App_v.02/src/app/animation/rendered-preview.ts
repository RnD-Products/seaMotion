import * as React from "react";
import type { ToolcraftState } from "@/toolcraft/runtime";

import { getActiveAnimation } from "./animation-spec";
import { getEditingSectionLoop, getLoopSelection, loopRanges, sectionWorkLoopKey, type TimeRange } from "./landing-loop";
import { LANDING_SECTIONS_TARGET, readSectionMotions, withWaits } from "./landing-motion";
import { effectivePlan, LANDING_PLAN_TARGET, readLandingPlan } from "./landing-plan";

export type RenderedPreview = Readonly<{
  endSeconds: number;
  fps: number;
  height: number;
  signature: string;
  startSeconds: number;
  url: string;
  width: number;
}>;

export type RenderedPreviewStatus = Readonly<{
  kind: "error" | "rendering" | "stale" | "success";
  message: string;
}> | null;

let current: RenderedPreview | null = null;
let status: RenderedPreviewStatus = null;
const listeners = new Set<() => void>();
const signatureCache = new WeakMap<object, string>();

function emit(): void {
  for (const listener of listeners) listener();
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function animationSignature(spec: ReturnType<typeof getActiveAnimation>): string {
  if (!spec) return "none";
  const cached = signatureCache.get(spec);
  if (cached) return cached;
  const assets = Object.entries(spec.assets).map(([id, source]) => `${id}:${source.length}:${source.slice(-24)}`);
  const signature = `${spec.id}@${spec.version}:${hashText(spec.lottie ? JSON.stringify(spec.lottie) : spec.code)}:${hashText(assets.join("|"))}`;
  signatureCache.set(spec, signature);
  return signature;
}

export function getRenderedPreviewSignature(state: Readonly<{
  canvas: Readonly<{ size: Readonly<{ height: number; width: number }> }>;
  layers: ToolcraftState["layers"];
  timeline: Readonly<{ durationSeconds: number }>;
  values: ToolcraftState["values"];
}>): string {
  const relevantValues = Object.entries(state.values)
    .filter(([target]) => target !== "animation.library" && target !== "projects.state" && target !== "render.status" && !target.startsWith("render.") && !target.startsWith("preview."))
    .sort(([left], [right]) => left.localeCompare(right));
  return hashText(JSON.stringify({
    animation: animationSignature(getActiveAnimation(state.values)),
    canvas: state.canvas.size,
    duration: state.timeline.durationSeconds,
    layers: state.layers,
    values: relevantValues,
  }));
}

export function getRenderedPreview(): RenderedPreview | null {
  return current;
}

export function getRenderedPreviewStatus(): RenderedPreviewStatus {
  return status;
}

export function subscribeRenderedPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRenderedPreview(): RenderedPreview | null {
  return React.useSyncExternalStore(subscribeRenderedPreview, getRenderedPreview, getRenderedPreview);
}

export function setRenderedPreviewStatus(next: RenderedPreviewStatus): void {
  status = next;
  emit();
}

export function installRenderedPreview(next: Omit<RenderedPreview, "url">, blob: Blob): RenderedPreview {
  if (current) URL.revokeObjectURL(current.url);
  current = { ...next, url: URL.createObjectURL(blob) };
  status = { kind: "success", message: `Rendered preview ready · ${next.width}×${next.height} · ${next.fps} FPS` };
  emit();
  return current;
}

export function clearRenderedPreview(nextStatus: RenderedPreviewStatus = null): void {
  if (current) URL.revokeObjectURL(current.url);
  current = null;
  status = nextStatus;
  emit();
}

export function invalidateRenderedPreview(signature: string): void {
  if (!current || current.signature === signature) return;
  clearRenderedPreview({ kind: "stale", message: "Preview changed. Build it again to include the latest edits." });
}

export function resolveRenderedPreviewRange(state: ToolcraftState, mode: unknown): TimeRange {
  if (mode !== "selected") return [0, state.timeline.durationSeconds];
  const spec = getActiveAnimation(state.values);
  if (!spec?.page) throw new Error("Selected preview needs a landing-page project.");
  const motions = readSectionMotions(state.values[LANDING_SECTIONS_TARGET]);
  const plan = withWaits(effectivePlan(readLandingPlan(state.values[LANDING_PLAN_TARGET]), spec.page), spec.page, motions);
  const editing = getEditingSectionLoop();
  const keys = editing ? [sectionWorkLoopKey(editing)] : getLoopSelection();
  const ranges = loopRanges(plan, keys, motions, spec.page, state.timeline.durationSeconds);
  if (ranges.length !== 1) throw new Error("Select one continuous section or timeline segment first.");
  return ranges[0]!;
}
