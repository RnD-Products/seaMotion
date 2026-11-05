import { blurMembers, frameIds } from "../mo/figma-paste-import";
import { cameraGroupArea } from "./camera-group";
import { PERSPECTIVES_PARAM, layerEffects } from "./layer-perspective";
import { ANIMATION_PARAMS_TARGET, resolveParams, type AnimationSpec } from "./animation-spec";
import { mergeOverlapPlans } from "./scene-overlap";
import { readCamera, type SceneCamera } from "./camera";
import { isPointerShownAt, readInteractions } from "./interactions";
import { readInteractionPlan } from "./interaction-plan";

// Scenes (Motion tab > Scenes Segment). A project's motion is a list of scenes played one after another. Every scene has its
// own motion settings (the animation's controls and Interaction plan), Reactor items and sound settings; the design, its
// layers and the project's pictures, texts and frame are shared.
//
// The scene on show is edited in the ordinary controls, so its settings live in the project's normal values. The other
// scenes keep theirs in `slice`; switching scenes saves the one on show into its `slice` and puts the chosen scene's
// settings into the values.
export const SCENES_TARGET = "scenes.items";

export type SceneStart = "design" | "previous";

export type Scene = Readonly<{
  // The camera of the scene (a zoom with an angle that moves while it plays); none looks straight at the whole picture.
  camera?: SceneCamera | null;
  // Seconds. With one scene the project's timeline length is used instead.
  duration: number;
  id: string;
  // True when the scene runs the design's own motion script; a new scene has none until its plan is built.
  motion: boolean;
  name: string;
  // Which part of the design's motion script the scene plays (the script's own name for it, for example "03"); the script
  // is told as params.__stage. Empty: the script plays all of its motion in one go.
  role?: string;
  // Seconds the scene starts before the scene ahead of it ends (they overlap and play together); 0 plays one after the other.
  lead?: number;
  // The saved settings of the scene (stale for the scene on show: its live values are the truth).
  slice: Readonly<Record<string, unknown>>;
  // "design": starts from the design as pasted. "previous": starts from where the scene before it ended.
  start: SceneStart;
}>;

// `preview`: the preview plays only the scene on show (segment wise preview); renders always play every scene.
export type ScenesValue = Readonly<{ activeId: string | null; items: readonly Scene[]; preview: boolean }>;

export const EMPTY_SCENES: ScenesValue = Object.freeze({ activeId: null, items: Object.freeze([]), preview: false });

export const DEFAULT_SCENE_ID = "scene-1";
// The name of the scene a project has before any scene is added.
export const DEFAULT_SCENE_NAME = "Scene";
export const NEW_SCENE_SECONDS = 3;
const MIN_SECONDS = 0.1;
const MAX_SECONDS = 3600;
const MAX_NAME_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sceneName(number: number): string {
  return `Scene_${String(number).padStart(2, "0")}`;
}

export function nextSceneName(scenes: readonly Pick<Scene, "name">[]): string {
  const highest = Math.max(0, ...scenes.map((scene) => Number(/^Scene_(\d+)$/.exec(scene.name)?.[1] ?? 0)));
  return sceneName(Math.max(highest, scenes.length) + 1);
}

export function newSceneId(): string {
  return `scene-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clampSceneSeconds(value: number): number {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value * 100) / 100));
}

export function readScenes(value: unknown): ScenesValue {
  if (!isRecord(value) || !Array.isArray(value.items)) return EMPTY_SCENES;
  const items: Scene[] = [];
  for (const raw of value.items) {
    if (!isRecord(raw) || typeof raw.id !== "string" || items.some((scene) => scene.id === raw.id)) continue;
    items.push({
      duration: typeof raw.duration === "number" && Number.isFinite(raw.duration) ? clampSceneSeconds(raw.duration) : NEW_SCENE_SECONDS,
      id: raw.id,
      motion: raw.motion !== false,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.slice(0, MAX_NAME_LENGTH) : sceneName(items.length + 1),
      ...(typeof raw.role === "string" && raw.role ? { role: raw.role.slice(0, 20) } : {}),
      ...(typeof raw.lead === "number" && Number.isFinite(raw.lead) && raw.lead > 0 ? { lead: clampSceneSeconds(raw.lead) } : {}),
      ...(readCamera(raw.camera) ? { camera: readCamera(raw.camera) } : {}),
      slice: isRecord(raw.slice) ? raw.slice : {},
      start: raw.start === "previous" ? "previous" : "design",
    });
  }
  // A project's only scene saved under the old default name is called "Scene" now.
  const only = items.length === 1 ? items[0] : undefined;
  if (only && only.name === "Scene_01") items[0] = { ...only, name: DEFAULT_SCENE_NAME };
  const activeId = typeof value.activeId === "string" && items.some((scene) => scene.id === value.activeId) ? value.activeId : (items[0]?.id ?? null);
  return { activeId, items, preview: value.preview === true };
}

// Settings a scene owns: the Reactor, the sound and the animation's own controls and plan. Keys of the animation's
// parameters that start with "__" are the design's (text and picture edits, frame, layer styles) and are shared.
export function isSceneTarget(target: string): boolean {
  if (target === "sound.part" || target === "sound.preview") return false;
  return target === ANIMATION_PARAMS_TARGET || target.startsWith("interactions.") || target.startsWith("sound.");
}

function motionParams(params: unknown): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  if (isRecord(params)) for (const [key, value] of Object.entries(params)) if (!key.startsWith("__")) own[key] = value;
  return own;
}

function sharedParams(params: unknown): Record<string, unknown> {
  const shared: Record<string, unknown> = {};
  if (isRecord(params)) for (const [key, value] of Object.entries(params)) if (key.startsWith("__")) shared[key] = value;
  return shared;
}

// The scene settings in the current values.
export function captureSceneSlice(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(values)) {
    if (!isSceneTarget(target)) continue;
    slice[target] = target === ANIMATION_PARAMS_TARGET ? motionParams(value) : value;
  }
  return slice;
}

// The values with a scene's settings in place of the scene settings they hold; a setting the scene never saved is its default.
export function applySceneSlice(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  slice: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...values };
  const targets = new Set([...Object.keys(values), ...Object.keys(defaults)].filter(isSceneTarget));
  for (const target of targets) {
    if (target === ANIMATION_PARAMS_TARGET) {
      next[target] = { ...sharedParams(values[target]), ...motionParams(slice[target]) };
      continue;
    }
    next[target] = Object.hasOwn(slice, target) ? slice[target] : defaults[target];
  }
  return next;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item,
  );
}

// Only what differs from the values: what a scene switch has to change.
export function sceneSliceChanges(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  slice: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const applied = applySceneSlice(values, defaults, slice);
  const changes: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(applied)) {
    if (isSceneTarget(target) && stable(value) !== stable(values[target])) changes[target] = value;
  }
  return changes;
}

export type ResolvedScene = Readonly<{
  active: boolean;
  duration: number;
  end: number;
  index: number;
  // Seconds this scene overlaps the one before it (0: it starts where that one ends).
  lead: number;
  scene: Scene;
  start: number;
}>;

export type ResolvedScenes = Readonly<{ activeIndex: number; items: readonly ResolvedScene[]; many: boolean; preview: boolean; total: number }>;

// The scenes with their times on the timeline. A project with no saved scenes has one: Scene, as long as the timeline.
export function resolveScenes(value: unknown, timelineSeconds: number): ResolvedScenes {
  const scenes = readScenes(value);
  const base: readonly Scene[] =
    scenes.items.length > 0
      ? scenes.items
      : [{ duration: timelineSeconds, id: DEFAULT_SCENE_ID, motion: true, name: DEFAULT_SCENE_NAME, slice: {}, start: "design" }];
  const many = base.length > 1;
  const activeId = scenes.items.length > 0 ? scenes.activeId : DEFAULT_SCENE_ID;
  const items: ResolvedScene[] = [];
  base.forEach((scene, index) => {
    const duration = many ? scene.duration : Math.max(0, timelineSeconds);
    const before = items[index - 1];
    // A scene overlaps the one before it by at most the shorter of the two.
    const lead = before && many ? Math.max(0, Math.min(scene.lead ?? 0, before.duration - MIN_SECONDS, duration - MIN_SECONDS)) : 0;
    const start = before ? before.end - lead : 0;
    items.push({ active: scene.id === activeId, duration, end: start + duration, index, lead, scene, start });
  });
  const at = Math.max(0, ...items.map((item) => item.end));
  const found = items.findIndex((item) => item.active);
  return { activeIndex: found < 0 ? 0 : found, items, many, preview: scenes.preview && many, total: at };
}

// The scenes of the open project, for every motion type (a project without scenes is one scene).
export function resolveProjectScenes(values: Readonly<Record<string, unknown>>, timelineSeconds: number): ResolvedScenes {
  return resolveScenes(values[SCENES_TARGET], timelineSeconds);
}

// The values each scene is drawn with, in scene order (one list per change of the values, not per picture).
export function sceneValuesList(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  scenes: ResolvedScenes,
): readonly Readonly<Record<string, unknown>>[] {
  return scenes.items.map((item) => valuesOfScene(values, defaults, item));
}

// The scene on show at a time: of the scenes that play then, the one that started last (the later scene of two that overlap).
export function sceneAt(scenes: ResolvedScenes, timeSeconds: number): ResolvedScene {
  const last = scenes.items[scenes.items.length - 1];
  if (!last) throw new Error("A project always has a scene.");
  for (let index = scenes.items.length - 1; index >= 0; index -= 1) {
    const item = scenes.items[index];
    if (item && timeSeconds >= item.start && timeSeconds < item.end) return item;
  }
  return last;
}

// The other scenes that play at a time (the earlier scene of two that overlap).
export function scenesOverlapping(scenes: ResolvedScenes, timeSeconds: number): readonly ResolvedScene[] {
  const on = sceneAt(scenes, timeSeconds);
  return scenes.many ? scenes.items.filter((item) => item !== on && timeSeconds >= item.start && timeSeconds < item.end) : [];
}

// The time the playhead snaps to: the start or end of a scene when `seconds` is within `reach` of it, else `seconds` itself.
export function snapToScenes(scenes: ResolvedScenes, seconds: number, reach: number): number {
  let best = seconds;
  let nearest = reach;
  for (const item of scenes.items) {
    for (const edge of [item.start, item.end]) {
      const gap = Math.abs(edge - seconds);
      if (gap <= nearest) {
        nearest = gap;
        best = edge;
      }
    }
  }
  return best;
}

// Where the scene on show starts on the timeline (0 with one scene).
export function activeSceneOffset(scenes: ResolvedScenes): number {
  return scenes.items[scenes.activeIndex]?.start ?? 0;
}

// The values a scene is drawn with: the live values for the scene on show, its saved settings for another.
export function valuesOfScene(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  scene: ResolvedScene,
): Readonly<Record<string, unknown>> {
  return scene.active ? values : applySceneSlice(values, defaults, scene.scene.slice);
}

// Everything one picture of the timeline needs from the scenes: which scene it is in, the scene's own time, and the
// scene's values. With one scene this is the plain values and time.
export type SceneFrame = Readonly<{
  // The scene before ended with a pointer (cursor, tap, drag) on screen, so this scene's pointer carries on instead of fading in.
  carriesOn: boolean;
  duration: number;
  // The scene after this one starts with a pointer on screen, so a pointer reaching this scene's end never fades out.
  leadsOn: boolean;
  index: number;
  localSeconds: number;
  // The scenes that play at the same time as this one (it started later): their values and their own clock.
  overlapping: readonly Readonly<{ localSeconds: number; scene: ResolvedScene; values: Readonly<Record<string, unknown>> }>[];
  scene: ResolvedScene;
  values: Readonly<Record<string, unknown>>;
  // Set when the scene starts from where the scene before it ended: that scene's values and length, and whether it ran the design's motion.
  previous: Readonly<{ motion: boolean; role?: string; seconds: number; values: Readonly<Record<string, unknown>> }> | null;
}>;

export function sceneFrame(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  scenes: ResolvedScenes,
  timeSeconds: number,
  // The values of each scene when already worked out (sceneValuesList).
  valuesOfEach?: readonly Readonly<Record<string, unknown>>[],
): SceneFrame {
  const scene = sceneAt(scenes, timeSeconds);
  const valuesIn = (item: ResolvedScene): Readonly<Record<string, unknown>> => valuesOfEach?.[item.index] ?? valuesOfScene(values, defaults, item);
  const before = scene.index > 0 ? scenes.items[scene.index - 1] : undefined;
  const previous =
    scenes.many && scene.scene.start === "previous" && before ? { motion: before.scene.motion, ...(before.scene.role ? { role: before.scene.role } : {}), seconds: before.duration, values: valuesIn(before) } : null;
  const beforeItems = before && scenes.many ? readInteractions(valuesIn(before)) : [];
  const after = scenes.many ? scenes.items[scene.index + 1] : undefined;
  const afterItems = after ? readInteractions(valuesIn(after)) : [];
  return {
    carriesOn: before !== undefined && scenes.many && isPointerShownAt(beforeItems, before.duration),
    duration: scene.duration,
    index: scene.index,
    leadsOn: after !== undefined && isPointerShownAt(afterItems, 0.001),
    localSeconds: scenes.many ? Math.min(scene.duration, Math.max(0, timeSeconds - scene.start)) : timeSeconds,
    overlapping: scenesOverlapping(scenes, timeSeconds).map((item) => ({ localSeconds: Math.max(0, timeSeconds - item.start), scene: item, values: valuesIn(item) })),
    previous,
    scene,
    values: valuesIn(scene),
  };
}

type LayerLike = Readonly<{ id: string; kind?: string; name?: string; parentGroupId?: string }>;

// For every layer a plan animation names (by the name shown in the Layers panel, or its id): the drawn layers it holds (the layer
// itself, or what a group holds).
export function planLayerGroups(layers: readonly LayerLike[], plan: unknown, frames: ReadonlySet<string> = new Set()): Record<string, string[]> {
  const animations = isRecord(plan) && Array.isArray(plan.animations) ? plan.animations : [];
  const named = new Set<string>();
  for (const animation of animations) if (isRecord(animation) && typeof animation.layer === "string" && animation.layer) named.add(animation.layer);
  const groups: Record<string, string[]> = {};
  for (const name of named) {
    const found = new Set<string>();
    const walk = (parent: string): void => {
      for (const layer of layers) {
        if (layer.parentGroupId !== parent) continue;
        if (layer.kind === "group") {
          if (frames.has(layer.id)) found.add(layer.id);
          walk(layer.id);
        } else found.add(layer.id);
      }
    };
    const matches = layers.filter((layer) => layer.id === name || layer.name === name);
    for (const layer of matches) {
      if (layer.kind === "group") {
        if (frames.has(layer.id)) found.add(layer.id);
        walk(layer.id);
      } else found.add(layer.id);
    }
    groups[name] = [...found];
  }
  return groups;
}

function planOf(values: Readonly<Record<string, unknown>>): unknown {
  const params = values[ANIMATION_PARAMS_TARGET];
  return isRecord(params) ? params.plan : undefined;
}

// The drawing parameters of a picture: the scene's own, with its Interaction plan, told whether the scene runs the design's
// motion and where the scene before it ended.
export function sceneParams(spec: AnimationSpec, frame: SceneFrame, layers: readonly LayerLike[] = []): Record<string, unknown> {
  const params = resolveParams(spec, frame.values[ANIMATION_PARAMS_TARGET]);
  let plan = planOf(frame.values);
  // Scenes that play at the same time: their effects join this scene's (the later scene has the last word on a layer).
  if (frame.overlapping.length > 0) {
    plan = mergeOverlapPlans(plan, frame.scene.start, frame.overlapping.map((item) => ({ end: item.scene.end, params: item.values[ANIMATION_PARAMS_TARGET], start: item.scene.start })));
  }
  if (plan !== undefined) {
    params.plan = plan;
    params.__planLayers = planLayerGroups(layers, plan, frameIds(spec));
  }
  // Layers with a perspective (corners moved) are drawn warped and groups that clip are cut to a rounded box; the drawing script gets what each one holds.
  let perspectives = layerEffects(layers, params, spec);
  // A scene with a camera on the design's Camera group: the camera's window gives the corners their radius, so the clipping group
  // that supplies it is not rounded in the picture too (the camera would zoom that rounded corner and the four corners would differ).
  const camera = frame.scene.scene.camera;
  if (camera && spec.design) {
    const design = spec.design as { height?: number; width?: number };
    const size = spec.size ?? (typeof design.width === "number" && typeof design.height === "number" ? { height: design.height, width: design.width } : null);
    const area = size ? cameraGroupArea(spec, layers, params, size) : null;
    if (area && area.radius > 0 && area.radiusGroup) {
      perspectives = perspectives.map((effect) => (effect.group === area.radiusGroup && effect.clip ? { ...effect, clip: { ...effect.clip, radius: [0, 0, 0, 0] } } : effect));
    }
  }
  if (perspectives.length > 0) params[PERSPECTIVES_PARAM] = perspectives;
  // A layer blur on a group covers what the group holds.
  const blurred = blurMembers(spec, layers);
  if (Object.keys(blurred).length > 0) params.__blurMembers = blurred;
  if (!frame.scene.scene.motion) params.__noMotion = true;
  if (frame.scene.scene.role) params.__stage = frame.scene.scene.role;
  if (frame.previous) {
    const before = planOf(frame.previous.values);
    params.__base = {
      motion: frame.previous.motion,
      params: { ...resolveParams(spec, frame.previous.values[ANIMATION_PARAMS_TARGET]), ...(frame.previous.role ? { __stage: frame.previous.role } : {}) },
      plan: before,
      planLayers: planLayerGroups(layers, before, frameIds(spec)),
      time: frame.previous.seconds,
    };
  }
  return params;
}

// ---- Editing the list of scenes ----

// What an edit changes: the values to apply (the scene settings of the scene that becomes the one on show and the list
// itself) and the timeline length to set, when it changes.
export type SceneEdit = Readonly<{ durationSeconds: number | null; values: Record<string, unknown> }>;

type Context = Readonly<{ defaults: Readonly<Record<string, unknown>>; timelineSeconds: number; values: Readonly<Record<string, unknown>> }>;

// The saved scenes with the scene on show brought up to date from the live values. A project with none has Scene.
function currentScenes(context: Context): ScenesValue {
  const saved = readScenes(context.values[SCENES_TARGET]);
  const items: readonly Scene[] =
    saved.items.length > 0
      ? saved.items
      : [{ duration: clampSceneSeconds(context.timelineSeconds), id: DEFAULT_SCENE_ID, motion: true, name: DEFAULT_SCENE_NAME, slice: {}, start: "design" }];
  const activeId = saved.items.length > 0 ? saved.activeId : DEFAULT_SCENE_ID;
  const live = captureSceneSlice(context.values);
  return { activeId, items: items.map((scene) => (scene.id === activeId ? { ...scene, slice: live } : scene)), preview: saved.preview };
}

function lengthOf(items: readonly Scene[], timelineSeconds: number): number {
  if (items.length === 1) return items[0]?.duration ?? timelineSeconds;
  // The scenes follow one another, each starting `lead` seconds before the one ahead of it ends.
  let end = 0;
  let longest = 0;
  items.forEach((scene, index) => {
    const before = items[index - 1];
    const lead = before ? Math.max(0, Math.min(scene.lead ?? 0, before.duration - MIN_SECONDS, scene.duration - MIN_SECONDS)) : 0;
    end = (before ? end - lead : 0) + scene.duration;
    longest = Math.max(longest, end);
  });
  return longest;
}

function finish(context: Context, scenes: ScenesValue): SceneEdit {
  const target = scenes.items.find((scene) => scene.id === scenes.activeId) ?? scenes.items[0];
  const changes = target ? sceneSliceChanges(context.values, context.defaults, target.slice) : {};
  const durationSeconds = lengthOf(scenes.items, context.timelineSeconds);
  return { durationSeconds, values: { ...changes, [SCENES_TARGET]: { activeId: scenes.activeId, items: scenes.items, preview: scenes.preview } } };
}

export function selectScene(context: Context, id: string): SceneEdit | null {
  const scenes = currentScenes(context);
  if (!scenes.items.some((scene) => scene.id === id)) return null;
  return finish(context, { ...scenes, activeId: id });
}

// A new scene after `after` (the last one when null): empty, or a copy of another scene's settings. It becomes the scene on show.
export function addScene(context: Context, copyOf: string | null): SceneEdit {
  const scenes = currentScenes(context);
  const source = copyOf ? scenes.items.find((scene) => scene.id === copyOf) : undefined;
  const made: Scene = {
    duration: source ? source.duration : NEW_SCENE_SECONDS,
    id: newSceneId(),
    motion: source ? source.motion : false,
    name: nextSceneName(scenes.items),
    ...(source?.role ? { role: source.role } : {}),
    ...(source?.camera ? { camera: source.camera } : {}),
    slice: source ? source.slice : {},
    start: source ? source.start : "design",
  };
  const at = source ? scenes.items.indexOf(source) + 1 : scenes.items.length;
  const items = [...scenes.items.slice(0, at), made, ...scenes.items.slice(at)];
  return finish(context, { activeId: made.id, items, preview: scenes.preview });
}

export function removeScene(context: Context, id: string): SceneEdit | null {
  const scenes = currentScenes(context);
  if (scenes.items.length < 2) return null;
  const index = scenes.items.findIndex((scene) => scene.id === id);
  if (index < 0) return null;
  const items = scenes.items.filter((scene) => scene.id !== id);
  const activeId = scenes.activeId === id ? (items[Math.min(index, items.length - 1)]?.id ?? null) : scenes.activeId;
  // The first scene never starts from a scene before it.
  const first = items[0];
  const fixed = first && first.start === "previous" ? [{ ...first, start: "design" as const }, ...items.slice(1)] : items;
  return finish(context, { activeId, items: fixed, preview: scenes.preview });
}

export function moveScene(context: Context, id: string, by: number): SceneEdit | null {
  const scenes = currentScenes(context);
  const index = scenes.items.findIndex((scene) => scene.id === id);
  const to = index + by;
  if (index < 0 || to < 0 || to >= scenes.items.length) return null;
  const items = [...scenes.items];
  const [item] = items.splice(index, 1);
  if (item) items.splice(to, 0, item);
  const first = items[0];
  const fixed = first && first.start === "previous" ? [{ ...first, start: "design" as const }, ...items.slice(1)] : items;
  return finish(context, { ...scenes, items: fixed });
}

export function changeScene(context: Context, id: string, change: Partial<Pick<Scene, "duration" | "lead" | "name" | "start">> & { camera?: SceneCamera | null }): SceneEdit | null {
  const scenes = currentScenes(context);
  const index = scenes.items.findIndex((scene) => scene.id === id);
  if (index < 0) return null;
  let items = scenes.items.map((scene) =>
    scene.id === id
      ? {
          ...scene,
          ...(change.duration === undefined ? {} : { duration: clampSceneSeconds(change.duration) }),
          ...(change.lead === undefined ? {} : change.lead > 0 ? { lead: clampSceneSeconds(change.lead) } : { lead: undefined }),
          ...(change.name === undefined ? {} : { name: change.name.trim().slice(0, MAX_NAME_LENGTH) || scene.name }),
          ...(change.start === undefined ? {} : { start: change.start }),
          ...(change.camera === undefined ? {} : { camera: change.camera }),
        }
      : scene,
  );
  // Scenes join up: when a camera's end pose changes, the next scene's camera that started from it starts from the new one (and the
  // other way round), so the picture never jumps at a scene change.
  const before = scenes.items[index]?.camera;
  const after = change.camera;
  if (before && after) {
    const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
    const next = items[index + 1];
    if (next?.camera && same(next.camera.from, before.to) && !same(before.to, after.to)) {
      items = items.map((scene, at) => (at === index + 1 && scene.camera ? { ...scene, camera: { ...scene.camera, from: after.to } } : scene));
    }
    const previous = items[index - 1];
    if (previous?.camera && same(previous.camera.to, before.from) && !same(before.from, after.from)) {
      items = items.map((scene, at) => (at === index - 1 && scene.camera ? { ...scene, camera: { ...scene.camera, to: after.from } } : scene));
    }
  }
  return finish(context, { ...scenes, items });
}

// Turns the segment wise preview on or off (the saved scenes are kept as they are).
// Choosing a scene plays that scene on a loop (segment wise preview on): the edit with the preview turned on.
export function loopScene(edit: SceneEdit): SceneEdit {
  const saved = edit.values[SCENES_TARGET] as { activeId: string; items: unknown; preview?: boolean } | undefined;
  return saved ? { ...edit, values: { ...edit.values, [SCENES_TARGET]: { ...saved, preview: true } } } : edit;
}

export function setScenePreview(context: Context, preview: boolean): SceneEdit {
  const scenes = currentScenes(context);
  return { durationSeconds: null, values: { [SCENES_TARGET]: { activeId: scenes.activeId, items: scenes.items, preview } } };
}

// The four segments of a motion: Start, Logo animation, Motion In and End, with their lengths in seconds (10 s together). The project's own
// motion is the Motion In segment; the others start empty.
export const SEGMENTS: readonly Readonly<{ id: string; name: string; seconds: number }>[] = [
  { id: "scene-start", name: "Start", seconds: 1 },
  { id: "scene-logo", name: "Logo animation", seconds: 2 },
  { id: DEFAULT_SCENE_ID, name: "Motion In", seconds: 6 },
  { id: "scene-end", name: "End", seconds: 1 },
];
export const SEGMENTS_SECONDS = SEGMENTS.reduce((sum, segment) => sum + segment.seconds, 0);

// An empty canvas given the Animation_v2 type starts with the four segments (10 s together).
export function defaultSceneSet(): ScenesValue {
  const items = SEGMENTS.map((segment): Scene => ({ duration: segment.seconds, id: segment.id, motion: false, name: segment.name, slice: {}, start: "design" }));
  return { activeId: DEFAULT_SCENE_ID, items, preview: false };
}

// The scene presets the Split scene button offers. The project's own motion (what the single scene holds) goes to Motion In, which becomes
// the scene on show; the other scenes begin empty.
export type ScenePreset = Readonly<{ description: string; id: string; label: string; scenes: readonly Readonly<{ id: string; name: string; seconds: number }>[] }>;
const SEGMENT = (name: string): Readonly<{ id: string; name: string; seconds: number }> => SEGMENTS.find((segment) => segment.name === name) as Readonly<{ id: string; name: string; seconds: number }>;
export const SCENE_PRESETS: readonly ScenePreset[] = [
  { description: "A logo splash, then the motion, then the end", id: "logo", label: "Logo intro", scenes: [SEGMENT("Start"), SEGMENT("Logo animation"), SEGMENT("Motion In"), SEGMENT("End")] },
  { description: "The motion with a start and an end, no logo", id: "simple", label: "Start and end", scenes: [SEGMENT("Start"), SEGMENT("Motion In"), SEGMENT("End")] },
  { description: "The motion and its end", id: "short", label: "Motion and end", scenes: [SEGMENT("Motion In"), SEGMENT("End")] },
  { description: "Only the motion, in one scene called Motion In", id: "motion", label: "Motion in", scenes: [SEGMENT("Motion In")] },
];
export const presetSeconds = (preset: ScenePreset): number => preset.scenes.reduce((sum, scene) => sum + scene.seconds, 0);

// Splits the project's only scene (Scene) into the scenes of a preset. Null when the project already has several scenes.
export function splitIntoPreset(context: Context, presetId: string): SceneEdit | null {
  const scenes = currentScenes(context);
  const only = scenes.items.length === 1 ? scenes.items[0] : undefined;
  const preset = SCENE_PRESETS.find((item) => item.id === presetId);
  if (!only || !preset) return null;
  const items = preset.scenes.map((segment): Scene => {
    if (segment.name !== "Motion In") return { duration: segment.seconds, id: segment.id, motion: false, name: segment.name, slice: {}, start: "design" };
    return { ...only, duration: segment.seconds, name: segment.name, start: "design" };
  });
  const motionIn = items.find((scene) => scene.name === "Motion In");
  return finish(context, { activeId: motionIn?.id ?? only.id, items, preview: false });
}

// The first preset: Start, Logo animation, Motion In and End.
export function splitIntoSegments(context: Context): SceneEdit | null {
  return splitIntoPreset(context, "logo");
}

// Whether any scene has motion: layer effects in its plan, Reactor items or a camera. A project whose scenes have none can be reset to one scene.
export function scenesHaveMotion(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  scenes: ResolvedScenes,
): boolean {
  return scenes.items.some((item) => {
    if (item.scene.camera) return true;
    const own = valuesOfScene(values, defaults, item);
    if (readInteractionPlan({ plan: planOf(own) }).animations.length > 0) return true;
    return readInteractions({ ...own, "interactions.enabled": true }).length > 0;
  });
}

// Puts the scenes back to one scene (Scene) as long as the whole motion, keeping the settings of the scene on show. Null when the project has
// one scene already.
export function resetScenes(context: Context): SceneEdit | null {
  const scenes = currentScenes(context);
  if (scenes.items.length < 2) return null;
  const shown = scenes.items.find((scene) => scene.id === scenes.activeId) ?? scenes.items[0];
  if (!shown) return null;
  const total = lengthOf(scenes.items, context.timelineSeconds);
  const only: Scene = { duration: clampSceneSeconds(total), id: DEFAULT_SCENE_ID, motion: shown.motion, name: DEFAULT_SCENE_NAME, slice: shown.slice, start: "design" };
  return finish(context, { activeId: only.id, items: [only], preview: false });
}
