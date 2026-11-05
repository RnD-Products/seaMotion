import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { useTimelineView } from "./timeline-view";
import { activeSceneOffset, clampSceneSeconds, readScenes, resolveProjectScenes, sceneAt, selectScene, SCENES_TARGET } from "./scenes";

// With several scenes the timeline is as long as all of them together. Someone else changing the timeline length (the Duration
// field, a video's Match project length) changes the scene on show by the same amount; anything else puts the timeline back to
// the scenes' total.
export function useSceneDurationSync(): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const scenes = React.useMemo(() => resolveProjectScenes(values, durationSeconds), [values, durationSeconds]);
  const seen = React.useRef<Readonly<{ duration: number; total: number }> | null>(null);
  React.useEffect(() => {
    const before = seen.current;
    seen.current = { duration: durationSeconds, total: scenes.total };
    if (!scenes.many || Math.abs(durationSeconds - scenes.total) < 0.005) return;
    const timelineMoved = before !== null && Math.abs(before.total - scenes.total) < 0.005 && Math.abs(before.duration - durationSeconds) > 0.005;
    const saved = readScenes(values[SCENES_TARGET]);
    const shown = saved.items.find((scene) => scene.id === saved.activeId);
    if (!timelineMoved || !shown) {
      dispatch({ durationSeconds: scenes.total, type: "timeline.setDuration" });
      return;
    }
    const next = clampSceneSeconds(shown.duration + (durationSeconds - scenes.total));
    dispatch({
      label: "Scene length",
      type: "controls.apply",
      values: { [SCENES_TARGET]: { activeId: saved.activeId, items: saved.items.map((scene) => (scene.id === shown.id ? { ...scene, duration: next } : scene)) } },
    });
  }, [dispatch, durationSeconds, scenes, values]);
}

// Where the scene on show starts on the timeline: the plan's times are the scene's own, the rail and the playhead use the timeline's.
export function useSceneOffset(): number {
  const values = useToolcraftSelector((state) => state.values);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  return React.useMemo(() => activeSceneOffset(resolveProjectScenes(values, durationSeconds)), [values, durationSeconds]);
}

// Segment wise preview: while it is on and the timeline plays, the playhead stays inside the scene on show (it goes back to the
// scene's start at its end), and showing another scene takes the playhead to that scene's start.
export function useScenePreview(): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const timeSeconds = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const isPlaying = useToolcraftSelector((state) => state.timeline.isPlaying);
  const scenes = React.useMemo(() => resolveProjectScenes(values, durationSeconds), [values, durationSeconds]);
  const shown = scenes.items[scenes.activeIndex];
  const shownId = shown?.scene.id;
  // The loop only runs in a scene's view; with All chosen (also after a reload) the full motion plays.
  const view = useTimelineView();
  const preview = scenes.preview && view === "scene";
  const previousShown = React.useRef<string | undefined>(shownId);
  const start = shown?.start ?? 0;
  const end = shown?.end ?? 0;
  React.useEffect(() => {
    const changed = previousShown.current !== shownId;
    previousShown.current = shownId;
    if (!preview || !shown) return;
    if (changed || (isPlaying && (timeSeconds >= end - 0.001 || timeSeconds < start - 0.001))) {
      dispatch({ currentTimeSeconds: start, type: "timeline.setCurrentTime" });
    }
  }, [dispatch, end, isPlaying, preview, shown, shownId, start, timeSeconds]);
}

// When playback stops (segment wise preview off), the scene the playhead stopped in becomes the scene on show, as if it had been
// clicked. While it plays the selection stays where it is, and a paused playhead that is moved never changes what is being edited.
export function useSceneFollow(): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const defaults = useToolcraftSelector((state) => state.defaults);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const timeSeconds = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const isPlaying = useToolcraftSelector((state) => state.timeline.isPlaying);
  const latest = React.useRef({ defaults, durationSeconds, timeSeconds, values });
  latest.current = { defaults, durationSeconds, timeSeconds, values };
  const view = useTimelineView();
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const wasPlaying = React.useRef(isPlaying);
  React.useEffect(() => {
    const stopped = wasPlaying.current && !isPlaying;
    wasPlaying.current = isPlaying;
    if (!stopped) return;
    const { defaults: base, durationSeconds: timeline, timeSeconds: time, values: current } = latest.current;
    const scenes = resolveProjectScenes(current, timeline);
    if (!scenes.many || (scenes.preview && viewRef.current === "scene")) return;
    const stoppedIn = sceneAt(scenes, time).scene.id;
    if (stoppedIn === scenes.items[scenes.activeIndex]?.scene.id) return;
    const edit = selectScene({ defaults: base, timelineSeconds: timeline, values: current }, stoppedIn);
    if (edit) dispatch({ label: "Show scene", type: "controls.apply", values: edit.values });
  }, [dispatch, isPlaying]);
}
