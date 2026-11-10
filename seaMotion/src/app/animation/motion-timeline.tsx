import * as React from "react";
import { notePickedLayer } from "../mo/mo-layer-selection";
import { createPortal } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { useAnimationCardTimes, type SegmentTiming } from "./animation-cards";
import { ANIMATION_PARAMS_TARGET, getActiveAnimation } from "./animation-spec";
import { lottieKeyLayers } from "./lottie-keys";
import { MOTION_TYPE_TARGET } from "./motion-type";
import { INTERACTION_LABELS, INTERACTIONS_LIST_TARGET, interactionEnd, patchInteraction, readInteractionsValue, removeInteraction } from "./interactions";
import { newPlanId, PLAN_EFFECTS, planAnimationRange, readInteractionPlan, type InteractionPlanData } from "./interaction-plan";
import { changeScene, moveScene, resolveProjectScenes, loopScene, selectScene, snapToScenes, type SceneEdit } from "./scenes";
import { CAMERA_CARD, handleTimelineWheel, resetTimelineZoom, setPickedCard, setSceneFilter, setTimelineStart, setTimelineView, TIMELINE_LAYOUT_EVENT, useTimelineView, useTimelineZoom } from "./timeline-view";
import { pickVideoPart } from "../media/video-part-pick";
import { setVideoPartDuration, splitVideoParts, VIDEO_SETTINGS_KEY, type VideoSettings } from "../media/media-layer";
import styles from "./motion-timeline.module.css";

// How long the pointer rests on a scene mark before its name shows (0.08 s), and how long the label stays while the pointer
// crosses from one mark to the next (so it glides between marks instead of going out and coming back).
const SCENE_TIP_DELAY_MS = 80;
const SCENE_TIP_GRACE_MS = 140;
const SCENE_TIP_FADE_MS = 120;

const EXPANDED_SELECTOR = '[data-slot="toolcraft-runtime-panel-host"][data-panel-type="timeline"] [data-slot="timeline-expanded"]';
const LABEL_WIDTH = 124;
// The width of the scroll bar column at the right of the rows.
const GUTTER = 6;
const ROW_HEIGHT = 24;
const AUTO_ROWS = 6;
const HEADER_AND_RULER = 36 + 22 + 2;
const SNAP_PIXELS = 7;
const MIN_SECONDS = 0.05;
const STAMP_HALF = 52;
const HEIGHT_KEY = "mo.timeline.height";

type Edit =
  | { kind: "camera"; sceneId: string }
  | { id: string; kind: "plan" }
  | { id: string; kind: "reactor" }
  | { kind: "sceneLength"; sceneId: string }
  | { kind: "timing"; timing: SegmentTiming }
  | { clip: string; index: number; kind: "video" };

// `resizeOnly`: only the right edge can be dragged (the body still opens the scene).
// `card`: the Animations tab card that opens while the bar is picked; `layer`: the layer (id) that is chosen in the Layers panel with it.
type Bar = Readonly<{ card?: string; marks?: readonly number[]; edit?: Edit; layer?: string; properties?: boolean; end: number; id: string; label: string; keys?: boolean; resizeOnly?: boolean; scene?: string; start: number }>;
// `group`: a row that opens and closes the rows of its group (`open` tells which); `indent`: a row inside a group.
type Row = Readonly<{ bars: readonly Bar[]; group?: Readonly<{ key: string; open: boolean }>; hint?: string; id: string; indent?: boolean; label: string }>;

const round = (value: number): number => Math.round(value * 100) / 100;

// The bottom timeline's body: the Toolcraft keyframe rows are replaced by rows of this motion. All: scene blocks and a row each for
// the camera, the layer effects, the Reactor, the video and the music across the full length. One scene: its layer effects (the plan's
// Animations), camera and Reactor items; a bar can be dragged to retime it (its body moves it, its right edge changes its length).
export function MotionTimeline(): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const defaults = useToolcraftSelector((state) => state.defaults);
  const duration = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const time = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const isPlaying = useToolcraftSelector((state) => state.timeline.isPlaying);
  const layers = useToolcraftSelector((state) => state.layers);
  const view = useTimelineView();
  const [mount, setMount] = React.useState<HTMLElement | null>(null);
  const [lock, setLock] = React.useState<{ length: number; start: number } | null>(null);
  const [gripMount, setGripMount] = React.useState<HTMLElement | null>(null);
  const [width, setWidth] = React.useState(0);
  // The bar picked with a click; Delete removes it, the arrow keys nudge it, Esc or a click on empty space lets it go.
  const [selected, setSelected] = React.useState<string | null>(null);
  // More bars picked with Shift (or Cmd / Ctrl) + click, or Cmd / Ctrl + A: they move, nudge and delete together with the first one.
  const [extra, setExtra] = React.useState<string[]>([]);
  const picks = selected ? [selected, ...extra] : [];
  const setPicks = (ids: readonly string[]): void => {
    setSelected(ids[0] ?? null);
    setExtra(ids.slice(1));
  };
  // The keyframe (a bar's start or end diamond) picked with a click: "<bar id>|start" or "<bar id>|end". It comes before the playhead.
  // A thin scroll indicator of our own, in the column at the right of the rows (the native bar is hidden).
  const rowsRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ height: number; top: number } | null>(null);
  const syncThumb = (): void => {
    const box = rowsRef.current;
    if (!box || box.scrollHeight <= box.clientHeight + 1) {
      setThumb((current) => (current === null ? current : null));
      return;
    }
    const height = Math.max(20, (box.clientHeight / box.scrollHeight) * box.clientHeight);
    const top = (box.scrollTop / (box.scrollHeight - box.clientHeight)) * (box.clientHeight - height);
    setThumb((current) => (current && Math.abs(current.height - height) < 0.5 && Math.abs(current.top - top) < 0.5 ? current : { height, top }));
  };
  React.useEffect(() => {
    syncThumb();
    const timer = window.setInterval(syncThumb, 300);
    return () => window.clearInterval(timer);
  });
  const dragThumb = (event: React.PointerEvent): void => {
    const box = rowsRef.current;
    if (!box || !thumb) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startTop = box.scrollTop;
    const ratio = (box.scrollHeight - box.clientHeight) / Math.max(1, box.clientHeight - thumb.height);
    const move = (e: PointerEvent): void => {
      box.scrollTop = startTop + (e.clientY - startY) * ratio;
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // The sideways scroll bar under the rows (shown when zoomed in): drag its thumb to slide the window.
  const dragHThumb = (event: React.PointerEvent): void => {
    const bar = (event.currentTarget as HTMLElement).parentElement;
    if (!bar) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startStart = zoom.start;
    const move = (e: PointerEvent): void => setTimelineStart(startStart + (e.clientX - startX) / Math.max(1, bar.getBoundingClientRect().width));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // A picked bar chooses its layer and the left panel shows the Layers tab.
  const chooseLayer = (layerId: string | undefined, properties = false): void => {
    if (!layerId) return;
    // A video part opens the layer's own properties (Modifier tab: the part that plays, backwards, sound …).
    if (properties) dispatch({ label: "Layer properties", target: "inspector.tab", type: "controls.setValue", value: "modifier" });
    notePickedLayer();
    dispatch({ layerId, type: "layers.select" });
    window.dispatchEvent(new Event("mo-show-layers"));
  };
  const [pickedKey, setPickedKey] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<{ from?: number; group?: readonly string[]; id: string; resize: boolean; row?: string; seconds: number } | null>(null);
  const [userHeight, setUserHeight] = React.useState<number | null>(() => {
    try {
      const saved = Number(window.localStorage.getItem(HEIGHT_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : null;
    } catch {
      return null;
    }
  });
  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<typeof drag>(null);
  const justDragged = React.useRef(false);
  dragRef.current = drag;

  // Our own container inside the expanded timeline, which hides what Toolcraft draws there (see styles.css).
  React.useEffect(() => {
    let own: HTMLElement | null = null;
    let gripHost: HTMLElement | null = null;
    const find = (): void => {
      const expanded = document.querySelector<HTMLElement>(EXPANDED_SELECTOR);
      if (!expanded) {
        if (own) {
          own.remove();
          own = null;
          gripHost?.remove();
          gripHost = null;
          setMount(null);
          setGripMount(null);
          document.documentElement.style.removeProperty("--mo-tracks-height");
        }
        return;
      }
      if (own && own.parentElement === expanded) return;
      own?.remove();
      own = document.createElement("div");
      own.setAttribute("data-mo-tracks", "");
      own.style.display = "flex";
      own.style.flex = "1 1 0";
      own.style.minHeight = "0";
      expanded.appendChild(own);
      setMount(own);
      // The grip sits on the top edge of the whole panel, above its header, so the top edge is the one that moves.
      gripHost?.remove();
      const panel = expanded.closest<HTMLElement>('[data-slot="timeline-panel"]');
      if (panel) {
        gripHost = document.createElement("div");
        gripHost.setAttribute("data-mo-tracks-grip", "");
        panel.appendChild(gripHost);
        setGripMount(gripHost);
      }
    };
    find();
    const timer = window.setInterval(find, 250);
    return () => {
      window.clearInterval(timer);
      gripHost?.remove();
      own?.remove();
      document.documentElement.style.removeProperty("--mo-tracks-height");
    };
  }, []);

  React.useEffect(() => {
    if (!mount) return;
    // The bars are laid out over the narrower of the ruler and a row's track, so the last bar's end is never cut off by the edge.
    const measure = (): void => {
      const ruler = trackRef.current?.getBoundingClientRect().width ?? 0;
      const row = trackRef.current?.closest("[data-mo-tracks]")?.querySelector<HTMLElement>("[class*=rows] [class*=track]")?.getBoundingClientRect().width;
      setWidth(row && row > 0 ? Math.min(ruler, row) : ruler);
    };
    measure();
    const timer = window.setInterval(measure, 300);
    return () => window.clearInterval(timer);
  }, [mount]);

  const scenes = resolveProjectScenes(values, duration);
  const active = scenes.items[scenes.activeIndex];
  const total = Math.max(0.1, scenes.items[scenes.items.length - 1]?.end ?? duration);
  // The time the ruler shows: All, the whole motion; a scene, that scene's own length (its time starts at 0).
  // While the playhead is dragged the ruler keeps the range it had (the scene that follows the playhead must not move it under the pointer).
  const baseStart = view === "scene" && active ? active.start : 0;
  const baseLength = Math.max(0.1, view === "scene" && active ? active.end - active.start : total);
  // Zoomed in (Ctrl / Cmd + wheel over the keyframe area or the scenes strip), the window is a part of that range.
  const zoom = useTimelineZoom();
  const rangeStart = lock ? lock.start : baseStart + zoom.start * baseLength;
  const rangeLength = lock ? lock.length : baseLength / zoom.zoom;
  const layerName = (id: string): string => {
    if (!id) return "Whole frame";
    const layer = layers.find((item) => item.id === id);
    return layer ? (layer.displayName ?? layer.name) : id;
  };
  const effectName = (value: string): string => PLAN_EFFECTS.find((item) => item.value === value)?.label ?? value;

  const planOf = (params: unknown): InteractionPlanData => readInteractionPlan(params);

  // Folding the timeline takes the height it was given away at once (what sits above it follows in the same frame, not on the next look).
  const timelineOpen = useToolcraftSelector((state) => state.timeline.expanded);
  React.useEffect(() => {
    if (!timelineOpen) document.documentElement.style.removeProperty("--mo-tracks-height");
  }, [timelineOpen]);
  const { cards: cardTimes, slides, timings } = useAnimationCardTimes();
  // Choosing a layer (Layers panel or canvas) shows its motion in the Motion Plan: the segment tab or the Animations tab, whichever has it,
  // with its card open; choosing nothing folds the cards.
  const selectedLayerId = useToolcraftSelector((state) => state.selectedLayerId);
  React.useEffect(() => {
    if (!selectedLayerId) {
      setPickedCard(null);
      return;
    }
    const layer = layers.find((item) => item.id === selectedLayerId);
    const names = [layer?.displayName, layer?.name].filter((name): name is string => Boolean(name));
    const tokens = (text: string): string[] => text.split(" · ").map((part) => part.trim());
    const slide = slides.find((item) => item.id === selectedLayerId);
    const effect = cardTimes.find((item) => item.on && tokens(item.layer).some((part) => names.includes(part)));
    const segment = timings.find((item) => tokens(item.layer).some((part) => names.includes(part)));
    setPickedCard(slide ? `Step ${slide.step + 1} · Slide in` : (effect?.card ?? segment?.group ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);
  // The slide-in groups that are opened (one row per layer inside).
  const [openGroups, setOpenGroups] = React.useState<ReadonlySet<string>>(new Set());
  // The name of the scene whose mark the pointer rests on, on the Scenes row: it fades in after a moment, glides to the next
  // mark, and fades out when the pointer leaves the marks.
  const [sceneTip, setSceneTip] = React.useState<{ name: string; x: number; y: number } | null>(null);
  const [sceneTipOpen, setSceneTipOpen] = React.useState(false);
  const sceneTipRef = React.useRef<{ id: string | null; remove: number; timer: number; visible: boolean }>({ id: null, remove: 0, timer: 0, visible: false });
  const showSceneTip = React.useCallback((name: string, x: number, y: number): void => {
    const state = sceneTipRef.current;
    window.clearTimeout(state.remove);
    state.visible = true;
    setSceneTip({ name, x, y });
    setSceneTipOpen(true);
  }, []);
  const hideSceneTip = React.useCallback((): void => {
    const state = sceneTipRef.current;
    state.visible = false;
    setSceneTipOpen(false);
    window.clearTimeout(state.remove);
    state.remove = window.setTimeout(() => setSceneTip(null), SCENE_TIP_FADE_MS + 40);
  }, []);
  const clearSceneTip = React.useCallback((): void => {
    window.clearTimeout(sceneTipRef.current.timer);
    sceneTipRef.current.id = null;
    hideSceneTip();
  }, [hideSceneTip]);
  React.useEffect(
    () => () => {
      window.clearTimeout(sceneTipRef.current.timer);
      window.clearTimeout(sceneTipRef.current.remove);
    },
    [],
  );
  // The layer (id) a name from the animation's controls stands for ("Numbers", "Occupancy · Rent collection" → the first that exists).
  const layerIdFor = (name: string): string | undefined => {
    const parts = name.split(" · ").map((part) => part.trim());
    return layers.find((item) => parts.includes(item.displayName ?? item.name))?.id;
  };
  const rows: Row[] = React.useMemo(() => {
    const out: Row[] = [];
    if (view === "scene" && active) {
      const offset = active.start;
      const plan = planOf(values[ANIMATION_PARAMS_TARGET]);
      // Rows of the same layer sit together; each effect's bar has a keyframe at both ends.
      const layerOrder = [...new Set(plan.animations.map((animation) => animation.layer))];
      const ordered = [...plan.animations].sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer));
      for (const animation of ordered) {
        const [from, to] = planAnimationRange(plan, animation);
        out.push({ bars: [{ edit: { id: animation.id, kind: "plan" }, keys: true, end: offset + to, id: animation.id, label: effectName(animation.effect), start: offset + from }], id: animation.id, label: `${layerName(animation.layer)}` });
      }
      // The scene's own timed changes (the count of "Data change"), layer by layer: drag to move, drag the right edge to change the time.
      for (const timing of timings) {
        out.push({ bars: [{ edit: { kind: "timing", timing }, layer: layerIdFor(timing.layer), card: timing.group, end: timing.end, id: `timing-${timing.timeId}`, keys: true, label: timing.label, start: timing.start }], id: `timing-${timing.timeId}`, label: timing.layer });
      }
      // The duration of a step's slide-ins is its own setting (Step n › Duration): resizing the end of its bars changes it.
      const slideEdit = (slide: { end: number; start: number; step: number } | undefined): Edit | undefined =>
        slide ? { kind: "timing", timing: { delay: 0, delayId: "", delayMax: 0, end: slide.end, group: "", label: "Slide in", layer: "", start: slide.start, time: slide.end - slide.start, timeId: `enter.${slide.step + 1}.time`, timeMax: 3, timeMin: 0.1 } } : undefined;
      // The slide-ins of the scene's part, a group for each step (the layers of a step slide in together), a row per layer inside it.
      const steps = [...new Set(slides.map((slide) => slide.step))].sort((a, b) => a - b);
      for (const step of steps) {
        const own = slides.filter((slide) => slide.step === step);
        const key = `slide-${step}`;
        const open = openGroups.has(key);
        out.push({
          bars: [{ card: `Step ${step + 1} · Slide in`, edit: slideEdit(own[0]), end: Math.max(...own.map((slide) => slide.end)), id: `${key}-group`, keys: true, label: `Slide in · ${own.length} ${own.length === 1 ? "layer" : "layers"}`, resizeOnly: true, start: Math.min(...own.map((slide) => slide.start)) }],
          group: { key, open },
          id: key,
          label: `Slide in ${step + 1}`,
        });
        if (open) for (const slide of own) out.push({ bars: [{ card: `Step ${step + 1} · Slide in`, edit: slideEdit(slide), layer: slide.id, end: slide.end, id: `${key}-${slide.id}`, keys: true, label: "Slide in", resizeOnly: true, start: slide.start }], id: `${key}-${slide.id}`, indent: true, label: layerName(slide.id) });
      }
      // The effects of the design's own motion (the Animations tab's cards): a keyframe at the start and at the end of the time each works.
      for (const item of cardTimes) {
        if (!item.on) continue;
        out.push({ bars: [{ card: item.card, layer: layerIdFor(item.layer), end: item.range[1], id: `card-${item.card}`, keys: true, label: item.effect, start: item.range[0] }], id: `card-${item.card}`, label: item.layer || item.card });
      }
      // A Lottie animation's own keyframes (they are in the file, not in a plan): a row per layer that opens into its properties.
      const lottie = lottieKeyLayers(getActiveAnimation(values)?.lottie);
      for (const layer of lottie) {
        const key = `lottie-${layer.id}`;
        const open = !openGroups.has(`${key}-folded`);
        const all = layer.properties.flatMap((property) => property.times);
        const bar = (id: string, label: string, times: readonly number[]): Bar => ({ end: offset + Math.max(...times), id, keys: true, label, layer: layer.id, marks: times.slice(1, -1).map((time) => offset + time), start: offset + Math.min(...times) });
        out.push({ bars: [bar(`${key}-all`, "Keyframes", all)], group: { key: `${key}-folded`, open }, id: key, label: layer.name });
        if (open) for (const property of layer.properties) out.push({ bars: [bar(`${key}-${property.label}`, property.label, property.times)], id: `${key}-${property.label}`, indent: true, label: property.label });
      }
      if (plan.animations.length === 0 && cardTimes.length === 0 && lottie.length === 0) out.push({ bars: [], hint: "No layer effects yet: add them in Motion Plan › Animations, then drag their bars here.", id: "fx-hint", label: "Layer effects" });
      const camera = active.scene.camera;
      if (camera) out.push({ bars: [{ card: CAMERA_CARD, edit: { kind: "camera", sceneId: active.scene.id }, keys: true, end: offset + camera.delay + camera.duration, id: "camera", label: "Zoom · angle · tilt", start: offset + camera.delay }], id: "camera", label: "Camera" });
      for (const item of readInteractionsValue(values[INTERACTIONS_LIST_TARGET]).items) {
        out.push({ bars: [{ edit: { id: item.id, kind: "reactor" }, end: offset + interactionEnd(item), id: item.id, label: INTERACTION_LABELS[item.type], start: offset + item.start }], id: item.id, label: `Reactor · ${INTERACTION_LABELS[item.type]}` });
      }
      return out;
    }
    // One row per scene, stepping down in order, so the sequence reads top to bottom.
    const scenesOpen = !openGroups.has("scenes-folded");
    out.push({
      bars: [{ end: Math.max(...scenes.items.map((item) => item.end)), id: "scenes-group", label: `${scenes.items.length} ${scenes.items.length === 1 ? "scene" : "scenes"}`, resizeOnly: true, start: 0 }],
      group: { key: "scenes-folded", open: scenesOpen },
      id: "scenes-group",
      // The count sits in the row's name; the bar itself only carries the scene markers.
      label: `Scenes · ${scenes.items.length}`,
    });
    if (scenesOpen) scenes.items.forEach((item, order) => {
      out.push({
        bars: [{ edit: { kind: "sceneLength" as const, sceneId: item.scene.id }, end: item.end, id: item.scene.id, label: item.scene.name, resizeOnly: true, scene: item.scene.id, start: item.start }],
        id: `scene-row-${item.scene.id}`,
        indent: true,
        label: `${String(order + 1).padStart(2, "0")} · ${item.scene.name}`,
      });
    });
    // The layer effects, the camera and the Reactor items belong to a scene: they show in the scene's own view, not here (all
    // of them on one row were a pile of overlapping labels).
    // The Reactor items belong to a scene: they show in the scene's own view, not here.
    // A Lottie file holds neither video nor music: those rows stay out.
    if (values[MOTION_TYPE_TARGET] === "lottie") return out;
    const video = values[ANIMATION_PARAMS_TARGET] as Record<string, unknown> | undefined;
    const clips = (video?.[VIDEO_SETTINGS_KEY] ?? {}) as Record<string, VideoSettings>;
    out.push({
      bars: Object.entries(clips).flatMap(([clip, settings]) => (settings.segments ?? []).map((part, index) => ({ edit: { clip, index, kind: "video" as const }, layer: clip.replace(/^pic-/, ""), properties: true, end: part.to, id: `video-${clip}-${index}`, label: part.end < part.start ? "Video ◀ reverse" : "Video ▶", resizeOnly: true, start: part.from }))),
      id: "video",
      label: "Video",
    });
    const music = scenes.items.filter((item) => (item.active ? values["sound.music"] : item.scene.slice["sound.music"]) === true);
    const first = music[0];
    const last = music[music.length - 1];
    out.push({ bars: first && last ? [{ end: total, id: "bgm", label: "Background music", start: 0 }] : [], id: "music", label: "Music" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scenes.items, scenes.activeIndex, values, layers, total, cardTimes, timings, slides, openGroups]);

  // The height the panel needs for these rows.
  // The same height for every scene and for All (the rows scroll when there are more): it does not depend on how many rows a scene has.
  const visibleRows = AUTO_ROWS;
  const minHeight = HEADER_AND_RULER + 2 * ROW_HEIGHT;
  const maxHeight = Math.max(minHeight, Math.round(window.innerHeight * 0.6));
  const panelHeight = Math.min(maxHeight, Math.max(minHeight, userHeight ?? HEADER_AND_RULER + visibleRows * ROW_HEIGHT));
  React.useEffect(() => {
    if (!mount) return;
    document.documentElement.style.setProperty("--mo-tracks-height", `${panelHeight}px`);
  }, [mount, panelHeight]);

  // The grip at the top of the timeline: drag up for a taller timeline, down for a shorter one; a double click goes back to the height
  // that fits the rows.
  const startResize = (event: React.PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = panelHeight;
    document.documentElement.dataset.moDragging = "height";
    let latest = startHeight;
    const move = (e: PointerEvent): void => {
      latest = Math.min(maxHeight, Math.max(minHeight, startHeight + (startY - e.clientY)));
      const height = Math.round(latest);
      // The panel and the scenes strip are both placed from this one variable, bottom up (styles.css), so they move together.
      document.documentElement.style.setProperty("--mo-tracks-height", `${height}px`);
      setUserHeight(height);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      try {
        window.localStorage.setItem(HEIGHT_KEY, String(Math.round(latest)));
      } catch {
        // The height is not remembered.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const resetHeight = (): void => {
    setUserHeight(null);
    try {
      window.localStorage.removeItem(HEIGHT_KEY);
    } catch {
      // Nothing was remembered.
    }
  };

  const toX = (seconds: number): number => ((seconds - rangeStart) / rangeLength) * Math.max(1, width);
  const seek = (clientX: number): void => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const seconds = rangeStart + Math.min(rangeLength, Math.max(0, ((clientX - box.left) / box.width) * rangeLength));
    dispatch({ currentTimeSeconds: seconds, type: "timeline.setCurrentTime" });
  };

  // The playhead: pressing the ruler, an empty place of a row or the playhead itself puts it there; keeping the button down drags it.
  // Playback stops while it is dragged.
  const scrub = (event: React.PointerEvent): void => {
    // A keyframe under the pointer comes first, also where the playhead sits on it: the press goes to the keyframe.
    const key = document.elementsFromPoint(event.clientX, event.clientY).find((element): element is HTMLElement => element instanceof HTMLElement && element.dataset.key !== undefined);
    if (key && event.target !== key) {
      event.preventDefault();
      event.stopPropagation();
      key.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: event.button, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId }));
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dispatch({ isPlaying: false, type: "timeline.setPlaying" });
    const range = { length: rangeLength, start: rangeStart };
    const box = trackRef.current?.getBoundingClientRect();
    const seekIn = (clientX: number, free = false): void => {
      if (!box || box.width <= 0) return;
      const seconds = range.start + Math.min(range.length, Math.max(0, ((clientX - box.left) / box.width) * range.length));
      // The playhead snaps to the start and end of every scene (about 7 px of reach; hold Alt to move it freely).
      dispatch({ currentTimeSeconds: free ? seconds : snapToScenes(scenes, seconds, (SNAP_PIXELS / box.width) * range.length), type: "timeline.setCurrentTime" });
    };
    setLock(range);
    seekIn(event.clientX, event.altKey);
    document.documentElement.dataset.moDragging = "resize";
    const move = (e: PointerEvent): void => seekIn(e.clientX, e.altKey);
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      setLock(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const commit = (bar: Bar, delta: number, resize: boolean): void => {
    const edit = bar.edit;
    if (!edit || Math.abs(delta) < 0.005) return;
    if (edit.kind === "plan") {
      const plan = planOf(values[ANIMATION_PARAMS_TARGET]);
      const next = {
        ...plan,
        animations: plan.animations.map((animation) =>
          animation.id === edit.id
            ? resize
              ? { ...animation, duration: round(Math.max(MIN_SECONDS, animation.duration + delta)) }
              : { ...animation, delay: round(Math.max(0, animation.delay + delta)) }
            : animation,
        ),
      };
      const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      dispatch({ label: "Retime animation", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, plan: next } });
    } else if (edit.kind === "camera") {
      const scene = scenes.items.find((item) => item.scene.id === edit.sceneId);
      const camera = scene?.scene.camera;
      if (!scene || !camera) return;
      const changed = resize
        ? { ...camera, duration: round(Math.min(Math.max(MIN_SECONDS, camera.duration + delta), 60)) }
        : { ...camera, delay: round(Math.min(Math.max(0, camera.delay + delta), Math.max(0, scene.duration - MIN_SECONDS))) };
      const result = changeScene({ defaults, timelineSeconds: duration, values }, edit.sceneId, { camera: changed });
      if (result) dispatch({ label: "Retime camera", type: "controls.apply", values: result.values });
    } else if (edit.kind === "timing") {
      const { timing } = edit;
      const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      const next = resize
        ? { [timing.timeId]: round(Math.min(timing.timeMax, Math.max(timing.timeMin, timing.time + delta))) }
        : timing.delayId
          ? { [timing.delayId]: round(Math.min(timing.delayMax, Math.max(0, timing.delay + delta))) }
          : {};
      dispatch({ label: "Retime change", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, ...next } });
    } else if (edit.kind === "sceneLength") {
      const scene = scenes.items.find((item) => item.scene.id === edit.sceneId);
      if (!scene || !resize) return;
      const result: SceneEdit | null = changeScene({ defaults, timelineSeconds: duration, values }, edit.sceneId, { duration: round(scene.duration + delta) });
      if (!result) return;
      dispatch({ label: "Scene length", type: "controls.apply", values: result.values });
      if (result.durationSeconds !== null && Math.abs(result.durationSeconds - duration) > 0.001) dispatch({ durationSeconds: result.durationSeconds, type: "timeline.setDuration" });
    } else if (edit.kind === "video") {
      const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      const clips = (params[VIDEO_SETTINGS_KEY] ?? {}) as Record<string, VideoSettings>;
      const settings = clips[edit.clip];
      const parts = settings?.segments;
      const part = parts?.[edit.index];
      if (!settings || !parts || !part || !resize) return;
      const segments = setVideoPartDuration(parts, edit.index, part.to - part.from + delta, settings.timing !== "manual", 600, getActiveAnimation(values)?.assetMedia?.[edit.clip]?.duration ?? 600);
      dispatch({ label: "Retime video part", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [VIDEO_SETTINGS_KEY]: { ...clips, [edit.clip]: { ...settings, segments } } } });
    } else {
      const value = readInteractionsValue(values[INTERACTIONS_LIST_TARGET]);
      const item = value.items.find((entry) => entry.id === edit.id);
      if (!item) return;
      const changes = resize ? { duration: round(Math.max(MIN_SECONDS, item.duration + delta)) } : { start: round(Math.max(0, item.start + delta)) };
      dispatch({ label: "Retime Reactor item", target: INTERACTIONS_LIST_TARGET, type: "controls.setValue", value: { ...value, items: patchInteraction(value.items, edit.id, changes) } });
    }
  };

  // Several picked bars retimed at once: the plan animations (and the timed changes) go in one change of the animation's parameters and the
  // Reactor items in one change of the Reactor, so one does not overwrite the other; the rest are retimed one by one.
  const commitMany = (bars: readonly Bar[], delta: number, resize: boolean): void => {
    if (bars.length === 1 && bars[0]) return commit(bars[0], delta, resize);
    if (Math.abs(delta) < 0.005) return;
    let params = { ...((values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>) };
    let paramsChanged = false;
    const planned = new Set(bars.flatMap((bar) => (bar.edit?.kind === "plan" && (resize || !bar.resizeOnly) ? [bar.edit.id] : [])));
    if (planned.size > 0) {
      const plan = planOf(values[ANIMATION_PARAMS_TARGET]);
      const animations = plan.animations.map((animation) =>
        !planned.has(animation.id)
          ? animation
          : resize
            ? { ...animation, duration: round(Math.max(MIN_SECONDS, animation.duration + delta)) }
            : { ...animation, delay: round(Math.max(0, animation.delay + delta)) },
      );
      params = { ...params, plan: { ...plan, animations } };
      paramsChanged = true;
    }
    for (const bar of bars) {
      const edit = bar.edit;
      if (edit?.kind !== "timing") continue;
      const { timing } = edit;
      const next = resize
        ? { [timing.timeId]: round(Math.min(timing.timeMax, Math.max(timing.timeMin, timing.time + delta))) }
        : timing.delayId
          ? { [timing.delayId]: round(Math.min(timing.delayMax, Math.max(0, timing.delay + delta))) }
          : {};
      params = { ...params, ...next };
      paramsChanged = true;
    }
    if (paramsChanged) dispatch({ label: "Retime animations", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: params });
    const reactor = new Set(bars.flatMap((bar) => (bar.edit?.kind === "reactor" ? [bar.edit.id] : [])));
    if (reactor.size > 0) {
      const value = readInteractionsValue(values[INTERACTIONS_LIST_TARGET]);
      const items = value.items.map((item) =>
        !reactor.has(item.id) ? item : resize ? { ...item, duration: round(Math.max(MIN_SECONDS, item.duration + delta)) } : { ...item, start: round(Math.max(0, item.start + delta)) },
      );
      dispatch({ label: "Retime Reactor items", target: INTERACTIONS_LIST_TARGET, type: "controls.setValue", value: { ...value, items } });
    }
    for (const bar of bars) if (bar.edit && bar.edit.kind !== "plan" && bar.edit.kind !== "timing" && bar.edit.kind !== "reactor") commit(bar, delta, resize);
  };

  // Cmd / Ctrl + D: a copy of each picked bar (plan animations and Reactor items), put right after the picked ones (the time they span later),
  // with the same settings and layer; the copies become the picked bars.
  const duplicateMany = (bars: readonly Bar[]): void => {
    const copyable = bars.filter((bar) => bar.edit && (bar.edit.kind === "plan" || bar.edit.kind === "reactor"));
    if (copyable.length === 0) return;
    const span = Math.max(0.05, Math.max(...copyable.map((bar) => bar.end)) - Math.min(...copyable.map((bar) => bar.start)));
    const made: string[] = [];
    const planned = new Set(copyable.flatMap((bar) => (bar.edit?.kind === "plan" ? [bar.edit.id] : [])));
    if (planned.size > 0) {
      const plan = planOf(values[ANIMATION_PARAMS_TARGET]);
      const copies = plan.animations
        .filter((animation) => planned.has(animation.id))
        .map((animation) => {
          const id = newPlanId("fx");
          made.push(id);
          return { ...animation, delay: round(animation.delay + span), id, name: `${animation.name} copy`.slice(0, 80) };
        });
      const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      dispatch({ label: "Duplicate animations", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, plan: { ...plan, animations: [...plan.animations, ...copies] } } });
    }
    const reactor = new Set(copyable.flatMap((bar) => (bar.edit?.kind === "reactor" ? [bar.edit.id] : [])));
    if (reactor.size > 0) {
      const value = readInteractionsValue(values[INTERACTIONS_LIST_TARGET]);
      const copies = value.items
        .filter((item) => reactor.has(item.id))
        .map((item) => {
          const id = newPlanId("ix");
          made.push(id);
          return { ...item, id, start: round(item.start + span) };
        });
      dispatch({ label: "Duplicate Reactor items", target: INTERACTIONS_LIST_TARGET, type: "controls.setValue", value: { ...value, items: [...value.items, ...copies] } });
    }
    if (made.length > 0) setPicks(made);
  };

  // Delete on several picked bars: all the plan animations and all the Reactor items in one change each.
  // Video parts: hold Cmd / Ctrl over a part to see where it would be cut (scissors and a line at the pointer); Cmd / Ctrl + click cuts it there.
  const [cutHover, setCutHover] = React.useState<{ id: string; x: number } | null>(null);
  React.useEffect(() => {
    const release = (event: KeyboardEvent): void => {
      if (event.key === "Meta" || event.key === "Control") setCutHover(null);
    };
    window.addEventListener("keyup", release);
    return () => window.removeEventListener("keyup", release);
  }, []);
  const splitVideoAt = (clip: string, seconds: number): void => {
    const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
    const clips = (params[VIDEO_SETTINGS_KEY] ?? {}) as Record<string, VideoSettings>;
    const settings = clips[clip];
    const split = settings?.segments ? splitVideoParts(settings.segments, seconds) : null;
    if (settings && split) dispatch({ label: "Split video", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [VIDEO_SETTINGS_KEY]: { ...clips, [clip]: { ...settings, segments: split } } } });
  };
  const removeMany = (bars: readonly Bar[]): void => {
    if (bars.length === 1 && bars[0]) return removeBar(bars[0]);
    const gone = new Set(bars.flatMap((bar) => (bar.edit?.kind === "plan" ? [bar.edit.id] : [])));
    if (gone.size > 0) {
      const plan = planOf(values[ANIMATION_PARAMS_TARGET]);
      const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      dispatch({ label: "Delete animations", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, plan: { ...plan, animations: plan.animations.filter((animation) => !gone.has(animation.id)) } } });
    }
    const reactor = new Set(bars.flatMap((bar) => (bar.edit?.kind === "reactor" ? [bar.edit.id] : [])));
    if (reactor.size > 0) {
      const value = readInteractionsValue(values[INTERACTIONS_LIST_TARGET]);
      dispatch({ label: "Delete Reactor items", target: INTERACTIONS_LIST_TARGET, type: "controls.setValue", value: { ...value, items: value.items.filter((item) => !reactor.has(item.id)) } });
    }
    for (const bar of bars) if (bar.edit?.kind === "camera") removeBar(bar);
  };

  // The scenes are a sequence: dragging a scene bar sideways moves it to another place in the order (a line shows where it lands).
  const [sceneDrag, setSceneDrag] = React.useState<{ id: string; line: number; to: number } | null>(null);
  const startSceneMove = (event: React.PointerEvent, sceneId: string): void => {
    if (event.button !== 0) return;
    const box = trackRef.current?.getBoundingClientRect();
    const from = scenes.items.findIndex((item) => item.scene.id === sceneId);
    if (!box || box.width <= 0 || from < 0) return;
    const startX = event.clientX;
    let moved = false;
    const place = (clientX: number): { line: number; to: number } => {
      const seconds = rangeStart + ((clientX - box.left) / box.width) * rangeLength;
      const others = scenes.items.filter((item) => item.scene.id !== sceneId);
      const to = others.filter((item) => (item.start + item.end) / 2 < seconds).length;
      const before = others[to - 1];
      return { line: before ? before.end : 0, to };
    };
    const move = (e: PointerEvent): void => {
      if (!moved && Math.abs(e.clientX - startX) < 5) return;
      if (!moved) {
        moved = true;
        document.documentElement.dataset.moDragging = "move";
      }
      setSceneDrag({ id: sceneId, ...place(e.clientX) });
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      delete document.documentElement.dataset.moDragging;
      const { to } = place(e.clientX);
      setSceneDrag(null);
      // A drag is not a click.
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 60);
      const edit = to === from ? null : moveScene({ defaults, timelineSeconds: duration, values }, sceneId, to - from);
      if (edit) dispatch({ label: "Move scene", type: "controls.apply", values: edit.values });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startDrag = (event: React.PointerEvent, bar: Bar, resize: boolean, picked: readonly string[] = [bar.id]): void => {
    if (!bar.edit) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const perPixel = rangeLength / Math.max(1, width);
    // Resizing a scene moves the scenes after it with it (shown while dragging).
    const ripple = bar.edit?.kind === "sceneLength" ? { from: bar.end, row: "scene-row" } : {};
    // The bars picked together move together (only bars that can be retimed this way).
    const every = rows.flatMap((row) => row.bars);
    const group = picked.includes(bar.id) && picked.length > 1 ? every.filter((item) => picked.includes(item.id) && item.edit && (resize || !item.resizeOnly)) : [bar];
    const ids = group.map((item) => item.id);
    setDrag({ ...ripple, group: ids, id: bar.id, resize, seconds: 0 });
    document.documentElement.dataset.moDragging = resize ? "resize" : "move";
    const move = (e: PointerEvent): void => setDrag({ ...ripple, group: ids, id: bar.id, resize, seconds: (e.clientX - startX) * perPixel });
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      const seconds = (e.clientX - startX) * perPixel;
      setDrag(null);
      // A drag is not a click: the click that follows the release does not open the scene.
      if (Math.abs(e.clientX - startX) > 3) {
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 60);
      } else if (group.length > 1 && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
        // A click on one of the picked bars lets go of the others.
        setPicks([bar.id]);
      }
      commitMany(group, seconds, resize);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The left edge of a scene's bar (not the first scene): dragging it makes the scene start earlier, over the end of the scene before it
  // (they overlap and play together), or later again. The scene slides: what it holds moves with it, nothing is stretched, and the
  // scenes after it follow.
  const [leadDrag, setLeadDrag] = React.useState<{ id: string; seconds: number } | null>(null);
  const startLeadDrag = (event: React.PointerEvent, sceneId: string): void => {
    const item = scenes.items.find((each) => each.scene.id === sceneId);
    const before = item ? scenes.items[item.index - 1] : undefined;
    if (!item || !before || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const perPixel = rangeLength / Math.max(1, width);
    const most = Math.max(0, Math.min(before.duration, item.duration) - MIN_SECONDS);
    // The new overlap in seconds, in frames of a hundredth; dragging left makes it longer.
    const overlapAt = (clientX: number): number => Math.min(most, Math.max(0, Math.round((item.lead - (clientX - startX) * perPixel) * 100) / 100));
    setLeadDrag({ id: sceneId, seconds: item.lead - overlapAt(startX) });
    document.documentElement.dataset.moDragging = "resize";
    const move = (e: PointerEvent): void => setLeadDrag({ id: sceneId, seconds: item.lead - overlapAt(e.clientX) });
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      setLeadDrag(null);
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 60);
      const lead = overlapAt(e.clientX);
      if (Math.abs(lead - item.lead) < 0.005) return;
      const result = changeScene({ defaults, timelineSeconds: duration, values }, sceneId, { lead });
      if (!result) return;
      dispatch({ label: "Scene overlap", type: "controls.apply", values: result.values });
      if (result.durationSeconds !== null && Math.abs(result.durationSeconds - duration) > 0.001) dispatch({ durationSeconds: result.durationSeconds, type: "timeline.setDuration" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Delete on a picked bar: a plan animation or a Reactor item goes, the camera is turned off; the other bars cannot be deleted here.
  const removeBar = (bar: Bar): void => {
    const edit = bar.edit;
    if (!edit) return;
    if (edit.kind === "plan") {
      const plan = planOf(values[ANIMATION_PARAMS_TARGET]);
      const params = (values[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      dispatch({ label: "Delete animation", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, plan: { ...plan, animations: plan.animations.filter((animation) => animation.id !== edit.id) } } });
    } else if (edit.kind === "reactor") {
      const value = readInteractionsValue(values[INTERACTIONS_LIST_TARGET]);
      dispatch({ label: "Delete Reactor item", target: INTERACTIONS_LIST_TARGET, type: "controls.setValue", value: { ...value, items: removeInteraction(value.items, edit.id) } });
    } else if (edit.kind === "camera") {
      const result = changeScene({ defaults, timelineSeconds: duration, values }, edit.sceneId, { camera: null });
      if (result) dispatch({ label: "Turn the camera off", type: "controls.apply", values: result.values });
    }
  };

  const pickScene = (sceneId: string, start: number): void => {
    setTimelineView("scene");
    dispatch({ expanded: true, type: "timeline.setExpanded" });
    const edit = selectScene({ defaults, timelineSeconds: duration, values }, sceneId);
    if (edit) dispatch({ label: "Show scene", type: "controls.apply", values: loopScene(edit).values });
    dispatch({ currentTimeSeconds: start, type: "timeline.setCurrentTime" });
    // Play or pause stays as it was; Play then loops this scene.
  };

  const live = React.useRef({ commitMany, duplicateMany, picks, removeMany, rows, selected });
  live.current = { commitMany, duplicateMany, picks, removeMany, rows, selected };
  React.useEffect(() => {
    if (selected) document.documentElement.dataset.moTimelineSelection = "1";
    else delete document.documentElement.dataset.moTimelineSelection;
    return () => {
      delete document.documentElement.dataset.moTimelineSelection;
    };
  }, [selected]);
  React.useEffect(() => {
    // Select all and Delete only act on the timeline after the last press was on it: a bar stays picked while the user works on
    // the artboard or the Layers panel, and Cmd + A then Delete there must never wipe a scene's motion.
    let onTimeline = false;
    const onPress = (event: PointerEvent): void => {
      onTimeline = Boolean((event.target as HTMLElement | null)?.closest?.("[data-mo-tracks]"));
    };
    window.addEventListener("pointerdown", onPress, true);
    const onKey = (event: KeyboardEvent): void => {
      const current = live.current;
      if (!current.selected || (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true]")) return;
      const every = current.rows.flatMap((row) => row.bars);
      const bar = every.find((item) => item.id === current.selected);
      const chosen = every.filter((item) => current.picks.includes(item.id));
      if (event.key === "Escape") {
        setPicks([]);
        setPickedCard(null);
        setSceneFilter(false);
        setPickedKey(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
        // The browser's own Cmd / Ctrl + D (a bookmark) must not open.
        event.preventDefault();
        current.duplicateMany(chosen);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        if (!onTimeline) return;
        // Every bar that can be retimed (of the rows shown) is picked.
        event.preventDefault();
        setPicks(every.filter((item) => item.edit && !item.resizeOnly).map((item) => item.id));
        return;
      }
      if (!bar) return;
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && bar.edit && !bar.resizeOnly) {
        event.preventDefault();
        current.commitMany(chosen.filter((item) => item.edit && !item.resizeOnly), (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.5 : 0.05), false);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && bar.edit) {
        if (!onTimeline) return;
        event.preventDefault();
        current.removeMany(chosen.filter((item) => item.edit));
        setPicks([]);
        setPickedCard(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, []);

  // With All shown and a scene bar picked, Play loops that scene (the rest of the motion waits).
  const pickedScene = view === "all" ? scenes.items.find((item) => item.scene.id === selected) : undefined;
  const loopStart = pickedScene?.start;
  const loopEnd = pickedScene?.end;
  React.useEffect(() => {
    if (loopStart === undefined || loopEnd === undefined || !isPlaying) return;
    if (time >= loopEnd - 0.001 || time < loopStart - 0.001) dispatch({ currentTimeSeconds: loopStart, type: "timeline.setCurrentTime" });
  }, [dispatch, isPlaying, loopEnd, loopStart, time]);

  // Wheel over the ruler and rows: zoom around the pointer.
  React.useEffect(() => {
    if (!mount) return undefined;
    // On the window, in the capture phase: the app's own browser-zoom guard stops Ctrl / Cmd + wheel before it reaches the panel.
    const onWheel = (event: WheelEvent): void => {
      if (!(event.target instanceof Node) || !mount.contains(event.target)) return;
      const box = trackRef.current?.getBoundingClientRect();
      if (!box) return;
      handleTimelineWheel(event, box);
      if (event.ctrlKey || event.metaKey) event.stopPropagation();
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [mount]);
  // Another scene starts zoomed out.
  const shownId = active?.scene.id;
  React.useEffect(() => {
    resetTimelineZoom();
  }, [shownId]);

  if (!mount) return null;
  // The ruler's step follows the zoom: about 70 px between marks, from 10 s down to a single frame (0.01 s). Under a second the marks
  // are labelled with the frame count (seconds:frame, the frame running 00 - 99 each second, like the playhead's label).
  const STEPS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 10];
  const wanted = (70 * rangeLength) / Math.max(1, width || 800);
  const step = STEPS.find((candidate) => candidate >= wanted) ?? 10;
  // Ticks sit on whole-motion times (a scene from 5 s to 8 s shows 5s, 5.5s … 8s): the ruler is a part of the full time line, not a new one.
  const ticks: number[] = [];
  for (let k = Math.ceil((rangeStart - 1e-6) / step); k * step <= rangeStart + rangeLength + 1e-6; k += 1) ticks.push(Math.round(k * step * 1000) / 1000);
  // Mini lines between the marks (4 or 5 parts of a step; none at a single frame).
  const MINI_PARTS: Readonly<Record<number, number>> = { 0.01: 1, 0.02: 2, 0.05: 5, 0.1: 5, 0.25: 5, 0.5: 5, 1: 4, 2: 4, 4: 4, 10: 5 };
  const parts = MINI_PARTS[step] ?? 4;
  const minis: number[] = [];
  if (parts > 1) for (let k = Math.ceil((rangeStart - 1e-6) / (step / parts)); k * (step / parts) <= rangeStart + rangeLength + 1e-6; k += 1) if (k % parts !== 0) minis.push(Math.round((k * step * 1000) / parts) / 1000);
  const tickText = (at: number): string => {
    if (step >= 1) return `${at}s`;
    const whole = Math.floor(at + 1e-6);
    return `${whole}:${String(Math.min(99, Math.round((at - whole) * 100))).padStart(2, "0")}`;
  };
  const rangeEnd = rangeStart + rangeLength;

  const gripNode = gripMount ? createPortal(<div aria-label="Timeline height" className={styles.grip} data-drag="height" onDoubleClick={resetHeight} onPointerDown={startResize} role="separator" title="Drag to change the height of the timeline; double click for the automatic height" />, gripMount) : null;

  return (
    <>
      {gripNode}
      {createPortal(
    <div className={styles.root} style={{ ["--label" as string]: `${LABEL_WIDTH}px`, ["--gutter" as string]: `${GUTTER}px` }}>
      <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minWidth: 0 }}>
        <div style={{ display: "flex", flex: "0 0 22px" }}>
          <div className={styles.label}>{view === "all" ? "Overview" : `${active?.scene.name ?? ""} · ${round(rangeStart)}s → ${round(rangeStart + rangeLength)}s`}</div>
          <div className={styles.ruler} onPointerDown={scrub} ref={trackRef} style={{ flex: "1 1 0", marginRight: GUTTER }}>
            {minis.map((at) => (
              <div className={styles.mini} key={`m${at}`} style={{ left: toX(at) }} />
            ))}
            {ticks.map((at) => (
              <div className={at <= rangeStart + 1e-6 ? `${styles.tick} ${styles.tickFirst}` : styles.tick} key={at} style={{ left: toX(at) }}>
                <span className={toX(at) + tickText(at).length * 6 + 10 > width ? `${styles.tickLabel} ${styles.tickLabelEnd}` : styles.tickLabel}>{tickText(at)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.rowsWrap}>
        <div
          className={styles.rows}
          onPointerDown={(event) => {
            // The empty area under the rows: nothing stays picked (bar, card, layer).
            if (event.target !== event.currentTarget) return;
            setSelected(null);
            setPickedCard(null);
            setSceneFilter(false);
            setPickedKey(null);
            if (selectedLayerId) dispatch({ layers: layers as never, selectedLayerId: null, type: "layers.reorder" });
          }}
          onScroll={syncThumb}
          ref={rowsRef}
        >
          {rows.map((row) => (
            <div className={styles.row} key={row.id}>
              <div
                className={row.group ? `${styles.label} ${styles.groupLabel}` : row.indent ? `${styles.label} ${styles.indented}` : styles.label}
                onClick={row.group ? () => setOpenGroups((current) => { const next = new Set(current); if (next.has(row.group!.key)) next.delete(row.group!.key); else next.add(row.group!.key); return next; }) : undefined}
                title={row.group ? `${row.label}: click to ${row.group.open ? "fold" : "open"} its layers` : row.label}
              >
                {row.group ? <span aria-hidden="true">{row.group.open ? "▾ " : "▸ "}</span> : null}
                {row.label}
              </div>
              <div
                className={styles.track}
                onPointerLeave={row.id === "scenes-group" ? clearSceneTip : undefined}
                onPointerMove={
                  row.id === "scenes-group"
                    ? (event) => {
                        // Each scene mark (the line where a scene starts) names its scene: the pointer must be on a mark, the nearest
                        // one within a few pixels, and rest there for half a second.
                        const box = event.currentTarget.getBoundingClientRect();
                        const at = event.clientX - box.left;
                        let found: (typeof scenes.items)[number] | undefined;
                        let nearest = 8;
                        for (const item of scenes.items) {
                          const distance = Math.abs(toX(item.start) - at);
                          if (distance <= nearest) {
                            nearest = distance;
                            found = item;
                          }
                        }
                        const id = found?.scene.id ?? null;
                        const current = sceneTipRef.current;
                        if (current.id !== id) {
                          window.clearTimeout(current.timer);
                          current.id = id;
                          if (found) {
                            const name = found.scene.name;
                            const x = box.left + toX(found.start);
                            const y = box.top;
                            // Already showing: the label moves to the next mark at once (it glides); otherwise it waits a moment.
                            if (current.visible) showSceneTip(name, x, y);
                            else current.timer = window.setTimeout(() => showSceneTip(name, x, y), SCENE_TIP_DELAY_MS);
                          } else if (current.visible) {
                            current.timer = window.setTimeout(hideSceneTip, SCENE_TIP_GRACE_MS);
                          }
                        }
                      }
                    : undefined
                }
                onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  setPicks([]);
                  setPickedCard(null);
                  setSceneFilter(false);
                  setPickedKey(null);
                }
                scrub(event);
              }}>
                {row.hint ? <div className={styles.empty} style={{ padding: "4px 6px" }}>{row.hint}</div> : null}
                {row.id === "scenes-group"
                  ? scenes.items.map((item) => <div className={styles.sceneMark} key={item.scene.id} style={{ left: toX(item.start) }} />)
                  : null}
                {row.id === "scenes-group" && sceneTip
                  ? createPortal(
                      // At the page level: the timeline panel is transformed and clips what it holds, which would move and cut a
                      // fixed label drawn inside it.
                      <div className={styles.sceneTip} data-open={sceneTipOpen || undefined} role="tooltip" style={{ left: sceneTip.x, top: sceneTip.y }}>
                        {sceneTip.name}
                      </div>,
                      document.body,
                    )
                  : null}
                {row.id.startsWith("scene-row-") && sceneDrag ? <div className={styles.dropLine} style={{ left: toX(sceneDrag.line) }} /> : null}
                {row.bars.map((bar) => {
                  const moving = drag && (drag.id === bar.id || drag.group?.includes(bar.id)) ? drag : null;
                  // The scenes after a resized scene follow it.
                  const follows = drag && (drag.row === row.id || (drag.row === "scene-row" && row.id.startsWith("scene-row-"))) && drag.from !== undefined && drag.id !== bar.id && bar.start >= drag.from - 1e-6 ? drag.seconds : 0;
                  // The scenes slide while a scene's start is dragged: that scene and the scenes after it.
                  const slide = leadDrag && bar.scene && row.id.startsWith("scene-row-") && (scenes.items.find((each) => each.scene.id === bar.scene)?.index ?? 0) >= (scenes.items.find((each) => each.scene.id === leadDrag.id)?.index ?? Infinity) ? leadDrag.seconds : 0;
                  const start = bar.start + (moving && !moving.resize ? moving.seconds : 0) + follows + slide;
                  const end = bar.end + (moving ? moving.seconds : 0) + follows + slide;
                  if (end <= rangeStart || start >= rangeEnd) return null;
                  const left = toX(Math.max(rangeStart, start));
                  const classes = [styles.bar, bar.edit && !bar.resizeOnly ? styles.editable : "", bar.keys ? styles.keyed : "", picks.includes(bar.id) ? styles.picked : "", sceneDrag?.id === bar.scene && sceneDrag ? styles.lifted : "", bar.scene ? styles.scene : ""].filter(Boolean).join(" ");
                  // A scene name that does not fit in its bar is written beside the bar, joined to it by a short line.
                  const barWidth = Math.max(3, toX(Math.min(rangeEnd, Math.max(start + MIN_SECONDS, end))) - left);
                  const labelWidth = bar.label.length * 6.4 + 14;
                  const outside = bar.scene && barWidth < labelWidth ? (left + barWidth + 10 + labelWidth <= width ? "right" : "left") : null;
                  return (
                    <React.Fragment key={bar.id}>
                    <div
                      className={classes}
                      data-drag={bar.edit && !bar.resizeOnly ? "move" : undefined}
                      onPointerMove={bar.edit?.kind === "video" ? (event) => {
                        const next = event.metaKey || event.ctrlKey ? { id: bar.id, x: event.clientX - event.currentTarget.getBoundingClientRect().left } : null;
                        setCutHover((previous) => (previous === null && next === null ? previous : next));
                      } : undefined}
                      onPointerLeave={bar.edit?.kind === "video" ? () => setCutHover(null) : undefined}
                      onPointerDown={(event) => {
                        // Cmd / Ctrl + click on a video part cuts it where the pointer is.
                        if (bar.edit?.kind === "video" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          event.stopPropagation();
                          const box = event.currentTarget.getBoundingClientRect();
                          splitVideoAt(bar.edit.clip, round(start + ((event.clientX - box.left) / Math.max(1, box.width)) * (end - start)));
                          setCutHover(null);
                          return;
                        }
                        // Shift (or Cmd / Ctrl) + click adds the bar to the picked ones, or takes it out.
                        if ((event.shiftKey || event.metaKey || event.ctrlKey) && bar.edit && !bar.resizeOnly) {
                          event.preventDefault();
                          event.stopPropagation();
                          const next = picks.includes(bar.id) ? picks.filter((id) => id !== bar.id) : [...picks, bar.id];
                          setPicks(next);
                          return;
                        }
                        // A bar that is already picked keeps the others picked (they are dragged together).
                        const picked = picks.includes(bar.id) && picks.length > 1 ? picks : [bar.id];
                        if (picked.length === 1) setPicks([bar.id]);
                        setPickedCard(bar.card ?? null);
                        // A video part: its card in the Layer section is picked too.
                        pickVideoPart(bar.edit?.kind === "video" ? { clip: bar.edit.clip, index: bar.edit.index } : null);
                        chooseLayer(bar.layer, bar.properties);
                        // A scene bar is clicked to open the scene: the playhead scrub below must not take the press.
                        if (bar.scene && (!bar.edit || bar.resizeOnly)) {
                          event.stopPropagation();
                          startSceneMove(event, bar.scene);
                        }
                        if (bar.edit && !bar.resizeOnly) startDrag(event, bar, false, picked);
                      }}
                      // One click picks the scene (Play then loops it, also with All shown); a double click goes into the scene.
                      onClick={bar.scene && (!bar.edit || bar.resizeOnly) ? () => {
                        if (justDragged.current) return;
                        dispatch({ currentTimeSeconds: scenes.items.find((item) => item.scene.id === bar.scene)?.start ?? 0, type: "timeline.setCurrentTime" });
                        // The picked scene is the one the Motion Plan lists.
                        const edit = selectScene({ defaults, timelineSeconds: duration, values }, bar.scene as string);
                        if (edit) dispatch({ label: "Show scene", type: "controls.apply", values: edit.values });
                        setSceneFilter(true);
                      } : undefined}
                      onDoubleClick={bar.scene && (!bar.edit || bar.resizeOnly) ? () => justDragged.current || pickScene(bar.scene as string, scenes.items.find((item) => item.scene.id === bar.scene)?.start ?? 0) : undefined}
                      style={{ left, width: Math.max(3, toX(Math.min(rangeEnd, Math.max(start + MIN_SECONDS, end))) - left) }}
                      // The Scenes bar has no browser tooltip of its own: each mark shows its scene's name instead.
                      title={row.id === "scenes-group" ? undefined : `${bar.label} · ${round(start)}s → ${round(end)}s`}
                    >
                      {outside || row.id === "scenes-group" ? null : bar.label}
                      {cutHover && cutHover.id === bar.id ? (
                        <span aria-hidden className={styles.cut} style={{ left: cutHover.x }}>
                          <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 24 24" width="12">
                            <circle cx="6" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
                          </svg>
                        </span>
                      ) : null}
                      {bar.keys
                        ? (["start", "end"] as const).map((side) => (
                            <span
                              className={[styles.key, side === "start" ? styles.keyStart : styles.keyEnd, pickedKey === `${bar.id}|${side}` ? styles.keyPicked : ""].filter(Boolean).join(" ")}
                              data-drag={bar.edit ? (side === "end" ? "resize" : "move") : undefined}
                              data-key={side}
                              key={side}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                setPickedKey(`${bar.id}|${side}`);
                                // The playhead goes to the keyframe.
                                dispatch({ currentTimeSeconds: side === "start" ? bar.start : bar.end, type: "timeline.setCurrentTime" });
                                const together = picks.includes(bar.id) && picks.length > 1 ? picks : [bar.id];
                                if (together.length === 1) setPicks([bar.id]);
                                setPickedCard(bar.card ?? null);
                                chooseLayer(bar.layer, bar.properties);
                                if (bar.edit && (!bar.resizeOnly || side === "end")) startDrag(event, bar, side === "end", together);
                              }}
                              title={`${side === "start" ? "Start" : "End"} keyframe · ${round(side === "start" ? start : end)}s`}
                            />
                          ))
                        : null}
                      {bar.marks?.map((mark) => (
                        <span
                          className={`${styles.key} ${styles.keyMark}`}
                          key={mark}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            chooseLayer(bar.layer, bar.properties);
                            dispatch({ currentTimeSeconds: mark, type: "timeline.setCurrentTime" });
                          }}
                          style={{ left: `${((mark - bar.start) / Math.max(MIN_SECONDS, bar.end - bar.start)) * 100}%` }}
                          title={`Keyframe · ${round(mark)}s`}
                        />
                      ))}
                      {bar.edit?.kind === "sceneLength" && row.id.startsWith("scene-row-") && (scenes.items.find((each) => each.scene.id === bar.scene)?.index ?? 0) > 0 ? (
                        <span aria-label="Start earlier to overlap the scene before" className={styles.leadHandle} data-drag="resize" onPointerDown={(event) => startLeadDrag(event, bar.scene as string)} title="Drag to start this scene over the end of the scene before" />
                      ) : null}
                      {bar.edit ? <span className={styles.handle} data-drag="resize" onPointerDown={(event) => startDrag(event, bar, true, picks.includes(bar.id) ? picks : [bar.id])} /> : null}
                    </div>
                    {outside ? (
                      <div className={`${styles.outLabel} ${outside === "left" ? styles.outLeft : ""}`} style={outside === "right" ? { left: left + barWidth } : { right: width - left }}>
                        {bar.label}
                      </div>
                    ) : null}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {thumb ? (
          <div className={styles.thumbTrack}>
            <div className={styles.thumb} onPointerDown={dragThumb} style={{ height: thumb.height, top: thumb.top }} />
          </div>
        ) : null}
        </div>
        {zoom.zoom > 1 ? (
          <div className={styles.hscroll} style={{ left: LABEL_WIDTH, right: GUTTER }}>
            <div
              className={styles.hthumb}
              data-drag="move"
              onPointerDown={dragHThumb}
              style={{ left: `${zoom.start * 100}%`, width: `${100 / zoom.zoom}%` }}
            />
          </div>
        ) : null}
        {zoom.start === 0 ? <div className={styles.startLine} style={{ left: LABEL_WIDTH - 1 }} /> : null}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_WIDTH, right: GUTTER, pointerEvents: "none" }}>
          {(() => {
            const at = Math.min(rangeEnd, Math.max(rangeStart, time));
            const x = toX(at);
            // Seconds and a frame counter that runs 0 – 99 and starts again every second ("9:50" = 9 s and frame 50).
            const whole = Math.floor(at + 1e-6);
            const frame = Math.min(99, Math.floor((at - whole) * 100 + 1e-6));
            // The label sits at the top, in the middle of the playhead; at the start it moves to the right of it, at the end to the left.
            const place = x < STAMP_HALF ? styles.stampStart : x > width - STAMP_HALF ? styles.stampEnd : styles.stampMiddle;
            return (
              <div aria-label="Playhead" className={styles.playhead} role="slider" style={{ left: x }}>
                <span className={`${styles.stamp} ${place}`}>
                  {whole}:{String(frame).padStart(2, "0")}
                </span>
                {/* Only the top of the playhead (its label and knob) is grabbed: the line passes presses through, so a bar under it (a video cut, a handle) can still be used. */}
                <span className={styles.playheadGrip} data-drag="playhead" onPointerDown={scrub} title="Drag to move the playhead" />
              </div>
            );
          })()}
        </div>
      </div>
    </div>,
    mount,
      )}
    </>
  );
}
