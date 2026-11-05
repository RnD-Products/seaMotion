import * as React from "react";
import { useToolcraftSelector } from "@/toolcraft/runtime/react";

import { ANIMATION_PARAMS_TARGET, getActiveAnimation, getControlLayerId, resolveParams, type ControlSpec } from "./animation-spec";
import { isSceneMotionType, MOTION_TYPE_TARGET, readMotionType } from "./motion-type";
import { resolveProjectScenes } from "./scenes";
import { useTimelineView } from "./timeline-view";
import { segmentNumber, useSegmentSchedule } from "./segment-schedule";

// A group named like "001 · Focus" is one interaction segment; every other group is an effect that works across them.
export const SEGMENT_GROUP = /^\d+\s*·/;

// The Animations tab's card of a control: its layer and its effect ("Numbers · Shapes"); a control without a layer is its effect alone.
export const cardOf = (control: ControlSpec): string => (control.layer ? `${control.layer} · ${control.group ?? ""}` : (control.group ?? ""));

// The effect controls that belong to the scene that plays one segment (its role): the ones that work on a layer the segment's own
// controls name ("03 · Next" names Numbers). A layer no segment names is kept, since it cannot be told where it plays. Without a role
// (All, or a scene that plays the whole motion) nothing is filtered.
export function effectsForRole(controls: readonly ControlSpec[], role: string | undefined): readonly ControlSpec[] {
  if (!role) return controls;
  const tokens = (layer: string | undefined): string[] => (layer ?? "").split(" · ").map((part) => part.trim()).filter(Boolean);
  const SKIP = new Set(["Segment", "Cursor"]);
  const spec = controls.filter((control) => SEGMENT_GROUP.test(control.group ?? ""));
  const named = new Set(spec.flatMap((control) => tokens(control.layer)).filter((name) => !SKIP.has(name)));
  const mine = new Set(spec.filter((control) => segmentNumber(control.group ?? "") === role).flatMap((control) => tokens(control.layer)).filter((name) => !SKIP.has(name)));
  return controls.filter((control) => {
    if (SEGMENT_GROUP.test(control.group ?? "")) return true;
    const own = tokens(control.layer);
    if (own.length === 0) return true;
    if (!own.some((name) => named.has(name))) return mine.size > 0;
    return own.some((name) => mine.has(name));
  });
}

// A layer's timed change inside the scene's own segment (the count of "Data change"): it starts `delay` seconds into the segment and
// takes `time`; the two are the segment's own Delay and Time controls.
export type SegmentTiming = Readonly<{
  delay: number;
  delayId: string;
  delayMax: number;
  end: number;
  group: string;
  label: string;
  layer: string;
  start: number;
  time: number;
  timeId: string;
  timeMax: number;
  timeMin: number;
}>;

export type SlideTime = Readonly<{ end: number; id: string; start: number; step: number }>;

export type AnimationCardTime = Readonly<{ card: string; effect: string; layer: string; on: boolean; range: readonly [number, number] }>;

// The cards of the Animations tab with the time their effects work (the animation's own report, in timeline time), for the timeline's
// keyframe rows. Empty when the scene on show has no motion script.
export function useAnimationCardTimes(): Readonly<{ cards: readonly AnimationCardTime[]; slides: readonly SlideTime[]; timings: readonly SegmentTiming[] }> {
  const values = useToolcraftSelector((state) => state.values);
  const duration = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const spec = getActiveAnimation(values);
  const scenes = resolveProjectScenes(values, duration);
  const scene = scenes.items[scenes.activeIndex]?.scene;
  const usable = spec !== null && spec !== undefined && isSceneMotionType(readMotionType(values[MOTION_TYPE_TARGET])) && scene?.motion !== false;
  const view = useTimelineView();
  const role = usable ? scene?.role : undefined;
  const raw = values[ANIMATION_PARAMS_TARGET];
  const params = React.useMemo(() => (usable && spec ? resolveParams(spec, raw) : {}), [raw, spec, usable]);
  const schedule = useSegmentSchedule(params, role);
  return React.useMemo(() => {
    if (!usable || !spec) return { cards: [], slides: [], timings: [] };
    const controls = effectsForRole(spec.controls, view === "scene" ? role : undefined).filter(
      (control) =>
        control.section !== "frame" &&
        getControlLayerId(spec, control) === null &&
        !SEGMENT_GROUP.test(control.group ?? "") &&
        // The slide-in steps have their own rows (with a row for each layer), not a whole-scene card.
        !/^enter\.\d+\./.test(control.id),
    );
    const total = Math.max(0, ...schedule.filter((segment) => /^\d+$/.test(segment.id)).map((segment) => segment.end));
    const cards = [...new Set(controls.map(cardOf))];
    const cardTimes = cards.flatMap((card) => {
      const own = controls.filter((control) => cardOf(control) === card);
      const groups = [...new Set(own.map((control) => control.group ?? ""))];
      const spans = groups.map((group) => schedule.find((segment) => segment.id === `fx:${group}`)).filter((segment) => segment !== undefined);
      const range: readonly [number, number] | null = spans.length > 0 ? [Math.min(...spans.map((s) => s.start)), Math.max(...spans.map((s) => s.end))] : total > 0 ? [view === "scene" ? (scenes.items[scenes.activeIndex]?.start ?? 0) : 0, total] : null;
      if (!range) return [];
      const on = groups.some((group) => {
        const toggle = own.find((control) => (control.group ?? "") === group && control.type === "switch" && /\.on(\.\w+)?$/.test(control.id));
        return toggle ? raw !== undefined && (params as Record<string, unknown>)[toggle.id] === true : true;
      });
      const layer = own[0]?.layer ?? "";
      return [{ card, effect: groups.join(" + "), layer, on, range }];
    });
    const timings: SegmentTiming[] = [];
    const segmentStart = role && view === "scene" ? schedule.find((segment) => segment.id === role)?.start : undefined;
    if (role && view === "scene" && segmentStart !== undefined) {
      const mine = spec.controls.filter((control) => SEGMENT_GROUP.test(control.group ?? "") && segmentNumber(control.group ?? "") === role);
      const delayControl = mine.find((control) => /\.delay$/.test(control.id) && control.type === "slider");
      const values = params as Record<string, unknown>;
      for (const control of mine) {
        if (control.type !== "slider" || !/\.time$/.test(control.id) || !control.layer || control.layer === "Segment" || control.layer === "Cursor") continue;
        const delay = delayControl ? Number(values[delayControl.id] ?? 0) : 0;
        const time = Number(values[control.id] ?? 0);
        const start = segmentStart + delay;
        timings.push({
          delay,
          delayId: delayControl?.id ?? "",
          delayMax: delayControl?.max ?? 0,
          end: start + time,
          group: control.group ?? "",
          label: (control.group ?? "").replace(/^\d+\s*·\s*/, ""),
          layer: control.layer,
          start,
          time,
          timeId: control.id,
          timeMax: control.max ?? 20,
          timeMin: control.min ?? 0.1,
        });
      }
    }
    // The layers that slide in during the scene's part, on the timeline's time (the part starts where the scene does).
    const part = role && view === "scene" ? schedule.find((segment) => segment.id === role) : undefined;
    const slides: SlideTime[] = (part?.slides ?? []).map((slide) => ({ end: part!.start + slide.end, id: slide.id, start: part!.start + slide.start, step: slide.step }));
    return { cards: cardTimes, slides, timings };
  }, [params, raw, role, schedule, spec, usable, view]);
}
