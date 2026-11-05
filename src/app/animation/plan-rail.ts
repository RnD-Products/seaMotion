import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { clearLoopSegments, nextLoopTime, pickLoopSegment, segmentLoopKey, segmentLoopRanges, useLoopSelection } from "./landing-loop";

export const LOOP_COLOR = { "--loop": "#4c8dff" } as React.CSSProperties;

// The vertical timeline of the Scroll plan: a numbered dot and a line beside each card. A click beside the line plays
// from that time, and the playhead shows on the card that is playing.
export function useRail(total: number, scope: "layer" | "section", rangeOf: (index: number) => readonly [number, number] | null): Readonly<{
  dragging: boolean;
  loopKeys: readonly string[];
  now: number;
  pick: (id: string, additive: boolean, range: readonly [number, number] | null) => void;
  scrub: (at: number) => void;
  startMarkDrag: (event: React.PointerEvent<HTMLElement>) => void;
}> {
  const now = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const dispatch = useToolcraftDispatch();
  const loopKeys = useLoopSelection();
  const [dragging, setDragging] = React.useState(false);
  const scrub = (at: number): void => dispatch({ currentTimeSeconds: Math.min(total, Math.max(0, at)), type: "timeline.setCurrentTime" });
  // Playing from a point outside the looped segments lets the loop go.
  const scrubFree = (at: number): void => {
    scrub(at);
    if (loopKeys.length > 0 && nextLoopTime(segmentLoopRanges(loopKeys), at) !== null) clearLoopSegments();
  };
  // A click on the line picks or drops the segment as a loop (Shift adds to the others) and plays its end, like the Scroll plan.
  const pick = (id: string, additive: boolean, range: readonly [number, number] | null): void => {
    if (!range) return;
    pickLoopSegment(segmentLoopKey(id), additive);
    scrub(Math.max(range[0], range[1] - 0.02));
  };
  // Dragging the playhead handle scrubs along whichever card's rail the pointer is over.
  const startMarkDrag = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    const move = (pointer: PointerEvent): void => {
      for (const card of document.querySelectorAll<HTMLElement>(`[data-${scope}-card]`)) {
        const range = rangeOf(Number(card.dataset[`${scope}Index`]));
        const rail = card.firstElementChild?.getBoundingClientRect();
        if (!range || !rail || pointer.clientY < rail.top || pointer.clientY > rail.bottom) continue;
        const fraction = Math.min(1, Math.max(0, (pointer.clientY - rail.top - 14) / Math.max(1, rail.height - 14)));
        scrubFree(range[0] + fraction * (range[1] - range[0]));
        break;
      }
    };
    const end = (pointer: PointerEvent): void => {
      if (pointer.type === "pointerup") move(pointer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  return { dragging, loopKeys, now, pick, scrub: scrubFree, startMarkDrag };
}

export function playhead(now: number, start: number, end: number): readonly { at: number; kind: "now"; title: string }[] {
  return now >= start && now < end ? [{ at: (now - start) / Math.max(0.001, end - start), kind: "now", title: `${now.toFixed(2)} s` }] : [];
}

