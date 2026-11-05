import * as React from "react";

import type { SandboxSegment } from "./animation-sandbox";
import { setSegmentTimes } from "./landing-loop";
import { getProbeSandbox, useProbeSandboxVersion } from "./layer-texts";
import { useSceneOffset } from "./scene-duration";
import { useTimelineView } from "./timeline-view";

const EMPTY: readonly SandboxSegment[] = Object.freeze([]);

// The start and end of each segment of the open animation for its current settings. Segments run one
// after another, so changing one segment's time moves every segment after it. Empty until the
// animation reports them (an animation made without segments never does).
export function useSegmentSchedule(params: Readonly<Record<string, unknown>>, stage?: string): readonly SandboxSegment[] {
  const sandboxVersion = useProbeSandboxVersion();
  // The animation reports the scene's own times; the rail and the playhead use the timeline's.
  const sceneOffset = useSceneOffset();
  // Every segment of the motion (All chosen in the scenes strip, no scene part asked for) is measured from the motion's start.
  const view = useTimelineView();
  const offset = stage === undefined && view === "all" ? 0 : sceneOffset;
  const [segments, setSegments] = React.useState<readonly SandboxSegment[]>(EMPTY);
  React.useEffect(() => {
    const sandbox = getProbeSandbox();
    if (!sandbox) {
      setSegments(EMPTY);
      return undefined;
    }
    let cancelled = false;
    sandbox.measureSegments(stage ? { ...params, __stage: stage } : params).then(
      (next) => {
        if (cancelled) return;
        const shifted = offset === 0 ? next : next.map((segment) => ({ ...segment, end: segment.end + offset, start: segment.start + offset }));
        setSegmentTimes(Object.fromEntries(shifted.map((segment) => [segment.id, [segment.start, segment.end] as const])));
        setSegments(shifted.length > 0 ? shifted : EMPTY);
      },
      () => {
        if (!cancelled) setSegments(EMPTY);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [offset, params, sandboxVersion, stage]);
  return segments;
}

// "001 · Focus" -> "001": the number that ties a control group to its segment.
export function segmentNumber(group: string): string {
  return /^\d+/.exec(group.trim())?.[0] ?? group;
}

export function formatSeconds(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2).replace(/0$/, "")}s`;
}
