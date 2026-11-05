import { defineToolcraftCustomControlType } from "@/toolcraft/runtime";
import type { ToolcraftState } from "@/toolcraft/runtime";

import { ANIMATION_LIBRARY_TARGET, ANIMATION_PARAMS_TARGET, getActiveAnimation, readAnimationLibrary, type ControlSpec, type LayerSpec } from "../animation/animation-spec";
import { applySceneSlice, captureSceneSlice, isSceneTarget, readScenes, SCENES_TARGET } from "../animation/scenes";

export const moVersionsControl = defineToolcraftCustomControlType("moVersions");

export const MO_VERSIONS_TARGET = "versions.items";

// A design layer as the Layers panel lists it (the shape the project file stores).
export type MoVersionLayer = Readonly<{
  collapsed?: boolean;
  displayName?: string;
  id: string;
  kind?: "group" | "layer";
  name: string;
  parentGroupId?: string;
  visible: boolean;
}>;

// The animation itself at the time of the version: its drawing script, its controls and its layers (pictures and fonts
// are not copied: they stay the project's). Loading the version puts them back, so a version made by changing the
// motion (not only its settings) looks as it did.
export type MoVersionScript = Readonly<{
  code: string;
  controls: readonly ControlSpec[];
  layers: readonly LayerSpec[];
  panelLayers?: readonly MoVersionLayer[];
}>;

export type MoVersion = Readonly<{
  durationSeconds: number;
  id: string;
  name: string;
  script?: MoVersionScript;
  values: Readonly<Record<string, unknown>>;
}>;

// activeId is the version last saved or loaded; null when none is selected.
export type MoVersionsValue = Readonly<{ activeId: string | null; items: readonly MoVersion[] }>;

export const EMPTY_MO_VERSIONS: MoVersionsValue = Object.freeze({ activeId: null, items: [] });

// A version stores the animation settings (every control value of the animation), the render
// options and the background. Canvas size, zoom, panels and
// the version list itself stay out of it.
// Reactor and sound settings are part of the motion too. ("Sound" only picks which sound is being edited and
// "Play in preview" only mutes the preview, so they stay out.)
const VERSION_PREFIXES = ["render.", "interactions.", "sound."] as const;
// "animation.frame" (frame settings) is no longer kept: those settings are switched off.
const VERSION_TARGETS = new Set(["animation.params", "appearance.background", "bg.fillAngle", "bg.fillTo", "bg.fillType", "export.includeBackground"]);
const EXCLUDED_TARGETS = new Set(["render.status", "sound.part", "sound.preview"]);

export function isVersionTarget(target: string): boolean {
  if (EXCLUDED_TARGETS.has(target)) return false;
  return VERSION_TARGETS.has(target) || VERSION_PREFIXES.some((prefix) => target.startsWith(prefix));
}

export function readMoVersions(value: unknown): MoVersionsValue {
  if (typeof value !== "object" || value === null) return EMPTY_MO_VERSIONS;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return EMPTY_MO_VERSIONS;
  const versions = items.filter(
    (item): item is MoVersion =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as MoVersion).id === "string" &&
      typeof (item as MoVersion).name === "string" &&
      typeof (item as MoVersion).values === "object" &&
      (item as MoVersion).values !== null,
  );
  const activeId = (value as { activeId?: unknown }).activeId;
  return {
    activeId: typeof activeId === "string" && versions.some((item) => item.id === activeId) ? activeId : null,
    items: versions,
  };
}

// A project with scenes keeps every scene's own motion, Reactor and sound inside the version, so a version is the same
// whichever scene is on show (switching scenes never counts as a change). The settings of the scene on show are then not
// stored on their own: they are the scene's, in the list.
export function captureMoVersionValues(state: ToolcraftState): Record<string, unknown> {
  const saved = readScenes(state.values[SCENES_TARGET]);
  const withScenes = saved.items.length > 0;
  const values: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(state.values)) {
    if (!isVersionTarget(target)) continue;
    if (withScenes && isSceneTarget(target)) {
      // The design's own edits (text, pictures, frame) stay with the project's parameters; the rest is the scene's.
      if (target === ANIMATION_PARAMS_TARGET) values[target] = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key.startsWith("__")));
      continue;
    }
    values[target] = value;
  }
  if (withScenes) {
    const live = captureSceneSlice(state.values);
    values[SCENES_TARGET] = { activeId: saved.activeId, items: saved.items.map((scene) => (scene.id === saved.activeId ? { ...scene, slice: live } : scene)) };
  }
  return values;
}

// The stored settings, without which scene was on show.
function comparable(values: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const scenes = values[SCENES_TARGET];
  if (typeof scenes !== "object" || scenes === null) return values;
  return { ...values, [SCENES_TARGET]: (scenes as { items?: unknown }).items };
}

function cleanLayer(layer: MoVersionLayer): MoVersionLayer {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    ...(layer.collapsed === undefined ? {} : { collapsed: layer.collapsed }),
    ...(layer.displayName === undefined ? {} : { displayName: layer.displayName }),
    ...(layer.kind === undefined ? {} : { kind: layer.kind }),
    ...(layer.parentGroupId === undefined ? {} : { parentGroupId: layer.parentGroupId }),
  };
}

// The open animation's script, controls and layers, plus the Layers panel list.
export function captureMoVersionScript(values: Readonly<Record<string, unknown>>, layers: readonly MoVersionLayer[]): MoVersionScript | undefined {
  const spec = getActiveAnimation(values);
  if (!spec) return undefined;
  return { code: spec.code, controls: spec.controls, layers: spec.layers, panelLayers: layers.map(cleanLayer) };
}

function newMoVersionId(): string {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createMoVersion(state: ToolcraftState, name: string): MoVersion {
  const script = captureMoVersionScript(state.values, state.layers);
  return {
    durationSeconds: state.timeline.durationSeconds,
    id: newMoVersionId(),
    name,
    ...(script ? { script } : {}),
    values: captureMoVersionValues(state),
  };
}

// An exact copy of a saved version under a new name (its settings and script as saved, not the current edits).
export function copyMoVersion(version: MoVersion, name: string): MoVersion {
  return { ...version, id: newMoVersionId(), name };
}

// What loading a version applies: its settings and, when it carries a different script, the animation with that script,
// controls and layers (its version number raised so the drawing reloads).
export function versionLoadValues(
  values: Readonly<Record<string, unknown>>,
  version: MoVersion,
  defaults: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...version.values };
  delete next["animation.frame"];
  // A version with scenes brings them all back; the scene on show gets its settings in the ordinary controls.
  const saved = readScenes(version.values[SCENES_TARGET]);
  const shown = saved.items.find((scene) => scene.id === saved.activeId);
  if (shown) {
    const applied = applySceneSlice({ ...values, ...next }, defaults, shown.slice);
    for (const target of Object.keys(applied)) if (isSceneTarget(target)) next[target] = applied[target];
  }
  const spec = getActiveAnimation(values);
  const script = version.script;
  if (spec && script && (spec.code !== script.code || JSON.stringify(spec.controls) !== JSON.stringify(script.controls) || JSON.stringify(spec.layers) !== JSON.stringify(script.layers))) {
    const library = readAnimationLibrary(values[ANIMATION_LIBRARY_TARGET]);
    const highest = Math.max(spec.version, ...Object.values(library.items).filter((item) => item.id === spec.id).map((item) => item.version));
    next[ANIMATION_LIBRARY_TARGET] = {
      items: { ...library.items, [spec.id]: { ...spec, code: script.code, controls: script.controls, layers: script.layers, version: highest + 1 } },
    };
  }
  return next;
}

// The Layers panel commands that turn `current` into the version's list (none when they already match).
export function versionLayerCommands(
  current: readonly MoVersionLayer[],
  version: MoVersion,
): ({ layerId: string; type: "layers.delete" } | { insertIndex: number; layer: MoVersionLayer; type: "layers.add" })[] {
  const wanted = version.script?.panelLayers;
  if (!wanted || wanted.length === 0) return [];
  if (JSON.stringify(current.map(cleanLayer)) === JSON.stringify(wanted.map(cleanLayer))) return [];
  return [
    ...current.map((layer) => ({ layerId: layer.id, type: "layers.delete" as const })),
    ...wanted.map((layer, index) => ({ insertIndex: index, layer: cleanLayer(layer), type: "layers.add" as const })),
  ];
}

export function nextMoVersionName(versions: MoVersionsValue): string {
  const highest = Math.max(0, ...versions.items.map((item) => Number(/^v_(\d+)$/.exec(item.name)?.[1] ?? 0)));
  return `v_${String(highest + 1).padStart(2, "0")}`;
}

// True when the current settings no longer match what the version stored.
// Changes whenever anything a version keeps changes (used to restart the wait before a change is saved).
export function moVersionFingerprint(state: ToolcraftState): string {
  const spec = getActiveAnimation(state.values);
  return `${spec?.id ?? ""}:${spec?.version ?? ""}:${state.timeline.durationSeconds}:${JSON.stringify(comparable(captureMoVersionValues(state)))}`;
}

export function isMoVersionModified(state: ToolcraftState, version: MoVersion): boolean {
  const spec = getActiveAnimation(state.values);
  if (version.script && spec && spec.code !== version.script.code) return true;
  const current = comparable(captureMoVersionValues(state));
  const stored = comparable(version.values);
  // Older versions predate newer controls; loading leaves those untouched, so skip them.
  for (const key of Object.keys(stored)) {
    // Older versions still hold frame settings; they are not kept any more, so they never count as a change.
    if (key === "animation.frame") continue;
    if (JSON.stringify(current[key]) !== JSON.stringify(stored[key])) return true;
  }
  return state.timeline.durationSeconds !== version.durationSeconds;
}
