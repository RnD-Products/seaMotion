import { defineToolcraftCustomControlType } from "@/toolcraft/runtime";
import type { ToolcraftState } from "@/toolcraft/runtime";

import {
  ANIMATION_LIBRARY_TARGET,
  ANIMATION_PARAMS_TARGET,
  ANIMATION_TYPE_TARGET,
  NO_ANIMATION,
  isAnimationSpec,
  readAnimationLibrary,
  type AnimationSpec,
} from "../animation/animation-spec";
import { EMPTY_MO_VERSIONS, MO_VERSIONS_TARGET, isVersionTarget } from "./mo-versions";
import { pruneFigmaDesign } from "./figma-paste-import";
import { pruneDeletedMedia } from "../media/media-layer";
import { isLottieData } from "../lottie/lottie-data";
import { buildProjectFromLottie } from "../lottie/lottie-project";

// What the Modifier and Motion tabs add on top of the animation: edited texts, the background and
// sticky items, and the interactions kit. Each project has its own, and a new project starts empty.
function isModifierTarget(target: string): boolean {
  return target === "animation.texts" || target === "artboard.name" || /^(bg|interactions|landing|lottie|motion|scenes|sound|sticky)\./.test(target);
}

// A project also owns which animation it uses, which saved versions do not.
function isProjectTarget(target: string): boolean {
  return (
    target === ANIMATION_TYPE_TARGET ||
    target === ANIMATION_PARAMS_TARGET ||
    target === "animation.frame" ||
    isModifierTarget(target) ||
    isVersionTarget(target)
  );
}

export const moProjectsControl = defineToolcraftCustomControlType("moProjects");

export const MO_PROJECTS_TARGET = "projects.state";

export const RECENT_PROJECT_LIMIT = 10;

export type ProjectCanvas = Readonly<{
  aspectRatio?: unknown;
  mode: "finite" | "infinite";
  size: Readonly<{ height: number; width: number }>;
}>;

// A project is a named snapshot of the animation settings, its saved versions, its canvas
// size and its design layers. Older projects have no canvas or layers and keep the current ones.
export type MoProject = Readonly<{
  canvas?: ProjectCanvas;
  durationSeconds: number;
  layers?: readonly ProjectFileLayer[];
  id: string;
  name: string;
  openedAt: number;
  updatedAt: number;
  values: Readonly<Record<string, unknown>>;
}>;

export type MoProjectsValue = Readonly<{
  currentId: string | null;
  items: readonly MoProject[];
}>;

export const EMPTY_MO_PROJECTS: MoProjectsValue = Object.freeze({ currentId: null, items: [] });

export function readMoProjects(value: unknown): MoProjectsValue {
  if (typeof value !== "object" || value === null) return EMPTY_MO_PROJECTS;
  const { currentId, items } = value as { currentId?: unknown; items?: unknown };
  if (!Array.isArray(items)) return EMPTY_MO_PROJECTS;
  const projects = items.filter(
    (item): item is MoProject =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as MoProject).id === "string" &&
      typeof (item as MoProject).name === "string" &&
      typeof (item as MoProject).values === "object" &&
      (item as MoProject).values !== null,
  );
  return {
    currentId: typeof currentId === "string" && projects.some((item) => item.id === currentId) ? currentId : null,
    items: projects,
  };
}

// Values a project owns: every animation setting plus its list of saved versions.
export function captureProjectValues(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const captured: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(values)) {
    if (isProjectTarget(target)) captured[target] = value;
  }
  captured[MO_VERSIONS_TARGET] = values[MO_VERSIONS_TARGET] ?? EMPTY_MO_VERSIONS;
  return captured;
}

// Defaults of the Modifier / Motion settings only, so a project saved before they existed opens with
// them empty instead of keeping the previous project's.
export function getModifierDefaults(schema: ToolcraftState["schema"]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const section of schema.panels.controls?.sections ?? []) {
    for (const control of Object.values(section.controls)) {
      const { defaultValue, target } = control as { defaultValue?: unknown; target?: string };
      if (target && defaultValue !== undefined && isModifierTarget(target)) defaults[target] = defaultValue;
    }
  }
  return defaults;
}

// Schema defaults for the same set of targets, used by a brand-new project.
export function getDefaultProjectValues(schema: ToolcraftState["schema"]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const section of schema.panels.controls?.sections ?? []) {
    for (const control of Object.values(section.controls)) {
      const { defaultValue, target } = control as { defaultValue?: unknown; target?: string };
      if (target && defaultValue !== undefined && isProjectTarget(target)) defaults[target] = defaultValue;
    }
  }
  defaults[MO_VERSIONS_TARGET] = EMPTY_MO_VERSIONS;
  return defaults;
}

// A project's ID: unique, never reused, and kept in its saved file so it stays the same project after a rename, an export
// and import, or a reload.
export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createProject(
  name: string,
  values: Record<string, unknown>,
  durationSeconds: number,
  extras: Readonly<{ canvas?: ProjectCanvas; id?: string; layers?: readonly ProjectFileLayer[] }> = {},
): MoProject {
  const now = Date.now();
  const { id, ...rest } = extras;
  return {
    ...rest,
    durationSeconds,
    id: id ?? newProjectId(),
    name,
    openedAt: now,
    updatedAt: now,
    values,
  };
}

export function nextProjectName(projects: MoProjectsValue, prefix: string): string {
  const names = new Set(projects.items.map((item) => item.name));
  let index = projects.items.length + 1;
  while (names.has(`${prefix} ${index}`)) index += 1;
  return `${prefix} ${index}`;
}

// A name the app gave a new project ("Untitled 3"), not one the user chose.
export function isDefaultProjectName(name: string): boolean {
  return /^Untitled( \d+)?$/i.test(name.trim());
}

// The Recent list: newest project first, in the order they were made. Opening one does not move it, so the list stays
// where you left it; only a new project arrives at the top.
export function getListedProjects(projects: MoProjectsValue): MoProject[] {
  return [...projects.items].reverse();
}

// The most recently opened first (used to pick what opens next, not for the list).
export function getRecentProjects(projects: MoProjectsValue): MoProject[] {
  return [...projects.items].sort((a, b) => b.openedAt - a.openedAt).slice(0, RECENT_PROJECT_LIMIT);
}

export const MO_APP_PROJECT_FORMAT = "mo-app-project";

export type ProjectFileLayer = Readonly<{
  collapsed?: boolean;
  displayName?: string;
  id: string;
  kind?: "group" | "layer";
  name: string;
  parentGroupId?: string;
  visible: boolean;
}>;

// Everything one exported project holds: the animation itself (controls, layers, drawing script
// and its images and fonts), every control value (which includes the saved animation versions),
// the design layers, and the canvas and timeline settings.
export type ProjectFile = Readonly<{
  // The animation embedded in the file; null for a blank project.
  animation: AnimationSpec | null;
  // The project's ID as saved in the file; null for a file made before projects had IDs.
  id: string | null;
  params: Record<string, unknown> | null;
  canvas: Readonly<{ mode: "finite" | "infinite"; size: Readonly<{ height: number; width: number }> }> | null;
  durationSeconds: number | null;
  layers: readonly ProjectFileLayer[] | null;
  name: string;
  values: Record<string, unknown>;
}>;

// Runtime-owned values that must not be written through controls.apply.
const NON_PORTABLE_TARGETS = new Set([MO_PROJECTS_TARGET, ANIMATION_LIBRARY_TARGET, "render.status"]);
export const CANVAS_SIZING_TARGETS = new Set(["canvas.aspectRatio", "canvas.size.width", "canvas.size.height"]);

export function createProjectFile(
  state: Readonly<{
    canvas: ProjectFile["canvas"];
    durationSeconds: number;
    layers: readonly ProjectFileLayer[];
    name: string;
    projectId?: string;
    values: Readonly<Record<string, unknown>>;
  }>,
): unknown {
  const type = state.values[ANIMATION_TYPE_TARGET];
  const stored = typeof type === "string" && type !== NO_ANIMATION ? (readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]).items[type] ?? null) : null;
  // Deleted layers leave no data in the file: a pasted design's shapes, texts and pictures, and video or GIF layers'
  // clips (a pasted picture shown from its own file also keeps no duplicate).
  const animation = stored ? pruneDeletedMedia(pruneFigmaDesign(stored, state.layers), state.layers) : null;
  const values: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(state.values)) {
    if (!NON_PORTABLE_TARGETS.has(target)) values[target] = value;
  }
  // Frame settings are switched off: nothing of them is written to the file, saved versions included.
  delete values["animation.frame"];
  const versions = values[MO_VERSIONS_TARGET];
  if (typeof versions === "object" && versions !== null && Array.isArray((versions as { items?: unknown }).items)) {
    values[MO_VERSIONS_TARGET] = {
      ...(versions as Record<string, unknown>),
      items: (versions as { items: Record<string, unknown>[] }).items.map((item) => {
        const saved = item.values;
        if (typeof saved !== "object" || saved === null || !("animation.frame" in saved)) return item;
        const { "animation.frame": _frame, ...rest } = saved as Record<string, unknown>;
        return { ...item, values: rest };
      }),
    };
  }
  const rawParams = values[ANIMATION_PARAMS_TARGET];
  const params =
    typeof rawParams === "object" && rawParams !== null && !Array.isArray(rawParams)
      ? Object.fromEntries(Object.entries(rawParams as Record<string, unknown>).filter(([key]) => key !== "__frame"))
      : rawParams;
  delete values[ANIMATION_PARAMS_TARGET];
  delete values[ANIMATION_TYPE_TARGET];
  return {
    animation,
    canvas: state.canvas,
    exportedAt: new Date().toISOString(),
    format: MO_APP_PROJECT_FORMAT,
    layers: state.layers.map(toProjectLayer),
    name: state.name,
    params: params ?? {},
    projectId: state.projectId ?? null,
    timeline: { durationSeconds: state.durationSeconds },
    values,
    version: 2,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCanvas(value: unknown): ProjectFile["canvas"] {
  if (!isRecord(value) || !isRecord(value.size)) return null;
  const { height, width } = value.size;
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) return null;
  return { mode: value.mode === "infinite" ? "infinite" : "finite", size: { height, width } };
}

function readLayers(value: unknown): ProjectFile["layers"] {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (layer): layer is ProjectFileLayer =>
      isRecord(layer) && typeof layer.id === "string" && typeof layer.name === "string" && typeof layer.visible === "boolean",
  );
}

// Reads a project file made by Export project, or an older settings export (which has no layers).
export function parseProjectFile(text: string, fileName: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  // A Lottie (Bodymovin) file opens as a new Lottie Animation project.
  if (isLottieData(data)) return buildProjectFromLottie(data, fileName);
  if (!isRecord(data) || !isRecord(data.values)) throw new Error("That file has no project settings.");
  const fromFile = fileName.replace(/\.json$/i, "").replace(/\.motion$/i, "").trim();
  const embedded = readMoProjects(data.values[MO_PROJECTS_TARGET]);
  const embeddedName = embedded.items.find((item) => item.id === embedded.currentId)?.name;
  const named = typeof data.name === "string" ? data.name.trim() : "";
  const timeline = isRecord(data.timeline) ? data.timeline.durationSeconds : undefined;
  const duration = typeof data.durationSeconds === "number" ? data.durationSeconds : timeline;
  const values: Record<string, unknown> = {};
  for (const [target, value] of Object.entries(data.values)) {
    if (!NON_PORTABLE_TARGETS.has(target)) values[target] = value;
  }
  // The animation travels inside the file; a file without one is a project with no animation.
  const animation = isAnimationSpec(data.animation) ? data.animation : null;
  return finishParse();

  function finishParse(): ProjectFile {
    const source = data as Record<string, unknown>;
    delete values[ANIMATION_TYPE_TARGET];
    return {
      animation,
      canvas: readCanvas(source.canvas),
      durationSeconds: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
      id: typeof source.projectId === "string" && source.projectId.trim() !== "" ? source.projectId.trim().slice(0, 64) : null,
      layers: readLayers(source.layers),
      name: named || embeddedName || fromFile || "Imported project",
      params: isRecord(source.params) ? { ...source.params } : null,
      values,
    };
  }
}

export function uniqueProjectName(projects: MoProjectsValue, name: string): string {
  const names = new Set(projects.items.map((item) => item.name));
  if (!names.has(name)) return name;
  let index = 2;
  while (names.has(`${name} ${index}`)) index += 1;
  return `${name} ${index}`;
}

// Layers are compared and stored in this exact shape.
// Project data is stored as runtime values, which must be plain JSON, so unset fields are left out.
export function toProjectLayer(layer: ProjectFileLayer): ProjectFileLayer {
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

// A blank project opens at 4:3 (1600 x 1200) with every design layer hidden.
export const BLANK_PROJECT_CANVAS: ProjectCanvas = Object.freeze({
  aspectRatio: { height: 3, mode: "preset", value: "4:3", width: 4 },
  mode: "finite",
  size: { height: 1200, width: 1600 },
});

export function getBlankProjectLayers(): ProjectFileLayer[] {
  return [];
}
