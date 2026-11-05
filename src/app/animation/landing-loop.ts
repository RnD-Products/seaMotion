import * as React from "react";

import { buildSegments, type LandingPlan } from "./landing-plan";
import { layerMotionRange, motionRange, type SectionMotions } from "./landing-motion";
import type { PageInfo } from "./animation-spec";

// The segments of the Scroll plan picked for looping. A segment is the stretch of the rail between
// one dot and the next: "start", a step's id, or "end". The picks live for the session only; they
// are not saved with the project.
let selected: readonly string[] = [];
let editingSection: string | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function getLoopSelection(): readonly string[] {
  return selected;
}

export function useLoopSelection(): readonly string[] {
  return React.useSyncExternalStore(subscribe, () => selected);
}

export function getEditingSectionLoop(): string | null {
  return editingSection;
}

export function useEditingSectionLoop(): string | null {
  return React.useSyncExternalStore(subscribe, () => editingSection);
}

// A separate, temporary work loop follows the section currently selected in the editor.
// It never changes the saved plan or exported playback.
export function setEditingSectionLoop(key: string | null): void {
  if (editingSection === key) return;
  editingSection = key;
  emit();
}

// A plain click picks just this segment (and drops it again if it was the only one); Shift-click
// adds it to the others or takes it away.
export function pickLoopSegment(key: string, additive: boolean): void {
  // A manually picked rail segment takes over from the automatic section work loop.
  editingSection = null;
  if (additive) selected = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
  else selected = selected.length === 1 && selected[0] === key ? [] : [key];
  emit();
}

export function clearLoopSegments(): void {
  if (selected.length === 0) return;
  selected = [];
  emit();
}

export const START_KEY = "start";
export const END_KEY = "end";
export const motionLoopKey = (key: string): string => `section:${key}`;
export const sectionWorkLoopKey = (key: string): string => `work:${encodeURIComponent(key)}`;
export const layerMotionLoopKey = (key: string, itemId: string): string => `layer:${encodeURIComponent(key)}:${encodeURIComponent(itemId)}`;

export type TimeRange = readonly [number, number];

const MIN_LENGTH = 0.02;

// Editing a section includes its scroll-in, its animation, and the linked step's
// Hold. This keeps the section visible and lets each replay show the full timing.
export function sectionWorkRange(key: string, plan: LandingPlan, motions: SectionMotions, page: PageInfo, total: number, segments = buildSegments(plan).segments): TimeRange | null {
  const motion = motions[key];
  const animation = motion ? motionRange(key, motion, plan, page, total, segments) : null;
  if (!animation) return null;
  const index = plan.steps.findIndex((step) => step.waitFor === key);
  const scrollStart = index >= 0 ? segments[index]?.start : undefined;
  const holdEnd = index >= 0 ? segments[index]?.end : undefined;
  return [Math.min(scrollStart ?? animation[0], animation[0]), Math.max(holdEnd ?? animation[1], animation[1])];
}

// The time range of one segment, or null when it has no length (a Start of 0 s, or an End that holds nothing).
export function segmentRange(plan: LandingPlan, key: string): TimeRange | null {
  const { segments } = buildSegments(plan);
  let range: TimeRange | null = null;
  if (key === START_KEY) range = [0, plan.loading];
  else if (key === END_KEY) {
    const last = segments[plan.steps.length];
    range = last ? [last.start, last.end] : null;
  } else {
    const index = plan.steps.findIndex((step) => step.id === key);
    const segment = index >= 0 ? segments[index] : undefined;
    range = segment ? [segment.start, segment.end] : null;
  }
  return range && range[1] - range[0] >= MIN_LENGTH ? range : null;
}

// The picked segments as time ranges in order, with touching ones joined so they play straight through.
export function loopRanges(plan: LandingPlan, keys: readonly string[], motions?: SectionMotions, page?: PageInfo, total?: number): TimeRange[] {
  const segments = keys.some((key) => key.startsWith("section:") || key.startsWith("layer:") || key.startsWith("work:")) ? buildSegments(plan).segments : undefined;
  const ranges = keys.map((key) => {
    if (key.startsWith("work:")) {
      let name: string;
      try {
        name = decodeURIComponent(key.slice("work:".length));
      } catch {
        return null;
      }
      return motions && page ? sectionWorkRange(name, plan, motions, page, total ?? 0, segments) : null;
    }
    if (key.startsWith("layer:")) {
      const parts = key.slice("layer:".length).split(":");
      if (parts.length !== 2) return null;
      let name: string;
      let itemId: string;
      try {
        name = decodeURIComponent(parts[0]!);
        itemId = decodeURIComponent(parts[1]!);
      } catch {
        return null;
      }
      const motion = motions?.[name];
      return motion && page ? layerMotionRange(name, motion, itemId, plan, page, total ?? 0, segments) : null;
    }
    if (key.startsWith("section:")) {
      const name = key.slice("section:".length);
      const motion = motions?.[name];
      return motion && page ? motionRange(name, motion, plan, page, total ?? 0, segments) : null;
    }
    return segmentRange(plan, key);
  }).filter((range): range is TimeRange => range !== null);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 0.001) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

// While playing: where the playhead must jump to stay inside the looped ranges, or null to leave it.
// Past the end of a range it goes on to the next picked range, and from the last one back to the first.
export function nextLoopTime(ranges: readonly TimeRange[], time: number): number | null {
  if (ranges.length === 0) return null;
  if (ranges.some((range) => time >= range[0] - 0.001 && time < range[1])) return null;
  const upcoming = ranges.find((range) => range[0] > time);
  return (upcoming ?? ranges[0])?.[0] ?? null;
}

// The segments of an animation made of segments (Interaction plan), by id, as their latest times. They are set when the
// animation reports its schedule, and picked for looping with the key `seg:<id>` like the Scroll plan's segments.
let segmentTimes: Readonly<Record<string, TimeRange>> = {};
export const segmentLoopKey = (id: string): string => `seg:${id}`;

export function setSegmentTimes(next: Readonly<Record<string, TimeRange>>): void {
  segmentTimes = next;
}

// More ranges that can be looped, added to the reported segments (a layer's card covers its effects together).
export function addSegmentTimes(extra: Readonly<Record<string, TimeRange>>): void {
  segmentTimes = { ...segmentTimes, ...extra };
}

// The picked animation segments as time ranges in order, with touching ones joined.
export function segmentLoopRanges(keys: readonly string[]): TimeRange[] {
  const ranges = keys
    .map((key) => (key.startsWith("seg:") ? segmentTimes[key.slice("seg:".length)] : undefined))
    .filter((range): range is TimeRange => range !== undefined && range[1] - range[0] >= MIN_LENGTH)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 0.001) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
