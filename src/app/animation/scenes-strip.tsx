import { Plus } from "@phosphor-icons/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { addScene, changeScene, snapToScenes, moveScene, removeScene, resolveProjectScenes, loopScene, SCENES_TARGET, selectScene, setScenePreview, splitIntoPreset, SCENE_PRESETS, presetSeconds, resetScenes, scenesHaveMotion, type SceneEdit } from "./scenes";
import { MO_PROJECTS_TARGET, readMoProjects } from "../mo/mo-projects";
import { handleTimelineWheel, setTimelineView, TIMELINE_LAYOUT_EVENT, useTimelineView, useTimelineZoom } from "./timeline-view";
import styles from "./scenes-strip.module.css";

const APP_SELECTOR = '[data-slot="toolcraft-runtime-app"]';
const SIDEBAR_SELECTOR = "[data-mo-app-sidebar]";
const TIMELINE_SELECTOR = '[data-slot="toolcraft-runtime-panel-host"][data-panel-type="timeline"]';
const EDGE_GAP = 10;
const BAR_GAP = 8;

function seconds(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "")}s`;
}

// The scenes of the motion as blocks along the bottom of the canvas, as long as their lengths, with the playhead running over them.
// Clicking a block shows that scene and puts the playhead at its start. Shown above the playback bar when the project has several scenes.
export function ScenesStrip(): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const defaults = useToolcraftSelector((state) => state.defaults);
  const duration = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const time = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const view = useTimelineView();
  // The timeline follows the inspector's tab: open on Motion, folded on Project info and Modifier (also when a project opens or the page reloads).
  const projectId = useToolcraftSelector((state) => readMoProjects(state.values[MO_PROJECTS_TARGET]).currentId);
  // For a while after a project is opened (or the page loaded) the timeline is kept open, unless the timeline itself was used: the project
  // sets the timeline up a little after it opens, and that must not leave it folded.
  const expanded = useToolcraftSelector((state) => state.timeline.expanded);
  const openedAt = React.useRef(0);
  const touched = React.useRef(false);
  React.useEffect(() => {
    openedAt.current = Date.now();
    touched.current = false;
  }, [projectId]);
  React.useEffect(() => {
    const stop = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-panel-type="timeline"]')) touched.current = true;
    };
    window.addEventListener("pointerdown", stop, true);
    return () => window.removeEventListener("pointerdown", stop, true);
  }, []);
  // The timeline is open while the inspector is on its Motion tab and folded on Project info and Modifier; it can still be opened or folded by
  // hand, until the tab changes again.
  const onMotionTab = useToolcraftSelector((state) => state.values["inspector.tab"] === "motion");
  React.useEffect(() => {
    dispatch({ expanded: onMotionTab, type: "timeline.setExpanded" });
  }, [dispatch, onMotionTab]);
  // Pressing a tab of the inspector does it at once, without waiting for the tab's value to reach us.
  React.useEffect(() => {
    const onPress = (event: Event): void => {
      const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      const name = tab?.textContent?.trim();
      if (!tab || !tab.closest('[data-panel-type="controls"]')) return;
      // The page is told first (the styles size the timeline panel from it, in the next frame), then the app.
      if (name === "Motion") {
        document.documentElement.dataset.moTimeline = "open";
        if (!document.documentElement.style.getPropertyValue("--mo-tracks-height")) document.documentElement.style.setProperty("--mo-tracks-height", "204px");
        dispatch({ expanded: true, type: "timeline.setExpanded" });
      } else if (name === "Project info" || name === "Modifier") {
        document.documentElement.dataset.moTimeline = "folded";
        document.documentElement.style.removeProperty("--mo-tracks-height");
        dispatch({ expanded: false, type: "timeline.setExpanded" });
      }
    };
    window.addEventListener("pointerdown", onPress, true);
    return () => window.removeEventListener("pointerdown", onPress, true);
  }, [dispatch]);
  React.useEffect(() => {
    if (expanded !== onMotionTab && !touched.current && Date.now() - openedAt.current < 20000) dispatch({ expanded: onMotionTab, type: "timeline.setExpanded" });
  }, [dispatch, expanded, onMotionTab]);
  // While the timeline opens or folds (it animates), the strip rides on its top edge frame by frame, so the two move as one.
  // The folded / open state is on the page at once (the styles size the timeline panel from it, so it jumps to its size instead of animating).
  React.useLayoutEffect(() => {
    document.documentElement.dataset.moTimeline = expanded ? "open" : "folded";
    if (expanded && !document.documentElement.style.getPropertyValue("--mo-tracks-height")) document.documentElement.style.setProperty("--mo-tracks-height", "204px");
  }, [expanded]);
  React.useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const follow = (): void => {
      const strip = stripRef.current;
      const panel = document.querySelector<HTMLElement>('[data-panel-type="timeline"] [data-slot="timeline-panel"]');
      if (strip && panel) strip.style.bottom = `${window.innerHeight - panel.getBoundingClientRect().top + 8}px`;
      if (performance.now() - started < 700) frame = requestAnimationFrame(follow);
      else if (strip) strip.style.removeProperty("bottom");
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      stripRef.current?.style.removeProperty("bottom");
    };
  }, [expanded]);
  // A new project (Animation_v2 too) starts with one scene, "Scene"; the Split scene button next to it makes the four segments Start, Logo animation,
  // Motion In and End.
  const zoom = useTimelineZoom();
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const zoomRef = React.useRef(zoom.zoom);
  zoomRef.current = zoom.zoom;
  const blocksRef = React.useRef<HTMLDivElement>(null);
  // The strip shows the same time as the timeline's keyframe area: zoomed in, a scene's view is a part of that scene.
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [spot, setSpot] = React.useState<{ bottom: number; left: number; width: number } | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  // The scene a drag of its grip would drop on (highlighted), and the newest values for the keyboard.
  const [dropAt, setDropAt] = React.useState<{ from: number; to: number } | null>(null);
  // The playhead handle is hovered or dragged: its time shows above the strip.
  const [playheadHot, setPlayheadHot] = React.useState(false);
  const [playheadDrag, setPlayheadDrag] = React.useState(false);
  // A scene whose right edge is being dragged: how many seconds longer (or shorter) it is meanwhile.
  const [resizing, setResizing] = React.useState<{ id: string; seconds: number } | null>(null);
  const [hoverScene, setHoverScene] = React.useState<string | null>(null);
  // The right-click menu of a scene (where the pointer was pressed).
  const [sceneMenu, setSceneMenu] = React.useState<{ id: string; x: number; y: number } | null>(null);
  React.useEffect(() => {
    if (!sceneMenu) return undefined;
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.target instanceof Element && event.target.closest("[data-scene-menu]")) return;
      setSceneMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("blur", close);
    };
  }, [sceneMenu]);
  // The scene presets beside the Split scene button.
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  React.useEffect(() => {
    if (!presetsOpen) return undefined;
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && event.target instanceof Element && event.target.closest("[data-split-row]")) return;
      setPresetsOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [presetsOpen]);
  // The scene whose name is being typed (double click on its block), and the name so far.
  const [renaming, setRenaming] = React.useState<{ draft: string; id: string } | null>(null);
  const latest = React.useRef<{ defaults: Readonly<Record<string, unknown>>; duration: number; scenes: ReturnType<typeof resolveProjectScenes>; values: Readonly<Record<string, unknown>>; view: string } | null>(null);

  // The Delete key (and Backspace) removes the scene that is shown, unless a field is being typed in; the last scene cannot be removed.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="textbox"]'))) return;
      if (document.documentElement.dataset.moTimelineSelection) return;
      const current = latest.current;
      const shown = current?.scenes.items[current.scenes.activeIndex];
      if (!current || current.view !== "scene" || !shown || !current.scenes.many) return;
      const edit = removeScene({ defaults: current.defaults, timelineSeconds: current.duration, values: current.values }, shown.scene.id);
      if (!edit) return;
      event.preventDefault();
      dispatch({ label: "Delete scene", type: "controls.apply", values: edit.values });
      if (edit.durationSeconds !== null && Math.abs(edit.durationSeconds - current.duration) > 0.001) dispatch({ durationSeconds: edit.durationSeconds, type: "timeline.setDuration" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  React.useEffect(() => {
    setHost(document.querySelector<HTMLElement>(APP_SELECTOR));
  }, []);

  // Ctrl / Cmd + wheel over the scenes zooms around the pointer, like the timeline's keyframe area (same zoom, same time shown).
  const blocksEl = blocksRef.current;
  const stripEl = blocksEl?.parentElement ?? null;
  React.useEffect(() => {
    if (!blocksEl) return undefined;
    const onWheel = (event: WheelEvent): void => {
      // With one scene shown the strip lists all scenes until the timeline is zoomed in (zoom there with the wheel over its keyframe area).
      if (viewRef.current === "scene" && zoomRef.current <= 1) return;
      handleTimelineWheel(event, blocksEl.getBoundingClientRect());
      if (event.ctrlKey || event.metaKey) event.stopPropagation();
    };
    // On the window, in the capture phase: the app's browser-zoom guard stops Ctrl / Cmd + wheel before it reaches the strip.
    const guarded = (event: WheelEvent): void => {
      if (event.target instanceof Node && stripEl?.contains(event.target)) onWheel(event);
    };
    window.addEventListener("wheel", guarded, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", guarded, { capture: true });
  }, [blocksEl, host]);

  // Between the project sidebar and the inspector, just above the playback bar.
  React.useEffect(() => {
    const measure = (): void => {
      const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR)?.getBoundingClientRect();
      const motionTab = [...document.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')].find((tab) => tab.textContent?.trim() === "Motion");
      const tabsControl = motionTab?.closest<HTMLElement>('[data-slot="tabs-control"]');
      let panel = tabsControl?.parentElement ?? null;
      while (panel && panel.getBoundingClientRect().width <= (tabsControl?.getBoundingClientRect().width ?? 0)) panel = panel.parentElement;
      const inspector = panel?.getBoundingClientRect();
      const left = sidebar && sidebar.width > 0 ? sidebar.right + EDGE_GAP : EDGE_GAP;
      const right = inspector && inspector.width > 0 ? inspector.left - EDGE_GAP : window.innerWidth - EDGE_GAP;
      const bar = document.querySelector<HTMLElement>(TIMELINE_SELECTOR)?.getBoundingClientRect();
      const bottom = bar && bar.height > 0 ? window.innerHeight - bar.top + BAR_GAP : EDGE_GAP;
      const next = { bottom: Math.round(bottom), left: Math.round(left), width: Math.max(0, Math.round(right - left)) };
      // The expanded timeline takes the same width (see styles.css).
      document.documentElement.style.setProperty("--mo-strip-width", `${Math.max(0, Math.round(right - left))}px`);
      // Straight onto the element as well (while the timeline is being resized the strip must follow it at once, not on the next render).
      if (stripRef.current) {
        stripRef.current.style.left = `${next.left}px`;
        stripRef.current.style.width = `${next.width}px`;
      }
      setSpot((current) => (current && current.bottom === next.bottom && current.left === next.left && current.width === next.width ? current : next));
    };
    measure();
    const timer = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener(TIMELINE_LAYOUT_EVENT, measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener(TIMELINE_LAYOUT_EVENT, measure);
    };
  }, []);

  const scenes = resolveProjectScenes(values, duration);
  latest.current = { defaults, duration, scenes, values, view };
  // The playback dot of the folded timeline sits where the playback line is (the line is inset to start under the scenes, but the dot
  // is placed by the timeline over its whole width): the dot is moved onto the line, so it is under the strip's playhead.
  React.useEffect(() => {
    let frame = 0;
    const place = (): void => {
      frame = window.requestAnimationFrame(place);
      const handle = document.querySelector<HTMLElement>('[data-slot="timeline-playback-handle"]');
      const line = document.querySelector<HTMLElement>('[data-slot="timeline-playback-line"]');
      const progress = line?.querySelector<HTMLElement>('[data-slot="timeline-playback-progress"]');
      const parent = handle?.offsetParent;
      if (!handle || !line || !progress || !parent) return;
      const lineBox = line.getBoundingClientRect();
      const parentBox = parent.getBoundingClientRect();
      if (lineBox.width === 0) return;
      const share = progress.getBoundingClientRect().width / lineBox.width;
      const left = lineBox.left - parentBox.left + share * lineBox.width;
      if (handle.dataset.moLeft !== String(left)) {
        handle.dataset.moLeft = String(left);
        handle.style.setProperty("left", `${left}px`, "important");
      }
    };
    frame = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(frame);
  }, []);
  // Scrubbing the folded timeline: the framework turns the pointer's place on the whole bar into a time, while the line (and the
  // strip's playhead) is inset under the scenes. Here the pointer's place on the line is the time, so the dot follows the cursor.
  const scrubRef = React.useRef({ dispatch, duration });
  scrubRef.current = { dispatch, duration };
  React.useEffect(() => {
    const seek = (clientX: number): void => {
      const line = document.querySelector<HTMLElement>('[data-slot="timeline-playback-line"]');
      if (!line) return;
      const box = line.getBoundingClientRect();
      if (box.width <= 0) return;
      const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      scrubRef.current.dispatch({ currentTimeSeconds: share * scrubRef.current.duration, type: "timeline.setCurrentTime" });
    };
    const down = (event: PointerEvent): void => {
      if (event.button !== 0 || document.documentElement.dataset.moTimeline !== "folded") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const surface = target.closest('[data-slot="toolcraft-runtime-panel-host"][data-panel-type="timeline"] [data-slot="panel-interaction-surface"]');
      if (!surface || target.closest('button, input, textarea, [role="button"], [data-slot="timeline-transport-controls"], [data-slot="timeline-panel-expand-toggle"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      seek(event.clientX);
      const move = (e: PointerEvent): void => seek(e.clientX);
      const up = (): void => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  if (!host || !spot || spot.width < 120) return null;
  const total = scenes.items[scenes.items.length - 1]?.end ?? duration;
  // The blocks are as wide as the scenes are long and run over the timeline's rows (same start, same end), so the playhead here and the
  // playhead in the timeline are at the same place.
  const clamped = Math.min(total, Math.max(0, time));
  const shownScene = scenes.items[scenes.activeIndex];
  const baseStart = view === "scene" && shownScene ? shownScene.start : 0;
  const baseLength = view === "scene" && shownScene ? shownScene.duration : total;
  const windowStart = baseStart + zoom.start * baseLength;
  const windowLength = baseLength / zoom.zoom;
  const stripZoom = zoom.zoom > 1 ? total / Math.max(0.01, windowLength) : 1;
  const windowStyle = stripZoom > 1 ? { left: `${(-windowStart / Math.max(0.01, total)) * stripZoom * 100}%`, width: `${stripZoom * 100}%` } : undefined;
  const playhead = total > 0 ? clamped / total : 0;
  // The time the blocks show: all of it, or (zoomed in) the window of the timeline's keyframe area.
  const shownStart = stripZoom > 1 ? windowStart : 0;
  const shownLength = stripZoom > 1 ? windowLength : total;

  // The right edge of a scene block is a handle: dragging it makes the scene longer or shorter, and the whole motion (the timeline) gets
  // longer or shorter by the same time. 0.05 s steps; Alt for free.
  const startEdgeResize = (event: React.PointerEvent, item: (typeof scenes.items)[number]): void => {
    const blocks = blocksRef.current;
    if (!blocks || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const perPixel = shownLength / Math.max(1, blocks.getBoundingClientRect().width);
    const startX = event.clientX;
    const base = item.duration;
    const deltaAt = (e: PointerEvent): number => {
      const raw = Math.max(0.1, base + (e.clientX - startX) * perPixel);
      return (e.altKey ? Math.round(raw * 100) / 100 : Math.max(0.1, Math.round(raw / 0.05) * 0.05)) - base;
    };
    setResizing({ id: item.scene.id, seconds: 0 });
    document.documentElement.dataset.moDragging = "resize";
    const move = (e: PointerEvent): void => setResizing({ id: item.scene.id, seconds: deltaAt(e) });
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      const delta = deltaAt(e);
      setResizing(null);
      if (Math.abs(delta) >= 0.005) commit(changeScene({ defaults, timelineSeconds: duration, values }, item.scene.id, { duration: base + delta }), "Scene length");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The playhead is a handle: dragging it moves the time (the strip shows the same window of time as its blocks).
  const startPlayheadDrag = (event: React.PointerEvent): void => {
    const blocks = blocksRef.current;
    if (!blocks || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const seek = (clientX: number, free = false): void => {
      const box = blocks.getBoundingClientRect();
      if (box.width <= 0) return;
      const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      const at = Math.min(total, Math.max(0, shownStart + share * shownLength));
      // Snaps to the start and end of every scene (about 7 px of reach; Alt moves it freely).
      const snapped = free ? at : snapToScenes(latest.current?.scenes ?? scenes, at, (7 / box.width) * shownLength);
      dispatch({ currentTimeSeconds: snapped, type: "timeline.setCurrentTime" });
    };
    setPlayheadDrag(true);
    // The same arrow all over while the drag goes on (styles.css).
    document.documentElement.dataset.moDragging = "resize";
    const move = (e: PointerEvent): void => seek(e.clientX, e.altKey);
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      setPlayheadDrag(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Scenes may overlap, so each block sits at its own time (not one after the other); while a scene's length is dragged the scenes after it follow.
  const grow = resizing?.seconds ?? 0;
  const shownTotal = Math.max(0.01, total + grow);
  const resizingIndex = resizing ? scenes.items.findIndex((each) => each.scene.id === resizing.id) : -1;
  const cellBox = (item: (typeof scenes.items)[number]): React.CSSProperties => {
    const start = item.start + (resizingIndex >= 0 && item.index > resizingIndex ? grow : 0);
    const length = Math.max(0.1, item.duration + (item.index === resizingIndex ? grow : 0));
    return { left: `${(start / shownTotal) * 100}%`, width: `${(length / shownTotal) * 100}%` };
  };
  // Hovering a scene that overlaps another draws a dashed box over the time they share.
  const overlapBoxes = scenes.items.flatMap((item) => {
    const before = scenes.items[item.index - 1];
    if (!before || item.lead <= 0) return [];
    if (hoverScene !== item.scene.id && hoverScene !== before.scene.id) return [];
    const start = item.start + (resizingIndex >= 0 && item.index > resizingIndex ? grow : 0);
    return [{ key: item.scene.id, left: start / shownTotal, width: item.lead / shownTotal }];
  });

  const show = (id: string, start: number): void => {
    setTimelineView("scene");
    // Opens the timeline (when it is closed), showing the scene's own duration.
    dispatch({ expanded: true, type: "timeline.setExpanded" });
    const edit = selectScene({ defaults, timelineSeconds: duration, values }, id);
    if (edit) dispatch({ label: "Show scene", type: "controls.apply", values: loopScene(edit).values });
    dispatch({ currentTimeSeconds: start, type: "timeline.setCurrentTime" });
    // Play or pause stays as it was; Play then loops this scene.
  };
  // All: the full motion plays (segment wise preview off), and the timeline shows every scene.
  const showAll = (): void => {
    setTimelineView("all");
    if (scenes.preview) {
      const edit = setScenePreview({ defaults, timelineSeconds: duration, values }, false);
      if (edit) dispatch({ label: "Play the full motion", type: "controls.apply", values: edit.values });
    }
  };

  const commit = (edit: SceneEdit | null, label: string): void => {
    if (!edit) return;
    dispatch({ label, type: "controls.apply", values: edit.values });
    if (edit.durationSeconds !== null && Math.abs(edit.durationSeconds - duration) > 0.001) dispatch({ durationSeconds: edit.durationSeconds, type: "timeline.setDuration" });
  };
  // A copy of the scene (after it); it becomes the scene that is shown.
  const duplicate = (id: string): void => {
    setTimelineView("scene");
    commit(addScene({ defaults, timelineSeconds: duration, values }, id), "Duplicate scene");
  };
  // A new empty scene put at a place between the scenes (0 = before the first, scenes.items.length = after the last); it becomes the scene that is shown.
  const insertAt = (place: number): void => {
    setTimelineView("scene");
    const made = addScene({ defaults, timelineSeconds: duration, values }, null);
    const count = scenes.items.length;
    if (place >= count) return commit(made, "Add scene");
    const after = { ...values, ...made.values };
    const id = resolveProjectScenes(after, made.durationSeconds ?? duration).items.find((item) => item.active)?.scene.id;
    const moved = id ? moveScene({ defaults, timelineSeconds: made.durationSeconds ?? duration, values: after }, id, place - count) : null;
    commit(moved ? { durationSeconds: made.durationSeconds, values: moved.values } : made, "Add scene");
  };
  const finishRename = (save: boolean): void => {
    const current = renaming;
    setRenaming(null);
    if (!save || !current) return;
    const name = current.draft.trim().slice(0, 40);
    const scene = scenes.items.find((item) => item.scene.id === current.id);
    if (name && scene && name !== scene.scene.name) commit(changeScene({ defaults, timelineSeconds: duration, values }, current.id, { name }), "Rename scene");
  };
  // Dragging the grip of a scene along the strip moves it to the place it is dropped on.
  const startMove = (event: React.PointerEvent, index: number): void => {
    event.preventDefault();
    event.stopPropagation();
    const id = scenes.items[index]?.scene.id;
    const container = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-scenes-blocks]');
    if (!id || !container) return;
    const cells = [...container.querySelectorAll<HTMLElement>("[data-scene-cell]")];
    const indexAt = (x: number): number => {
      const found = cells.findIndex((cell) => x < cell.getBoundingClientRect().right);
      return found < 0 ? cells.length - 1 : found;
    };
    document.documentElement.dataset.moDragging = "move";
    setDropAt({ from: index, to: index });
    const move = (e: PointerEvent): void => setDropAt({ from: index, to: indexAt(e.clientX) });
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      const to = indexAt(e.clientX);
      setDropAt(null);
      if (to !== index) commit(moveScene({ defaults, timelineSeconds: duration, values }, id, to - index), "Move scene");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return createPortal(
    <div className={styles.strip} data-mo-scenes-strip="" data-single={!scenes.many ? "" : undefined} ref={stripRef} style={{ left: spot.left, width: spot.width }}>
      {scenes.many && !scenesHaveMotion(values, defaults, scenes) ? (
        <button
          aria-label="Reset scenes"
          className={styles.reset}
          onClick={() => {
            commit(resetScenes({ defaults, timelineSeconds: duration, values }), "Reset scenes");
            setPresetsOpen(true);
          }}
          title="No scene has motion yet: put the scenes back to one scene and choose a scene preset again"
          type="button"
        >
          Reset scenes
        </button>
      ) : null}
      <button
        aria-label="Show the overview"
        aria-pressed={view === "all"}
        className={view === "all" ? `${styles.scene} ${styles.all} ${styles.active}` : `${styles.scene} ${styles.all}`}
        onClick={showAll}
        title="Overview: plays every scene one after another; the timeline shows all of them"
        type="button"
      >
        <span className={styles.name}>Overview</span>
        <span className={styles.time}>{seconds(total + (resizing?.seconds ?? 0))}</span>
      </button>
      <div className={styles.blocks} data-scenes-blocks="" ref={blocksRef}>
        {!scenes.many ? (
          <div className={styles.splitRow} data-split-row="">
            {presetsOpen ? (
              <div className={styles.presets} role="menu">
                {SCENE_PRESETS.map((preset) => (
                  <button
                    className={styles.preset}
                    key={preset.id}
                    onClick={() => {
                      setPresetsOpen(false);
                      setTimelineView("scene");
                      commit(splitIntoPreset({ defaults, timelineSeconds: duration, values }, preset.id), `Split into ${preset.scenes.map((scene) => scene.name).join(", ")}`);
                    }}
                    role="menuitem"
                    title={`${preset.scenes.map((scene) => `${scene.name} ${scene.seconds} s`).join(" · ")}. ${preset.description}; the scene's motion goes to Motion In.`}
                    type="button"
                  >
                    {preset.label}
                    <span className={styles.presetTime}>{presetSeconds(preset)}s</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              aria-expanded={presetsOpen}
              aria-label="Split scene"
              className={styles.split}
              onClick={() => setPresetsOpen((open) => !open)}
              title="Split the scene into scenes: pick a preset"
              type="button"
            >
              Split scene
            </button>
          </div>
        ) : null}
        <div className={styles.zoomed} style={windowStyle}>
        {scenes.items.map((item, index) => {
          const shown = item.active && view === "scene";
          const dropping = dropAt !== null && dropAt.to === index && dropAt.from !== index;
          return (
            <div
              className={[styles.cell, shown ? styles.shown : "", dropAt?.from === index ? styles.lifted : "", dropping ? styles.dropping : ""].filter(Boolean).join(" ")}
              data-scene-cell=""
              key={item.scene.id}
              onContextMenu={(event) => {
                // Right-click on a scene: move it, duplicate it or delete it.
                event.preventDefault();
                setSceneMenu({ id: item.scene.id, x: event.clientX, y: event.clientY });
              }}
              onPointerEnter={() => setHoverScene(item.scene.id)}
              onPointerLeave={() => setHoverScene((current) => (current === item.scene.id ? null : current))}
              style={cellBox(item)}
            >
              <button
                aria-label={`Show ${item.scene.name}`}
                className={shown ? `${styles.scene} ${styles.active}` : styles.scene}
                onClick={() => show(item.scene.id, item.start)}
                onDoubleClick={() => setRenaming({ draft: item.scene.name, id: item.scene.id })}
                title={`${item.scene.name} · ${seconds(item.start)} → ${seconds(item.end)}`}
                type="button"
              >
                <span className={styles.name}>{renaming?.id === item.scene.id ? "" : item.scene.name}</span>
                <span className={styles.time}>{seconds(item.duration + (resizing?.id === item.scene.id ? resizing.seconds : 0))}</span>
              </button>
              {renaming?.id === item.scene.id ? (
                <input
                  aria-label="Scene name"
                  autoFocus
                  className={styles.rename}
                  maxLength={40}
                  onBlur={() => finishRename(true)}
                  onChange={(event) => setRenaming({ draft: event.target.value, id: item.scene.id })}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") finishRename(true);
                    if (event.key === "Escape") finishRename(false);
                  }}
                  value={renaming.draft}
                />
              ) : null}
              <span aria-label={`Change the length of ${item.scene.name}`} className={styles.edge} data-drag="resize" onPointerDown={(event) => startEdgeResize(event, item)} role="separator" />
            </div>
          );
        })}
        {overlapBoxes.map((box) => (
          <span aria-hidden className={styles.overlapBox} key={box.key} style={{ left: `${box.left * 100}%`, width: `${box.width * 100}%` }} />
        ))}
        {Array.from({ length: scenes.items.length + 1 }, (_, place) => {
          const at = place === 0 ? 0 : (scenes.items[place - 1]?.end ?? 0) / Math.max(0.001, total);
          return (
            <span className={styles.slot} data-place={place === 0 ? "start" : place === scenes.items.length ? "end" : "between"} key={place} style={{ left: `${at * 100}%` }}>
              <button aria-label={place === 0 ? "Add a scene at the start" : `Add a scene after ${scenes.items[place - 1]?.scene.name}`} className={styles.plus} onClick={() => insertAt(place)} title="Add a scene here" type="button">
                <Plus size={10} weight="bold" />
              </button>
            </span>
          );
        })}
        {(
          <div aria-label="Move the playhead" className={styles.playheadHit} data-line-only={expanded ? "" : undefined} data-drag="playhead" onPointerDown={startPlayheadDrag} role="slider" aria-valuemax={total} aria-valuemin={0} aria-valuenow={clamped} onPointerEnter={() => setPlayheadHot(true)} onPointerLeave={() => setPlayheadHot(false)} style={{ left: `${playhead * 100}%` }} />
        )}
        </div>
      </div>
      {sceneMenu
        ? (() => {
            const at = scenes.items.findIndex((item) => item.scene.id === sceneMenu.id);
            if (at < 0) return null;
            const last = scenes.items.length - 1;
            const entries: { disabled: boolean; label: string; run: () => void }[] = [
              { disabled: at <= 0, label: "Move backward", run: () => commit(moveScene({ defaults, timelineSeconds: duration, values }, sceneMenu.id, -1), "Move scene") },
              { disabled: at >= last, label: "Move forward", run: () => commit(moveScene({ defaults, timelineSeconds: duration, values }, sceneMenu.id, 1), "Move scene") },
              { disabled: false, label: "Duplicate", run: () => duplicate(sceneMenu.id) },
              { disabled: scenes.items.length < 2, label: "Delete", run: () => commit(removeScene({ defaults, timelineSeconds: duration, values }, sceneMenu.id), "Delete scene") },
            ];
            return createPortal(
              <div className={styles.sceneMenu} data-scene-menu="" role="menu" style={{ left: Math.min(sceneMenu.x, window.innerWidth - 170), top: Math.max(8, sceneMenu.y - entries.length * 30 - 14) }}>
                {entries.map((entry) => (
                  <button
                    className={styles.sceneMenuItem}
                    disabled={entry.disabled}
                    key={entry.label}
                    onClick={() => {
                      setSceneMenu(null);
                      entry.run();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {entry.label}
                  </button>
                ))}
              </div>,
              document.body,
            );
          })()
        : null}
      {!expanded && (playheadHot || playheadDrag) ? (
        <span className={styles.playheadTime} style={{ left: `${(blocksRef.current?.offsetLeft ?? 0) + playhead * (blocksRef.current?.offsetWidth ?? 0)}px` }}>
          {clamped.toFixed(2)}
        </span>
      ) : null}
    </div>,
    host,
  );
}
