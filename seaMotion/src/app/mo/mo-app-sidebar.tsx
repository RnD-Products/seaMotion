import { ArrowClockwise, Broom, CaretLeft, Check, ClockCounterClockwise, Copy, FolderOpen, FolderSimple, GearSix, House, Sparkle, Stack, Trash } from "@phosphor-icons/react";
import * as React from "react";
import {
  LayersPanel,
  useToolcraftDispatch,
  useToolcraftSelector,
} from "@/toolcraft/runtime/react";
import {
  Button,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter as AlertDialogActions,
  AlertDialogHeader,
  AlertDialogTitle,
  FieldDescription,
  FieldError,
  Input,
  Panel,
  PanelIconButton,
  PanelSection,
  PanelSurface,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/toolcraft/ui";

import {
  ANIMATION_LIBRARY_TARGET,
  ANIMATION_PARAMS_TARGET,
  ANIMATION_TYPE_TARGET,
  getActiveAnimation,
  getLayerCommands,
  HIDDEN_LAYER_IDS,
  isAnimationSpec,
  readAnimationLibrary,
  resolveParams,
  type AnimationSpec,
} from "../animation/animation-spec";
import { buildProjectFromFigmaPaste, clearDesignCaches, readFigmaDesign } from "./figma-paste-import";
import { measureLayerBox, planDesignPaste, type ReplaceTarget } from "./mo-paste-design";
import { MoPasteMenu } from "./mo-paste-menu";
import { OPEN_PROJECT_EVENT } from "./mo-motion-picker";
import { canPickMoProjectFile, downloadMoProjectFile, pickMoFile, pickMoProjectFile } from "./mo-project-folder";
import { buildProjectFromMedia, MEDIA_FILE_ACCEPT, mediaKindOf, readMediaFile, withMediaLayer } from "../media/media-layer";
import { chooseProjectAutosaveDir, deleteSavedProject, finishAgentUpdate, listSavedProjects, pingProjectAutosave, readAgentChannel, readAgentUpdate, setProjectAutosaveDir, readSavedProject, saveProjectToAutosave, shortenPath, type GithubAutosaveInfo, type SavedProjectFile } from "./mo-project-autosave";
import { MoAgentOverlay, type AgentView } from "./mo-agent-overlay";
import {
  EMPTY_MO_PROJECTS,
  BLANK_PROJECT_CANVAS,
  CANVAS_SIZING_TARGETS,
  MO_PROJECTS_TARGET,
  captureProjectValues,
  createProject,
  createProjectFile,
  getBlankProjectLayers,
  getDefaultProjectValues,
  getModifierDefaults,
  getListedProjects,
  newProjectId,
  getRecentProjects,
  nextProjectName,
  parseProjectFile,
  readMoProjects,
  toProjectLayer,
  isDefaultProjectName,
  uniqueProjectName,
  type ProjectCanvas,
  type ProjectFile,
  type ProjectFileLayer,
  type MoProject,
  type MoProjectsValue,
} from "./mo-projects";
import { captureMoVersionScript, isVersionTarget, MO_VERSIONS_TARGET, nextMoVersionName, readMoVersions, type MoVersionScript, type MoVersionsValue } from "./mo-versions";
import { useInspectorLabels, useSectionDoubleClickExpand } from "./mo-inspector-labels";
import { RatioBar } from "../animation/ratio-bar";
import { TOOL_PERSPECTIVE_TARGET } from "../animation/layer-perspective";
import { useArtboardSelected } from "./mo-artboard-selection";
import { withDesignArea } from "./figma-paste-import";
import { useSettingsTweaks } from "./mo-settings-tweaks";
import { MoRailTools } from "./mo-rail-tools";
import { MoEffectsPanel } from "./mo-effects-panel";
import { MoAssetLists } from "./mo-assets-lists";
import { MoProjectBar } from "./mo-project-bar";
import { MotionTimeline } from "../animation/motion-timeline";
import { SceneLengthInput } from "../animation/scene-length-input";
import { ScenesStrip } from "../animation/scenes-strip";
import { useInstantUi } from "./mo-instant-ui";
import { useLayerIcons } from "./mo-layer-icons";
import { useHasCopiedLayer, useLayerActions, useLayerDuplicate } from "./mo-layer-duplicate";
import { useVideoSplitKey } from "./mo-video-split-key";
import { useLayerLock } from "./mo-layer-lock";
import { useNoContextMenu } from "./mo-no-context-menu";
import { useLayersScroll } from "./mo-layers-scroll";
import { MoToolbarTweaks } from "./mo-toolbar";
import { useLayerTextsFlag } from "../animation/layer-texts";
import { useActiveLayerId, useArtboardNameSync, useBackgroundModeSync, useLayerActiveFlag, useLayerDeselect, useLayerFilesFlag, useTimelineDefault } from "./mo-layer-selection";
import styles from "./mo-app-sidebar.module.css";

const PROJECTS_DEFAULT_WIDTH = 248;
// How long a new project's timeline is.
const NEW_PROJECT_SECONDS = 8;
const PROJECTS_MIN_WIDTH = 200;
const PROJECTS_MAX_WIDTH = 480;
const VIEW_STORAGE_KEY = "mo-app:view";
const ENTERED_STORAGE_KEY = "mo-app:entered";

function readEntered(): boolean {
  try {
    return window.sessionStorage.getItem(ENTERED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readSavedView(): "home" | "project" {
  try {
    return window.sessionStorage.getItem(VIEW_STORAGE_KEY) === "project" ? "project" : "home";
  } catch {
    return "home";
  }
}
// The yellow dot that says "this project has caches to clear": on the broom, and after "Projects" while Layers is open.
const GREEN_DOT_CORNER: React.CSSProperties = { background: "#facc15", borderRadius: "50%", height: 7, pointerEvents: "none", position: "absolute", right: -3, top: -3, width: 7 };
const GREEN_DOT_INLINE: React.CSSProperties = { background: "#facc15", borderRadius: "50%", display: "inline-block", height: 5, marginLeft: -3, verticalAlign: "middle", width: 5 };

const MAX_NAME_LENGTH = 40;
const MO_VERSIONS_KEY = "versions.items";
// The runtime's own Layers panel is hidden; this copy is always shown inside the sidebar.
const SIDEBAR_LAYERS_STATE = { hidden: false, offset: { x: 0, y: 0 } } as const;
const AUTOSAVE_DELAY_MS = 700;
const AUTOSAVE_INTERVAL_MS = 10_000;


// Project switcher: name, where it is saved, the last five projects, and a New project button.
// The agent channel's pace and what an update may never overwrite (the project list, the version list it extends, the
// animation library it replaces through its own field).
const AGENT_POLL_MS = 800;
const AGENT_STATUS_MAX_AGE_MS = 10 * 60 * 1000;
const AGENT_PROTECTED_TARGETS = new Set([MO_PROJECTS_TARGET, MO_VERSIONS_TARGET, ANIMATION_LIBRARY_TARGET, ANIMATION_TYPE_TARGET]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// v_01, v_02...: the next number after the highest such name.
export function MoAppSidebar(): React.JSX.Element {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const previewQuality = values["preview.quality"];
  const renderScale = values["canvas.renderScale"];
  const previousPreview = React.useRef<{ quality: unknown; scale: unknown } | null>(null);
  React.useEffect(() => {
    const previous = previousPreview.current;
    previousPreview.current = { quality: previewQuality, scale: renderScale };
    const selected = Number(previewQuality);
    if (!Number.isFinite(selected) || typeof renderScale !== "number" || selected === renderScale) return;
    if (!previous || (previous.quality !== previewQuality && previous.scale === renderScale)) {
      dispatch({ history: "skip", label: "Preview quality", target: "canvas.renderScale", type: "controls.setValue", value: selected });
    } else {
      dispatch({ history: "skip", label: "Preview quality", target: "preview.quality", type: "controls.setValue", value: String(renderScale) });
    }
  }, [dispatch, previewQuality, renderScale]);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const schema = useToolcraftSelector((state) => state.schema);
  const layers = useToolcraftSelector((state) => state.layers);
  const selectedLayerId = useToolcraftSelector((state) => state.selectedLayerId);
  useLayerDeselect(selectedLayerId);
  // The Card layer is gone from the Layers panel: the frame's own fill, stroke and corner radius replace it.
  const hiddenLayerPresent = layers.some((layer) => HIDDEN_LAYER_IDS.includes(layer.id));
  React.useEffect(() => {
    if (!hiddenLayerPresent) return;
    for (const id of HIDDEN_LAYER_IDS) dispatch({ layerId: id, type: "layers.delete" });
  }, [dispatch, hiddenLayerPresent]);
  const activeLayerId = useActiveLayerId(selectedLayerId);
  useLayerFilesFlag(activeLayerId);
  useLayerActiveFlag(activeLayerId);
  useBackgroundModeSync();
  useTimelineDefault();
  useInstantUi();
  useLayersScroll();
  useLayerIcons(values, layers, activeLayerId);
  useSettingsTweaks();
  useArtboardNameSync();
  const layerActions = useLayerActions();
  const hasCopiedLayer = useHasCopiedLayer();
  useLayerDuplicate(activeLayerId, layerActions.duplicate);
  useVideoSplitKey(activeLayerId);
  useLayerLock();
  useNoContextMenu();
  useSectionDoubleClickExpand();
  useLayerTextsFlag(activeLayerId);
  const canvasMode = useToolcraftSelector((state) => state.canvas.mode);
  const canvasSize = useToolcraftSelector((state) => state.canvas.size);
  const projects = React.useMemo(() => readMoProjects(values[MO_PROJECTS_TARGET]), [values]);
  const current = projects.items.find((item) => item.id === projects.currentId) ?? null;
  // The inspector follows the selection: nothing selected shows Project, the artboard shows Artboard, a layer shows Modifier and Motion.
  const artboardClicked = useArtboardSelected();
  // The artboard and the main layer (the first top-level group) are one thing: either one selected shows the Artboard view.
  const mainLayerId = layers.find((layer) => layer.kind === "group" && !layer.parentGroupId)?.id ?? null;
  const artboardSelected = artboardClicked || (activeLayerId !== null && activeLayerId === mainLayerId);
  const layerSelected = activeLayerId !== null && activeLayerId !== mainLayerId;
  const inspectorTab = values["inspector.tab"];
  // With the main layer selected the artboard also has its layer's properties: Artboard (what the plugin's artboard mark sets) and Modifier.
  const mainSelected = mainLayerId !== null && activeLayerId === mainLayerId;
  const inspectorSegments = artboardSelected ? (mainSelected ? ["Artboard", "Modifier"] : ["Artboard"]) : layerSelected ? ["Modifier", "Motion"] : ["Project"];
  useInspectorLabels(
    inspectorTab === "modifier" || inspectorTab === "motion" || inspectorTab === "artboard" ? inspectorTab : "project",
    values["render.format"] === "lottie",
    inspectorSegments,
  );
  const inspectorTabRef = React.useRef(inspectorTab);
  inspectorTabRef.current = inspectorTab;
  React.useEffect(() => {
    const now = inspectorTabRef.current;
    const wanted = artboardSelected ? (mainSelected && now === "modifier" ? "modifier" : "artboard") : layerSelected ? (now === "modifier" || now === "motion" ? now : "modifier") : "project";
    if (now !== wanted) dispatch({ label: "Inspector", target: "inspector.tab", type: "controls.setValue", value: wanted });
  }, [artboardSelected, layerSelected, mainSelected, dispatch]);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"effects" | "layers" | "projects" | "recent">("projects");
  // An artboard with a design opens on the Layers tab, also after a reload; an empty one opens on Projects (Import). Only a
  // change of project or of having a design decides it, so choosing a tab by hand stays.
  // "Has a design": the artboard has layers. An empty artboard stays on Projects, where Import is.
  const hasDesign = layers.length > 0;
  const openId = current?.id ?? null;
  React.useEffect(() => {
    setTab(hasDesign ? "layers" : "projects");
  }, [hasDesign, openId]);
  // Picking a bar in the timeline shows its layer: the Layers tab opens.
  React.useEffect(() => {
    const show = (): void => setTab("layers");
    window.addEventListener("mo-show-layers", show);
    return () => window.removeEventListener("mo-show-layers", show);
  }, []);
  // Drag the right edge of the Projects panel to resize it, like the Layers panel.
  const [projectsWidth, setProjectsWidth] = React.useState(PROJECTS_DEFAULT_WIDTH);
  const projectsResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null);
  const clampProjectsWidth = (width: number): number =>
    Math.max(PROJECTS_MIN_WIDTH, Math.min(Math.min(PROJECTS_MAX_WIDTH, window.innerWidth - 32), width));
  const startProjectsResize: React.PointerEventHandler<HTMLDivElement> = (event) => {
    projectsResizeStart.current = { pointerX: event.clientX, width: projectsWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    // Keep the resize cursor and block text selection for the whole drag, even off the handle.
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };
  const resizeProjects: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const start = projectsResizeStart.current;
    if (start) setProjectsWidth(clampProjectsWidth(start.width + event.clientX - start.pointerX));
  };
  const stopProjectsResize = (): void => {
    projectsResizeStart.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const resizeProjectsByKey: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 32 : 8);
    setProjectsWidth((width) => clampProjectsWidth(width + delta));
  };
  const [folderError, setFolderError] = React.useState<string | null>(null);
  // The save-folder menu: the path being typed, shown under the "Saved to" path.
  // The Paste design box: what the Figma plugin copied, turned into a new project when Import is pressed.
  const [pasteText, setPasteText] = React.useState("");
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  const [pasting, setPasting] = React.useState(false);
  const pasteDesignRef = React.useRef<((text: string, replace?: ReplaceTarget) => Promise<void>) | null>(null);
  // Clear caches: shown once a design has been imported in this project and there is something to clear.
  const [cacheNote, setCacheNote] = React.useState<string | null>(null);
  const activeSpec = getActiveAnimation(values);
  const cacheSweep = React.useMemo(() => (activeSpec && readFigmaDesign(activeSpec) ? clearDesignCaches(activeSpec) : null), [activeSpec]);
  const formatBytes = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const hasCaches = Boolean(cacheSweep && cacheSweep.count > 0);
  const clearCaches = (): void => {
    if (!cacheSweep || !activeSpec) return;
    const state = latest.current;
    const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
    dispatch({
      label: "Clear caches",
      type: "controls.apply",
      values: { [ANIMATION_LIBRARY_TARGET]: { items: { ...library.items, [cacheSweep.spec.id]: cacheSweep.spec } } },
    });
    for (const layerId of cacheSweep.layerIds) {
      if (state.layers.some((layer) => layer.id === layerId)) dispatch({ layerId, type: "layers.delete" });
    }
    setCacheNote(`Cleared ${formatBytes(cacheSweep.bytes)} of cached pictures.`);
  };
  // The broom: the drawing's sandbox starts again (its decoded pictures and surfaces are let go) and the design's cached pictures
  // are cleared when there are any, so a long session with big designs gets its memory back.
  const refreshRuntime = (): void => {
    window.dispatchEvent(new Event("mo-refresh-runtime"));
    if (cacheSweep && cacheSweep.count > 0) clearCaches();
    else setCacheNote("Memory refreshed.");
  };
  // Add video or GIF: a picked MP4, WebM or GIF becomes a layer on top of the open project's design.
  const [mediaError, setMediaError] = React.useState<string | null>(null);
  // The Import section shows one of its two ways at a time.
  const [importTab, setImportTab] = React.useState<"media" | "paste">("paste");
  const [addingMedia, setAddingMedia] = React.useState(false);
  const addMediaLayer = (): void => {
    setMediaError(null);
    pickMoFile(MEDIA_FILE_ACCEPT)
      .then(async (file) => {
        setAddingMedia(true);
        const info = await readMediaFile(file);
        const state = latest.current;
        const { layer, spec } = withMediaLayer(getActiveAnimation(state.values), info, state.canvasSize);
        const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
        dispatch({
          label: "Add video layer",
          type: "controls.apply",
          values: { [ANIMATION_LIBRARY_TARGET]: { items: { ...library.items, [spec.id]: spec } }, [ANIMATION_TYPE_TARGET]: spec.id },
        });
        // Into the artboard: with a main layer (the artboard's frame) the video becomes its first layer, so a canvas keeps one artboard.
        const main = state.layers.find((item) => item.kind === "group" && !item.parentGroupId);
        dispatch({
          insertIndex: main ? state.layers.findIndex((item) => item.id === main.id) + 1 : 0,
          layer: { id: layer.id, kind: "layer", name: layer.name, visible: true, ...(main ? { parentGroupId: main.id } : {}) },
          type: "layers.add",
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMediaError(error instanceof Error ? error.message : "Could not add that file.");
      })
      .finally(() => setAddingMedia(false));
  };
  const [folderMenu, setFolderMenu] = React.useState<{ path: string } | null>(null);
  const [autosave, setAutosave] = React.useState<{ dir: string | null; dirMissing: boolean; github: GithubAutosaveInfo | null; savedAt: number | null; state: "checking" | "off" | "on" }>({
    dir: null,
    dirMissing: false,
    github: null,
    savedAt: null,
    state: "checking",
  });

  // The playhead while paused (Paste to replace measures the layer where it is shown); not followed during playback,
  // so the sidebar does not redraw every frame.
  const timeSeconds = useToolcraftSelector((state) => (state.timeline.isPlaying ? 0 : state.timeline.currentTimeSeconds));
  const latest = React.useRef({ canvasMode, canvasSize, durationSeconds, layers, projects, schema, timeSeconds, values });
  latest.current = { canvasMode, canvasSize, durationSeconds, layers, projects, schema, timeSeconds, values };

  // The drawing area follows the artboard: a design keeps its size and position when the artboard is resized (what does not fit is cropped),
  // unless "Scale design with artboard" is on. Only designs pasted from Figma are adjusted.
  const scaleWithArtboard = values["bg.scaleContent"] === true;
  const drawingSpec = getActiveAnimation(values);
  React.useEffect(() => {
    if (scaleWithArtboard || !drawingSpec?.size || !readFigmaDesign(drawingSpec)) return;
    if (drawingSpec.size.width === canvasSize.width && drawingSpec.size.height === canvasSize.height) return;
    const library = readAnimationLibrary(latest.current.values[ANIMATION_LIBRARY_TARGET]);
    const next = withDesignArea(drawingSpec, { height: canvasSize.height, width: canvasSize.width });
    dispatch({
      label: "Artboard size",
      type: "controls.apply",
      values: { [ANIMATION_LIBRARY_TARGET]: { items: { ...library.items, [next.id]: next } }, [ANIMATION_TYPE_TARGET]: next.id },
    });
  }, [canvasSize.height, canvasSize.width, dispatch, drawingSpec, scaleWithArtboard]);

  // The canvas size and design layers a project owns, as they are right now.
  const captureExtras = (): { canvas: ProjectCanvas; layers: ProjectFileLayer[] } => {
    const state = latest.current;
    return {
      canvas: {
        ...(state.values["canvas.aspectRatio"] === undefined ? {} : { aspectRatio: state.values["canvas.aspectRatio"] }),
        mode: state.canvasMode,
        size: { height: state.canvasSize.height, width: state.canvasSize.width },
      },
      layers: state.layers.map(toProjectLayer),
    };
  };

  const setProjects = React.useCallback(
    (next: MoProjectsValue, label: string): void => {
      dispatch({ history: "skip", label, target: MO_PROJECTS_TARGET, type: "controls.setValue", value: next });
    },
    [dispatch],
  );

  // The browser tab always shows the app name.
  React.useEffect(() => {
    document.title = "seaMotion";
  }, []);

  // The runtime places its own Layers panel top-left; the sidebar shows Layers as a tab instead.
  React.useEffect(() => {
    dispatch({ hidden: true, panelId: "layers", type: "panels.setHidden" });
  }, [dispatch]);

  // A drawing no project uses any more (a deleted project's animation) is dropped from the saved state, so it never
  // comes back or fills the browser's storage.
  React.useEffect(() => {
    const library = readAnimationLibrary(values[ANIMATION_LIBRARY_TARGET]);
    const inUse = new Set<string>();
    for (const item of projects.items) {
      const type = item.values[ANIMATION_TYPE_TARGET];
      if (typeof type === "string") inUse.add(type);
    }
    const openType = values[ANIMATION_TYPE_TARGET];
    if (typeof openType === "string") inUse.add(openType);
    const unused = Object.keys(library.items).filter((id) => !inUse.has(id));
    if (unused.length === 0) return;
    dispatch({
      history: "skip",
      label: "Drop unused animations",
      target: ANIMATION_LIBRARY_TARGET,
      type: "controls.setValue",
      value: { items: Object.fromEntries(Object.entries(library.items).filter(([id]) => inUse.has(id))) },
    });
  }, [dispatch, projects, values]);

  // Every AUTOSAVE_INTERVAL_MS the open project is also written to the fixed auto-save folder,
  // in the same format as Export project, so it can be brought back with Import project.
  const lastWritten = React.useRef(new Map<string, string>());
  const flushAutosave = React.useCallback(async (): Promise<void> => {
    const state = latest.current;
    const open = state.projects.items.find((item) => item.id === state.projects.currentId);
    if (!open) return;
    const data = createProjectFile({
      canvas: { mode: state.canvasMode, size: state.canvasSize },
      durationSeconds: state.durationSeconds,
      layers: state.layers,
      name: open.name,
      projectId: open.id,
      values: state.values,
    });
    const key = JSON.stringify(data, (field, value: unknown) => (field === "exportedAt" ? undefined : value));
    if (lastWritten.current.get(open.name) === key) return;
    try {
      const info = await pingProjectAutosave();
      await saveProjectToAutosave(open.name, data);
      lastWritten.current.set(open.name, key);
      setAutosave({ dir: info.dir, dirMissing: false, github: info.github, savedAt: Date.now(), state: "on" });
    } catch {
      setAutosave((previous) => ({ ...previous, state: "off" }));
    }
  }, []);
  // A missing save folder opens the folder menu (with Choose…) once, so the fix is one click away.
  React.useEffect(() => {
    if (autosave.dirMissing) setFolderMenu((open) => open ?? { path: autosave.dir ?? "" });
  }, [autosave.dirMissing, autosave.dir]);
  const flushRef = React.useRef(flushAutosave);
  flushRef.current = flushAutosave;
  React.useEffect(() => {
    pingProjectAutosave().then(
      (info) => setAutosave((previous) => ({ ...previous, dir: info.dir, dirMissing: info.dirMissing, github: info.github, state: "on" })),
      () => setAutosave((previous) => ({ ...previous, state: "off" })),
    );
    const timer = window.setInterval(() => void flushRef.current(), AUTOSAVE_INTERVAL_MS);
    // A failed check (the helper still starting, or restarted) is not final: keep asking, so the
    // "off" notice clears by itself once the helper answers, and appears if it stops later.
    const recheck = window.setInterval(() => {
      pingProjectAutosave().then(
        (info) => setAutosave((previous) => ({ ...previous, dir: info.dir, dirMissing: info.dirMissing, github: info.github, state: "on" })),
        () => setAutosave((previous) => (previous.state === "off" ? previous : { ...previous, state: "off" })),
      );
    }, 4000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(recheck);
    };
  }, []);

  // Every change is saved into the current project shortly after it happens.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const { durationSeconds: duration, projects: latestProjects, values: latestValues } = latest.current;
      const active = latestProjects.items.find((item) => item.id === latestProjects.currentId);
      if (!active) return;
      const snapshot = captureProjectValues(latestValues);
      const extras = captureExtras();
      if (
        active.durationSeconds === duration &&
        JSON.stringify(active.values) === JSON.stringify(snapshot) &&
        JSON.stringify(active.canvas) === JSON.stringify(extras.canvas) &&
        JSON.stringify(active.layers) === JSON.stringify(extras.layers)
      ) {
        return;
      }
      const updated: MoProject = { ...active, ...extras, durationSeconds: duration, updatedAt: Date.now(), values: snapshot };
      setProjects(
        { ...latestProjects, items: latestProjects.items.map((item) => (item.id === updated.id ? updated : item)) },
        "Save project",
      );
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [canvasMode, canvasSize, durationSeconds, layers, setProjects, values]);

  // Puts a project's own canvas size and design layers on screen (older projects have none).
  const applyCanvasAndLayers = (target: MoProject): void => {
    const state = latest.current;
    if (target.canvas) {
      dispatch({
        aspectRatio: target.canvas.aspectRatio,
        label: "Open project canvas",
        mode: target.canvas.mode,
        size: { ...target.canvas.size, unit: "px" },
        type: "canvas.applySettings",
      });
      // Fit the new canvas into view once it has been laid out.
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('button[aria-label="Center canvas"]')?.click(), 150);
    }
    if (target.layers && JSON.stringify(state.layers.map(toProjectLayer)) !== JSON.stringify(target.layers)) {
      for (const layer of state.layers) dispatch({ layerId: layer.id, type: "layers.delete" });
      target.layers.forEach((layer, index) => {
        dispatch({ insertIndex: index, layer, type: "layers.add" });
      });
    }
  };

  // Saves the open project, then makes `target` the open one with the given settings.
  const switchTo = (
    target: MoProject,
    label: string,
    extra: readonly MoProject[],
    extraValues: Record<string, unknown> = {},
  ): void => {
    leftHome.current = true;
    void flushRef.current();
    const { durationSeconds: duration, projects: latestProjects, schema: latestSchema, values: latestValues } = latest.current;
    const now = Date.now();
    const saved = latestProjects.items.map((item) =>
      item.id === latestProjects.currentId
        ? { ...item, ...captureExtras(), durationSeconds: duration, updatedAt: now, values: captureProjectValues(latestValues) }
        : item,
    );
    const items = [...saved, ...extra].map((item) => (item.id === target.id ? { ...item, openedAt: now } : item));
    dispatch({
      label,
      type: "controls.apply",
      values: { ...getModifierDefaults(latestSchema), ...extraValues, ...target.values, [MO_PROJECTS_TARGET]: { currentId: target.id, items } },
    });
    dispatch({ durationSeconds: target.durationSeconds, type: "timeline.setDuration" });
    applyCanvasAndLayers(target);
  };

  const openProject = (project: MoProject): void => {
    if (project.id !== projects.currentId) switchTo(project, `Open ${project.name}`, []);
  };

  const newProject = (): void => {
    const { projects: latestProjects, schema: latestSchema } = latest.current;
    // A blank project: no animation, default settings, the default 4:3 canvas, no layers, and the default timeline
    // length (not the length of the project that was open).
    const project = createProject(nextProjectName(latestProjects, "Untitled"), getDefaultProjectValues(latestSchema), NEW_PROJECT_SECONDS, {
      canvas: BLANK_PROJECT_CANVAS,
      layers: getBlankProjectLayers(),
    });
    switchTo(project, "New project", [project]);
    // A new project opens paused at the start; playing is the user's choice.
    dispatch({ isPlaying: false, type: "timeline.setPlaying" });
    dispatch({ currentTimeSeconds: 0, type: "timeline.setCurrentTime" });
  };

  // Opens a copy of a project (the live settings when it is the open one) under a new name.
  const duplicateProject = (id: string): void => {
    const state = latest.current;
    const source = state.projects.items.find((item) => item.id === id);
    if (!source) return;
    const base = id === state.projects.currentId
      ? { ...source, ...captureExtras(), durationSeconds: state.durationSeconds, values: captureProjectValues(state.values) }
      : source;
    const copy = createProject(uniqueProjectName(state.projects, `${source.name} copy`), { ...base.values }, base.durationSeconds, {
      ...(base.canvas ? { canvas: base.canvas } : {}),
      ...(base.layers ? { layers: base.layers } : {}),
    });
    switchTo(copy, `Duplicate ${source.name}`, [copy]);
  };

  // Export project: one file named after the project, holding the design layers, every control
  // value (including the saved animation versions) and the canvas and timeline settings.
  const exportProject = (): void => {
    const state = latest.current;
    const open = state.projects.items.find((item) => item.id === state.projects.currentId);
    const name = open?.name ?? "Project";
    downloadMoProjectFile(
      name,
      createProjectFile({
        canvas: { mode: state.canvasMode, size: state.canvasSize },
        durationSeconds: state.durationSeconds,
        layers: state.layers,
        name,
        projectId: open?.id,
        values: state.values,
      }),
    );
  };

  // Opening a file installs the animation it carries (or recognises an older file's), then opens
  // the project with its own parameters, layers and canvas.
  const applyProjectFile = async (file: ProjectFile): Promise<void> => {
    const incoming: AnimationSpec | null = file.animation;
    const { durationSeconds: duration, projects: latestProjects, values: currentValues } = latest.current;
    const library = readAnimationLibrary(currentValues[ANIMATION_LIBRARY_TARGET]);
    // Every project keeps the controls of its own animation. A file whose animation shares an id with
    // a different version already in the library (an older or edited copy) is stored under a new id,
    // so opening it never changes the controls of a project that is already open.
    let spec = incoming;
    if (spec && library.items[spec.id] && JSON.stringify(library.items[spec.id]) !== JSON.stringify(spec)) {
      let n = 2;
      while (library.items[`${spec.id}-${n}`]) n += 1;
      spec = { ...spec, id: `${spec.id}-${n}` };
    }
    // A project with no animation keeps its parameters as they are (an Interaction Animation plan lives there).
    const params = spec ? resolveParams(spec, file.params ?? {}) : (file.params ?? {});
    // Drawings no project uses any more are dropped: each one is a big copy of a page, and the app's saved
    // state outgrows what the browser will store if they pile up (then nothing saves).
    const inUse = new Set<string>();
    for (const item of latestProjects.items) {
      const type = item.values[ANIMATION_TYPE_TARGET];
      if (typeof type === "string") inUse.add(type);
    }
    const openType = currentValues[ANIMATION_TYPE_TARGET];
    if (typeof openType === "string") inUse.add(openType);
    if (spec) inUse.add(spec.id);
    const merged = spec ? { ...library.items, [spec.id]: spec } : library.items;
    const nextLibrary = { items: Object.fromEntries(Object.entries(merged).filter(([id]) => inUse.has(id))) };
    const layerSpecs = (
      file.layers ?? (spec ? spec.layers.map((layer) => ({ id: layer.id, kind: "layer" as const, name: layer.name, visible: true })) : [])
    ).filter((layer) => !HIDDEN_LAYER_IDS.includes(layer.id));
    // Only values this app has controls for can be applied.
    const known: Record<string, unknown> = {};
    for (const [target, value] of Object.entries(file.values)) {
      if (target in currentValues && !CANVAS_SIZING_TARGETS.has(target)) known[target] = value;
    }
    const projectValues = {
      ...captureProjectValues(known),
      [ANIMATION_TYPE_TARGET]: spec ? spec.id : "none",
      [ANIMATION_PARAMS_TARGET]: params,
    };
    // The file's own ID is kept unless a project in the list already has it (then this one is a copy and gets its own).
    const keepId = file.id !== null && !latestProjects.items.some((item) => item.id === file.id);
    const project = createProject(uniqueProjectName(latestProjects, file.name), projectValues, file.durationSeconds ?? duration, {
      ...(keepId && file.id ? { id: file.id } : {}),
      ...(file.canvas
        ? {
            canvas: {
              ...file.canvas,
              ...(file.values["canvas.aspectRatio"] === undefined ? {} : { aspectRatio: file.values["canvas.aspectRatio"] }),
            },
          }
        : {}),
      layers: layerSpecs.map(toProjectLayer),
    });
    switchTo(project, `Open ${project.name}`, [project], { ...known, [ANIMATION_LIBRARY_TARGET]: nextLibrary });
  };

  // Open project first offers the projects saved in the auto-save folder; Browse files picks any other.
  const [openList, setOpenList] = React.useState<readonly SavedProjectFile[] | null>(null);
  // The Open project page lists only the Recovered folder: copies of the 10 latest projects.
  const [recoveredList, setRecoveredList] = React.useState<readonly SavedProjectFile[]>([]);
  // The app starts on the Open page (its own page, not a dialog). Opening or starting a project leaves it; Back returns.
  // A reload (refresh) keeps the page you were on: inside a project it stays in the project. A new tab or window starts on the Open page.
  const [view, setView] = React.useState<"home" | "project">(() => readSavedView());
  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(VIEW_STORAGE_KEY, view);
      // Once a project has been opened in this tab, a reload keeps it as the current project (the Open page then offers Back).
      if (view === "project") window.sessionStorage.setItem(ENTERED_STORAGE_KEY, "1");
    } catch {
      // Storage can be blocked; the page then just starts on the Open page after a reload.
    }
  }, [view]);
  const showOpenDialog = (): void => setView("home");
  // Until a project is opened from the Open page, none is held open behind it: the app starts with no current project.
  // After a reload inside a project the project is kept.
  const leftHome = React.useRef(view === "project" || readEntered());
  const enterProject = (): void => {
    leftHome.current = true;
    setView("project");
  };
  React.useEffect(() => {
    if (leftHome.current || !projects.currentId) return;
    setProjects({ ...projects, currentId: null }, "Start on the Open page");
  }, [projects, setProjects]);
  React.useEffect(() => {
    if (view !== "home") return;
    listSavedProjects().then(
      (items) => setOpenList(items),
      () => setOpenList([]),
    );
    listSavedProjects("recovered").then(
      (items) => setRecoveredList(items),
      () => setRecoveredList([]),
    );
  }, [view]);
  // The Open project list can copy or delete a saved file. The open project's own file is kept:
  // auto-save would only write it again.
  const [confirmDiskDelete, setConfirmDiskDelete] = React.useState<string | null>(null);
  const refreshOpenList = (): void => {
    listSavedProjects().then(
      (items) => {
        setOpenList(items);
        setDiskFiles(items);
      },
      () => undefined,
    );
  };
  // Refresh makes Recent match the Recovered folder: new files appear, and projects whose file was removed there (outside the
  // app) go from the list. The open project stays, and nothing is dropped while the auto-save helper is off.
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshIconRef = React.useRef<SVGSVGElement>(null);
  const refreshRecent = (): void => {
    if (refreshing) return;
    setRefreshing(true);
    // The icon turns a full circle (one second), so a quick refresh still shows that it ran.
    // The icon turns a full circle so a quick refresh still shows that it ran. It is a Web Animation: the app's instant-UI
    // rule zeroes every CSS animation and transition, but not this.
    refreshIconRef.current?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 400, easing: "ease-in-out" });
    window.setTimeout(() => setRefreshing(false), 400);
    listSavedProjects().then(
      (items) => {
        setOpenList(items);
        setDiskFiles(items);
        const { projects: latestProjects } = latest.current;
        const onDisk = new Set(items.map((item) => item.name.replace(/\.json$/i, "")));
        const kept = latestProjects.items.filter((item) => item.id === latestProjects.currentId || onDisk.has(item.name));
        if (kept.length !== latestProjects.items.length) setProjects({ ...latestProjects, items: kept }, "Refresh recent projects");
      },
      () => undefined,
    );
  };
  const duplicateSavedProject = (fileName: string): void => {
    readSavedProject(fileName)
      .then(async (text) => {
        const data = JSON.parse(text) as Record<string, unknown>;
        const base = fileName.replace(/\.json$/i, "");
        const taken = new Set((openList ?? diskFiles).map((item) => item.name.replace(/\.json$/i, "")));
        let n = 2;
        while (taken.has(`${base} ${n}`)) n += 1;
        const name = `${base} ${n}`;
        await saveProjectToAutosave(name, { ...data, name, projectId: newProjectId() });
        refreshOpenList();
      })
      .catch((error: unknown) => setFolderError(error instanceof Error ? error.message : "Could not duplicate the file."));
  };
  const deleteSavedFile = (fileName: string): void => {
    const base = fileName.replace(/\.json$/i, "");
    deleteSavedProject(fileName)
      .then(() => {
        // A project of that name that is only in the browser's list goes too, so it is not offered again.
        const { projects: latestProjects } = latest.current;
        const listed = latestProjects.items.find((item) => item.name === base && item.id !== latestProjects.currentId);
        if (listed) deleteProject(listed.id);
        refreshOpenList();
      })
      .catch((error: unknown) => setFolderError(error instanceof Error ? error.message : "Could not delete the file."));
  };
  // Projects saved on disk that this browser has not opened yet. The browser keeps its own recent
  // list, so a fresh browser profile would otherwise start with none of them.
  const [diskFiles, setDiskFiles] = React.useState<readonly SavedProjectFile[]>([]);
  const projectCount = projects.items.length;
  React.useEffect(() => {
    let cancelled = false;
    listSavedProjects().then(
      (items) => {
        if (!cancelled) setDiskFiles(items);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectCount, autosave.state]);
  const openSavedProject = (name: string, source: "projects" | "recovered" = "projects"): void => {
    // A project already in the browser's list is opened as it is: reading its file again would add a copy ("... 2").
    const existing = source === "projects" ? latest.current.projects.items.find((item) => item.name === name.replace(/\.json$/i, "")) : undefined;
    if (existing) {
      if (existing.id !== latest.current.projects.currentId) openProject(existing);
      enterProject();
      return;
    }
    readSavedProject(name, source)
      .then(async (text) => {
        // A saved file is opened under its own file name, whatever name is written inside it (BaseCase Landingpage_v1.json
        // holds "BaseCase Landingpage"): auto-save then writes back to the same file instead of making a second one.
        const file = { ...parseProjectFile(text, name), name: name.replace(/\.json$/i, "") };
        const sameName =
          (file.id ? latest.current.projects.items.find((item) => item.id === file.id) : undefined) ??
          latest.current.projects.items.find((item) => item.name === file.name);
        if (sameName) {
          if (sameName.id !== latest.current.projects.currentId) openProject(sameName);
          enterProject();
          return;
        }
        await applyProjectFile(file);
        setFolderError(null);
        enterProject();
      })
      .catch((error: unknown) => setFolderError(error instanceof Error ? error.message : "Could not open the file."));
  };

  const browseProjectFile = (): void => {
    pickMoProjectFile()
      .then(async (file) => {
        // A video or GIF opens as a new Animation project made of that one layer.
        if (mediaKindOf(file)) await applyProjectFile(buildProjectFromMedia(await readMediaFile(file)));
        else await applyProjectFile(parseProjectFile(await file.text(), file.name));
        setFolderError(null);
        enterProject();
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFolderError(error instanceof Error ? error.message : "Could not open the file.");
      });
  };

  // The inspector's Export project and Open project buttons are the framework's own, so their
  // clicks are routed here: files are named after the project and carry the layers too.
  const exportRef = React.useRef(exportProject);
  // Render has nothing to draw in a blank project, so its button is disabled there. The button
  // belongs to the framework's sticky action bar, so it is found in the page and kept in step.
  const hasAnimation = getActiveAnimation(values) !== null;
  React.useEffect(() => {
    const sync = (): void => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-panel-type="controls"] [data-slot="panel-actions"] button')) {
        if (button.textContent?.trim() !== "Render") continue;
        if (button.disabled === !hasAnimation) continue;
        button.disabled = !hasAnimation;
        button.title = hasAnimation ? "" : "Open a project with an animation to render";
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hasAnimation]);

  // Tapping Space plays and pauses the timeline, wherever the focus is (a clicked button, a slider, the strip...); only typing
  // places (text fields, menus, dialogs) keep their Space. Holding it while dragging still pans the canvas (the runtime owns
  // that), so playback toggles only when Space is released without a drag.
  React.useEffect(() => {
    let armed = false;
    const typing = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest("textarea, select, [contenteditable], [role=textbox], [role=combobox], [role=listbox], [role=menuitem], [role=dialog], [role=alertdialog]")) return true;
      const input = target.closest("input");
      return input !== null && !["button", "checkbox", "radio", "range", "submit"].includes(input.type);
    };
    // A focused button or switch would also be pressed by Space: the key goes to playback only.
    const takes = (target: EventTarget | null): boolean => target instanceof Element && target.closest("button, a, input, [role=slider], [role=switch], [role=tab]") !== null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (takes(event.target)) event.preventDefault();
      if (event.repeat) return;
      armed = true;
    };
    const onPointerDown = (): void => {
      armed = false;
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || !armed) return;
      armed = false;
      if (takes(event.target)) event.preventDefault();
      dispatch({ type: "timeline.togglePlayback" });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [dispatch]);

  // The list opens when the app is opened in a new tab or window (session storage is empty then),
  // not on a reload or refresh of the same tab.
  React.useEffect(() => {
    const KEY = "mo-app:session-started";
    try {
      if (window.sessionStorage.getItem(KEY)) return;
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      return;
    }
    listSavedProjects().then(
      (items) => {
        if (items.length > 0) setOpenList(items);
      },
      () => undefined,
    );
  }, []);
  const openRef = React.useRef(showOpenDialog);
  const importRef = React.useRef(browseProjectFile);
  exportRef.current = exportProject;
  openRef.current = showOpenDialog;
  importRef.current = browseProjectFile;
  React.useEffect(() => {
    const onOpen = (): void => openRef.current();
    window.addEventListener(OPEN_PROJECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PROJECT_EVENT, onOpen);
  }, []);
  React.useEffect(() => {
    const root = document.querySelector('[data-slot="toolcraft-runtime-app"]');
    if (!root) return;
    const onClick = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!button?.closest('[data-panel-type="controls"]')) return;
      const label = button.textContent?.trim();
      if (label === "Export project") {
        event.preventDefault();
        event.stopPropagation();
        exportRef.current();
      } else if (label === "Import project" && canPickMoProjectFile()) {
        // Import project goes straight to the file browser; the Open page (home icon) lists the saved projects.
        event.preventDefault();
        event.stopPropagation();
        importRef.current();
      }
    };
    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, []);

  // Removes a project. Deleting one that is not open just drops it from the list; deleting the open
  // one opens the most recent other (or a fresh project when none is left).
  const deleteProject = (id: string): void => {
    const { durationSeconds: duration, projects: latestProjects, schema: latestSchema } = latest.current;
    // The project's saved file in the auto-save folder goes with it, so it is not offered again.
    const doomed = latestProjects.items.find((item) => item.id === id);
    if (doomed) {
      const fileName = `${doomed.name}.json`;
      lastWritten.current.delete(doomed.name);
      deleteSavedProject(fileName).then(
        () => refreshOpenList(),
        () => undefined,
      );
    }
    if (id !== latestProjects.currentId) {
      setProjects({ ...latestProjects, items: latestProjects.items.filter((item) => item.id !== id) }, "Delete project");
      return;
    }
    const remaining = latestProjects.items.filter((item) => item.id !== latestProjects.currentId);
    const target = getRecentProjects({ currentId: null, items: remaining })[0];
    const now = Date.now();
    if (!target) {
      // Nothing left to open: the Open page is shown, with no project made for you.
      dispatch({ label: "Delete project", type: "controls.apply", values: { [MO_PROJECTS_TARGET]: { currentId: null, items: [] } } });
      setView("home");
      return;
    }
    dispatch({
      label: "Delete project",
      type: "controls.apply",
      values: {
        ...target.values,
        [MO_PROJECTS_TARGET]: {
          currentId: target.id,
          items: remaining.map((item) => (item.id === target.id ? { ...item, openedAt: now } : item)),
        },
      },
    });
    dispatch({ durationSeconds: target.durationSeconds, type: "timeline.setDuration" });
    applyCanvasAndLayers(target);
  };

  // Renames the open project; its saved file moves to the new name. Returns false when another project has the name.
  const renameProject = (name: string): boolean => {
    const { projects: latestProjects } = latest.current;
    const open = latestProjects.items.find((item) => item.id === latestProjects.currentId);
    if (!open || name === open.name) return true;
    // Two projects with one name would share one saved file; the second would overwrite the first.
    if (latestProjects.items.some((item) => item.id !== open.id && item.name === name)) return false;
    const previousName = open.name;
    const renamed = { ...open, name, updatedAt: Date.now() };
    setProjects(
      { ...latestProjects, items: latestProjects.items.map((item) => (item.id === renamed.id ? renamed : item)) },
      "Rename project",
    );
    // The project is saved under its new name from now on, so its file under the old name goes: otherwise the Open
    // page would list the same project twice.
    lastWritten.current.delete(previousName);
    deleteSavedProject(`${previousName}.json`).then(
      () => refreshOpenList(),
      () => undefined,
    );
    return true;
  };

  // The folder button and its menu: shown in the Saved to section and in the project bar popup (they share one state).
  // Effects (the Perspective icon from Filter effects): opens or closes the Perspective section in the Modifier tab; it works on the layer
  // selected in the Layers tab, so the icon is off until a layer is selected.
  const perspectiveOn = values[TOOL_PERSPECTIVE_TARGET] === true;
  // A project opens without its Perspective section: it appears only when its card is pressed.
  React.useEffect(() => {
    dispatch({ label: "Perspective", target: TOOL_PERSPECTIVE_TARGET, type: "controls.setValue", value: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const togglePerspective = (): void => {
    const next = !perspectiveOn;
    dispatch({ label: "Perspective", target: TOOL_PERSPECTIVE_TARGET, type: "controls.setValue", value: next });
    if (!next) return;
    dispatch({ label: "Modifier", target: "inspector.tab", type: "controls.setValue", value: "modifier" });
    // The section opens folded when it has been folded before: unfold it.
    window.setTimeout(() => {
      const button = document.querySelector<HTMLElement>('button[aria-label="Toggle Perspective section"]');
      if (button?.getAttribute("aria-expanded") === "false") button.click();
    }, 150);
  };

  // What auto-save is doing (last saved, GitHub, errors): shown in the project bar popup under Folder settings.
  const saveStatus = (
    <>
      {autosave.state === "on" && autosave.savedAt ? (
        <FieldDescription>Last saved {new Date(autosave.savedAt).toLocaleTimeString()}</FieldDescription>
      ) : null}
      {autosave.github?.enabled && autosave.github.state !== "error" ? (
        <FieldDescription>
          {autosave.github.state === "synced" && autosave.github.lastSyncedAt
            ? `GitHub synced ${new Date(autosave.github.lastSyncedAt).toLocaleTimeString()}${autosave.github.branch ? ` · ${autosave.github.branch}` : ""}`
            : autosave.github.state === "syncing"
              ? "Syncing projects to GitHub…"
              : "GitHub sync queued"}
        </FieldDescription>
      ) : null}
      {autosave.github?.state === "error" ? <FieldError>GitHub sync failed. Local auto-save is still active.</FieldError> : null}
      {autosave.state === "off" ? <FieldError>Auto-save to disk is off. Start the app with npm run dev.</FieldError> : null}
      {folderError ? <FieldError>{folderError}</FieldError> : null}
    </>
  );

  // Clear caches: the broom always shows beside Folder settings in the popup; in the project bar, beside the name, only while there are caches to clear.
  const clearCachesButton = (
    <Button
      aria-label="Clear caches"
      onClick={refreshRuntime}
      size="icon-xs"
      title="Clear caches: refresh the drawing's memory and remove unused pictures"
      type="button"
      variant="ghost"
    >
      <span style={{ display: "inline-flex", position: "relative" }}>
        <Broom />
        {hasCaches ? <span style={GREEN_DOT_CORNER} /> : null}
      </span>
    </Button>
  );

  const renderFolderSettings = (extra: React.ReactNode = null): React.ReactNode => (
    <>
      {autosave.state === "on" ? (
        <div className={styles.folderRow}>
          <Button
            aria-expanded={folderMenu !== null}
            aria-label="Project folder settings"
            onClick={() => setFolderMenu((open) => (open ? null : { path: autosave.dir ?? "" }))}
            size="sm"
            title={autosave.dirMissing ? "The save folder was not found. Choose another folder." : "Choose the folder projects are saved in"}
            type="button"
            variant="ghost"
          >
            <GearSix aria-hidden="true" size={14} />
            <span>Folder settings</span>
            {autosave.dirMissing ? (
              <span aria-label="Save folder not found" className={styles.folderAlert} role="img" />
            ) : (
              <span aria-label="Save folder found" className={styles.folderOk} role="img" />
            )}
          </Button>
          {extra}
        </div>
      ) : extra ? (
        <div className={styles.folderRow}>{extra}</div>
      ) : null}
      {folderMenu ? (
        <div className={styles.folderMenu}>
          <Input
            aria-label="Project folder"
            onChange={(event) => setFolderMenu({ path: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="/Users/you/Documents/seaMotion/Recovered"
            value={folderMenu.path}
          />
          <div className={styles.folderButtons}>
            <Button
              onClick={() => {
                setFolderError(null);
                chooseProjectAutosaveDir().then(
                  (chosen) => {
                    if (chosen) setFolderMenu({ path: chosen });
                  },
                  (error: unknown) => setFolderError(error instanceof Error ? error.message : "Could not open the folder picker."),
                );
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <FolderOpen aria-hidden="true" size={14} />
              <span>Choose…</span>
            </Button>
            <Button
              disabled={folderMenu.path.trim() === "" || folderMenu.path.trim() === autosave.dir}
              onClick={() => {
                setFolderError(null);
                setProjectAutosaveDir(folderMenu.path.trim()).then(
                  async (dir) => {
                    // The open project is written into the new folder at once; the Open project list reads it from there.
                    lastWritten.current.clear();
                    setAutosave((previous) => ({ ...previous, dir, dirMissing: false }));
                    setFolderMenu(null);
                    await flushRef.current();
                  },
                  (error: unknown) => setFolderError(error instanceof Error ? error.message : "Could not use that folder."),
                );
              }}
              size="sm"
              type="button"
            >
              Use this folder
            </Button>
          </div>
          <FieldDescription>New projects and the Open project list use this folder.</FieldDescription>
        </div>
      ) : null}
    </>
  );

  // A Figma design pasted into the open project goes into it (see planDesignPaste); a project still under its default
  // name ("Untitled 2") takes the name of the pasted frame. With `replace`, the design takes that layer's place.
  const pasteDesign = async (text: string, replace?: ReplaceTarget): Promise<void> => {
    const state = latest.current;
    const open = state.projects.items.find((item) => item.id === state.projects.currentId);
    if (!open) {
      await applyProjectFile(buildProjectFromFigmaPaste(text));
      window.dispatchEvent(new Event("mo-show-layers"));
      return;
    }
    const plan = await planDesignPaste(text, { canvasSize: state.canvasSize, layers: state.layers, values: state.values }, replace);
    for (const command of plan.commands) dispatch(command);
    setCacheNote(plan.note ?? null);
    // A design came in: the Layers tab opens to show it.
    window.dispatchEvent(new Event("mo-show-layers"));
    if (plan.resized) window.setTimeout(() => document.querySelector<HTMLButtonElement>('button[aria-label="Center canvas"]')?.click(), 150);
    if (isDefaultProjectName(open.name)) renameProject(uniqueProjectName(latest.current.projects, plan.frameName.slice(0, MAX_NAME_LENGTH)));
  };
  pasteDesignRef.current = pasteDesign;

  // Paste to replace: the design fills the box the layer is drawn in now.
  const pasteReplace = async (layerId: string, text: string): Promise<void> => {
    const state = latest.current;
    const box = await measureLayerBox(
      { canvasSize: state.canvasSize, durationSeconds: state.durationSeconds, layers: state.layers, timeSeconds: state.timeSeconds, values: state.values },
      layerId,
    );
    await pasteDesign(text, { box, layerId });
  };


  const pendingDelete = projects.items.find((item) => item.id === confirmDeleteId) ?? null;
  const versionCount = pendingDelete ? readMoVersions(pendingDelete.values[MO_VERSIONS_KEY]).items.length : 0;
  const recent = getListedProjects(projects.items.length ? projects : EMPTY_MO_PROJECTS);

  // The agent channel: an agent working on the open project reports what it is doing (shown over the artboard) and
  // hands over the result, which is applied to the open project in place and saved as a new version. No switching away,
  // no delete and re-create: autosave then writes the project file as usual.
  const [agentView, setAgentView] = React.useState<AgentView | null>(null);
  const appliedAgentUpdate = React.useRef<string | null>(null);
  const applyAgentUpdate = (data: Record<string, unknown>): string => {
    const state = latest.current;
    const values: Record<string, unknown> = {};
    if (isAnimationSpec(data.animation)) {
      const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
      values[ANIMATION_LIBRARY_TARGET] = { items: { ...library.items, [data.animation.id]: data.animation } };
      values[ANIMATION_TYPE_TARGET] = data.animation.id;
    }
    if (isPlainRecord(data.params)) values[ANIMATION_PARAMS_TARGET] = data.params;
    if (isPlainRecord(data.values)) {
      for (const [target, value] of Object.entries(data.values)) {
        if (target in state.values && !AGENT_PROTECTED_TARGETS.has(target) && !CANVAS_SIZING_TARGETS.has(target)) values[target] = value;
      }
    }
    const duration = typeof data.durationSeconds === "number" && data.durationSeconds > 0 ? data.durationSeconds : state.durationSeconds;
    const versions = readMoVersions(state.values[MO_VERSIONS_TARGET]);
    const wanted = typeof data.version === "string" ? data.version.trim().slice(0, 40) : "";
    const name = wanted && !versions.items.some((item) => item.name === wanted) ? wanted : nextMoVersionName(versions);
    const merged = { ...state.values, ...values };
    const newLayers = Array.isArray(data.layers)
      ? data.layers.filter(
          (layer): layer is ProjectFileLayer =>
            isPlainRecord(layer) && typeof layer.id === "string" && typeof layer.name === "string" && typeof layer.visible === "boolean",
        )
      : [];
    const panelLayers = newLayers.length > 0 ? newLayers : state.layers;
    // Scripts for versions saved before versions kept their script ({ "v_03": { code, controls, layers, panelLayers } }).
    let items = versions.items;
    if (isPlainRecord(data.versionScripts)) {
      const scripts = data.versionScripts;
      items = items.map((item) => {
        const script = scripts[item.name];
        return isPlainRecord(script) && typeof script.code === "string" && Array.isArray(script.controls) && Array.isArray(script.layers)
          ? { ...item, script: script as unknown as MoVersionScript }
          : item;
      });
    }
    if (data.saveVersion === false) {
      values[MO_VERSIONS_TARGET] = { activeId: versions.activeId, items };
    } else {
      const script = captureMoVersionScript(merged, panelLayers.map(toProjectLayer));
      const version = {
        durationSeconds: duration,
        id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name,
        ...(script ? { script } : {}),
        values: Object.fromEntries(Object.entries(merged).filter(([target]) => isVersionTarget(target))),
      };
      values[MO_VERSIONS_TARGET] = { activeId: version.id, items: [...items, version] };
    }
    dispatch({ label: `Agent update (${name})`, type: "controls.apply", values });
    if (duration !== state.durationSeconds) dispatch({ durationSeconds: duration, type: "timeline.setDuration" });
    if (newLayers.length > 0 && JSON.stringify(state.layers.map(toProjectLayer)) !== JSON.stringify(newLayers.map(toProjectLayer))) {
      for (const layer of state.layers) dispatch({ layerId: layer.id, type: "layers.delete" });
      newLayers.map(toProjectLayer).forEach((layer, index) => dispatch({ insertIndex: index, layer, type: "layers.add" }));
    }
    return data.saveVersion === false ? "" : name;
  };
  const applyAgentUpdateRef = React.useRef(applyAgentUpdate);
  applyAgentUpdateRef.current = applyAgentUpdate;
  React.useEffect(() => {
    if (autosave.state !== "on") return undefined;
    let busy = false;
    let hideTimer = 0;
    const openName = (): string | null => {
      const open = latest.current.projects.items.find((item) => item.id === latest.current.projects.currentId);
      return open ? open.name : null;
    };
    const finish = (next: AgentView): void => {
      setAgentView(next);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setAgentView(null), next.kind === "error" ? 6000 : 3500);
    };
    const tick = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const { status, update } = await readAgentChannel();
        const project = openName();
        if (update?.id && update.project === project && update.id !== appliedAgentUpdate.current) {
          appliedAgentUpdate.current = update.id;
          setAgentView({ kind: "working", message: "Applying the update to this project…", percent: 100 });
          try {
            const name = applyAgentUpdateRef.current(JSON.parse(await readAgentUpdate()) as Record<string, unknown>);
            finish({ kind: "saved", message: name ? `Saved as version ${name}` : "Updated this project", percent: 100 });
          } catch (error) {
            finish({ kind: "error", message: error instanceof Error ? error.message : "The update could not be applied.", percent: 100 });
          }
          await finishAgentUpdate(update.id);
          return;
        }
        if (status && status.project === project && Date.now() - status.at < AGENT_STATUS_MAX_AGE_MS) {
          setAgentView((previous) => (previous && previous.kind !== "working" ? previous : { kind: "working", message: status.message, percent: status.percent }));
        } else {
          setAgentView((previous) => (previous && previous.kind !== "working" ? previous : null));
        }
      } catch {
        // The helper is not answering; try again on the next tick.
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), AGENT_POLL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(hideTimer);
    };
  }, [autosave.state]);

  return (
    <div className={view === "home" ? `${styles.dock} ${styles.dockHome}` : styles.dock} data-mo-app-sidebar="">
      {view === "project" ? <MoAgentOverlay view={agentView} /> : null}
      {view === "project" ? (
        <MoPasteMenu
          activeLayerId={activeLayerId}
          layerName={(id) => {
            const layer = latest.current.layers.find((item) => item.id === id);
            return layer ? (layer.displayName ?? layer.name) : null;
          }}
          actions={layerActions}
          canPaste={hasCopiedLayer}
          isMain={(id) => {
            const layer = latest.current.layers.find((item) => item.id === id);
            return layer !== undefined && !layer.parentGroupId;
          }}
          onReplace={pasteReplace}
        />
      ) : null}
      <PanelSurface className={styles.rail}>
        <Button aria-label="Open page" onClick={() => setView("home")} size="icon" title="Home: the Open project page" type="button" variant="ghost">
          <House aria-hidden="true" size={16} />
        </Button>
        <span aria-hidden="true" className={styles.railDivider} />
        <Button
          aria-label="Layers"
          aria-pressed={tab === "layers"}
          onClick={() => setTab("layers")}
          size="icon"
          title="Layers"
          type="button"
          variant={tab === "layers" ? "secondary" : "ghost"}
        >
          <Stack aria-hidden="true" size={16} />
        </Button>
        <Button
          aria-label="Assets"
          aria-pressed={tab === "projects"}
          onClick={() => setTab("projects")}
          size="icon"
          title="Assets"
          type="button"
          variant={tab === "projects" ? "secondary" : "ghost"}
        >
          <FolderSimple aria-hidden="true" size={16} weight={tab === "projects" ? "fill" : "regular"} />
        </Button>
        <Button
          aria-label="Effects"
          aria-pressed={tab === "effects"}
          onClick={() => setTab("effects")}
          size="icon"
          title="Effects"
          type="button"
          variant={tab === "effects" ? "secondary" : "ghost"}
        >
          <Sparkle aria-hidden="true" size={16} weight={tab === "effects" ? "fill" : "regular"} />
        </Button>
        <Button
          aria-label="Recent"
          aria-pressed={tab === "recent"}
          onClick={() => setTab("recent")}
          size="icon"
          title="Recent projects"
          type="button"
          variant={tab === "recent" ? "secondary" : "ghost"}
        >
          <ClockCounterClockwise aria-hidden="true" size={16} weight={tab === "recent" ? "fill" : "regular"} />
        </Button>
        <MoRailTools />
      </PanelSurface>
      <div className={styles.column}>
      {tab === "layers" ? (
        <LayersPanel className={styles.panel} framed={false} panelState={SIDEBAR_LAYERS_STATE} />
      ) : (
      <div className={styles.projectsWrap} style={{ width: projectsWidth }}>
      <Panel className={styles.projectsPanel} title={tab === "effects" ? "Effects" : "Assets"}>
        {tab === "effects" ? (
          <MoEffectsPanel hasLayer={activeLayerId !== null} onTogglePerspective={togglePerspective} perspectiveOn={perspectiveOn} />
        ) : tab === "recent" ? (
          <>
        <PanelSection
          action={
            <>
              <PanelIconButton label="Refresh recent projects" onClick={refreshRecent}>
                <ArrowClockwise aria-hidden="true" ref={refreshIconRef} size={14} />
              </PanelIconButton>
            </>
          }
          title="Recent"
        >
          <div className={styles.recentList}>
            {recent.map((project) => (
              <div
                aria-current={project.id === projects.currentId ? "true" : undefined}
                className={project.id === projects.currentId ? `${styles.recentRow} ${styles.recentRowActive}` : styles.recentRow}
                key={project.id}
              >
                <button className={styles.recentOpen} onClick={() => openProject(project)} type="button">
                  <span className={styles.recentName}>{project.name}</span>
                  {project.id === projects.currentId ? <Check size={12} /> : null}
                </button>
                <Button
                  aria-label={`Duplicate ${project.name}`}
                  className={styles.recentDuplicate}
                  onClick={() => duplicateProject(project.id)}
                  size="icon-xs"
                  title="Duplicate project"
                  type="button"
                  variant="ghost"
                >
                  <Copy size={12} />
                </Button>
                <Button
                  aria-label={`Delete ${project.name}`}
                  className={styles.recentDelete}
                  onClick={() => setConfirmDeleteId(project.id)}
                  size="icon-xs"
                  title="Delete project"
                  type="button"
                  variant="ghost"
                >
                  <Trash size={12} />
                </Button>
              </div>
            ))}
            {diskFiles
              .filter((file) => !projects.items.some((project) => project.name === file.name.replace(/\.json$/i, "")))
              .map((file) => (
                <div className={styles.recentRow} key={file.name}>
                  <button className={styles.recentOpen} onClick={() => openSavedProject(file.name)} title="Saved on disk" type="button">
                    <span className={styles.recentName}>{file.name.replace(/\.json$/i, "")}</span>
                  </button>
                  <Button
                    aria-label={`Duplicate ${file.name.replace(/\.json$/i, "")}`}
                    className={styles.recentDuplicate}
                    onClick={() => duplicateSavedProject(file.name)}
                    size="icon-xs"
                    title="Duplicate project"
                    type="button"
                    variant="ghost"
                  >
                    <Copy size={12} />
                  </Button>
                  <Button
                    aria-label={`Delete ${file.name.replace(/\.json$/i, "")}`}
                    className={styles.recentDelete}
                    onClick={() => setConfirmDiskDelete(file.name)}
                    size="icon-xs"
                    title="Delete project"
                    type="button"
                    variant="ghost"
                  >
                    <Trash size={12} />
                  </Button>
                </div>
              ))}
          </div>
        </PanelSection>
          </>
        ) : (
        <>
        <PanelSection title="Import">
          <Tabs onValueChange={(next) => setImportTab(next === "media" ? "media" : "paste")} value={importTab}>
            <TabsList variant="control">
              <TabsTrigger value="paste">Paste design</TabsTrigger>
              <TabsTrigger value="media">Video & GIF</TabsTrigger>
            </TabsList>
          </Tabs>
          {importTab === "paste" ? (
            <>
              <textarea
                aria-label="Paste design JSON"
                className={styles.pasteBox}
                onChange={(event) => {
                  setPasteText(event.target.value);
                  setPasteError(null);
                }}
                placeholder="Paste what the Figma plugin copied, then press Import"
                rows={3}
                spellCheck={false}
                value={pasteText}
              />
              <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
              <Button
                disabled={pasteText.trim() === "" || pasting}
                onClick={() => {
                  setPasting(true);
                  setPasteError(null);
                  Promise.resolve()
                    .then(() => pasteDesign(pasteText))
                    .then(
                      () => setPasteText(""),
                      (error: unknown) => setPasteError(error instanceof Error ? error.message : "Could not import that design."),
                    )
                    .finally(() => setPasting(false));
                }}
                size="sm"
                type="button"
              >
                {pasting ? "Importing…" : "Import"}
              </Button>
              {cacheSweep && cacheSweep.count > 0 ? (
                <Button onClick={clearCaches} size="sm" title="Removes the design's picture, texts' fallback pictures and unused pictures to make the project lighter. The design stays." type="button" variant="outline">
                  {`Clear caches · ${formatBytes(cacheSweep.bytes)}`}
                </Button>
              ) : null}
              </div>
              {cacheNote ? <FieldDescription>{cacheNote}</FieldDescription> : null}
              {pasteError ? <FieldError>{pasteError}</FieldError> : null}
            </>
          ) : (
            <>
              <Button disabled={addingMedia} onClick={addMediaLayer} size="sm" type="button">
                {addingMedia ? "Adding…" : "Add video or GIF"}
              </Button>
              <FieldDescription>MP4, WebM or GIF up to 40 MB, added on top of the design. Drag it in Layers to put it under.</FieldDescription>
              {mediaError ? <FieldError>{mediaError}</FieldError> : null}
            </>
          )}
        </PanelSection>

        <MoAssetLists />

        </>
        )}
      </Panel>
        <div
          aria-label="Resize Projects panel"
          aria-orientation="vertical"
          aria-valuemax={PROJECTS_MAX_WIDTH}
          aria-valuemin={PROJECTS_MIN_WIDTH}
          aria-valuenow={projectsWidth}
          className={styles.resizer}
          data-panel-drag-ignore=""
          onKeyDown={resizeProjectsByKey}
          onLostPointerCapture={stopProjectsResize}
          onPointerCancel={stopProjectsResize}
          onPointerDown={startProjectsResize}
          onPointerMove={resizeProjects}
          onPointerUp={stopProjectsResize}
          role="separator"
          tabIndex={0}
          title="Drag to resize Projects panel"
        >
          <span className={styles.resizerGrip} />
        </div>
      </div>
      )}
      </div>
      <MoToolbarTweaks />
      {view !== "home" && current ? (
        <MoProjectBar
          id={current.id}
          name={current.name}
          onDelete={() => setConfirmDeleteId(current.id)}
          onDuplicate={() => duplicateProject(current.id)}
          onNew={newProject}
          onRename={renameProject}
          savedDir={autosave.dir}
          clearCaches={hasCaches ? clearCachesButton : null}
          folderSettings={
            <>
              {renderFolderSettings(clearCachesButton)}
              {saveStatus}
            </>
          }
        />
      ) : null}
      <RatioBar />
      <ScenesStrip />
      <MotionTimeline />
      <SceneLengthInput />
      {view === "home" ? (
        <div className={styles.homePage} data-mo-app-home="">
          <div className={styles.homeBody}>
            <div className={styles.homeHeader}>
              <div>
                <h1 className={styles.homeTitle}>Open project</h1>
                <p className={styles.homeSub}>Recovered projects, newest first.</p>
              </div>
            </div>
            <div className={styles.homeList}>
              {recoveredList.map((item) => (
                <div className={styles.savedRow} key={item.name}>
                  <Button className={styles.savedItem} onClick={() => openSavedProject(item.name, "recovered")} type="button" variant="ghost">
                    <span className={styles.recentName}>{item.name.replace(/\.json$/i, "")}</span>
                    <span className={styles.savedMeta}>{new Date(item.modified).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                  </Button>
                </div>
              ))}
              {recoveredList.length === 0 ? <p className={styles.homeSub}>No recovered projects yet. Start a new one or browse for a file.</p> : null}
            </div>
            {confirmDiskDelete !== null ? (
              <div className={styles.homeConfirm} role="alertdialog">
                <span>
                  Delete “{confirmDiskDelete.replace(/\.json$/i, "")}”? The saved file is removed from the auto-save folder and cannot be brought back from the app.
                </span>
                <div className={styles.homeActionsEnd}>
                  <Button onClick={() => setConfirmDiskDelete(null)} type="button" variant="ghost">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      const file = confirmDiskDelete;
                      setConfirmDiskDelete(null);
                      deleteSavedFile(file);
                    }}
                    type="button"
                    variant="destructive"
                  >
                    Delete project
                  </Button>
                </div>
              </div>
            ) : null}
            <div className={styles.homeActions}>
              {current ? (
                <Button onClick={() => enterProject()} type="button" variant="ghost">
                  <CaretLeft aria-hidden="true" size={14} />
                  <span>Back</span>
                </Button>
              ) : null}
              <div className={styles.homeActionsEnd}>
                <Button onClick={browseProjectFile} type="button" variant="secondary">
                  Browse files…
                </Button>
                <Button
                  onClick={() => {
                    newProject();
                    enterProject();
                  }}
                  type="button"
                >
                  New project
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <AlertDialog onOpenChange={(open) => !open && setConfirmDiskDelete(null)} open={view !== "home" && confirmDiskDelete !== null}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDiskDelete?.replace(/\.json$/i, "")}”?</AlertDialogTitle>
            <AlertDialogDescription>The saved file is removed from the auto-save folder and cannot be brought back from the app.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogActions>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const file = confirmDiskDelete;
                setConfirmDiskDelete(null);
                if (file) deleteSavedFile(file);
              }}
              variant="destructive"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog onOpenChange={(open) => !open && setConfirmDeleteId(null)} open={confirmDeleteId !== null}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {versionCount > 0
                ? `This also deletes its ${versionCount} saved ${versionCount === 1 ? "version" : "versions"} and its saved file in the Recovered folder. They cannot be brought back from the app.`
                : "Its settings and its saved file in the Recovered folder cannot be brought back from the app."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogActions>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = confirmDeleteId;
                setConfirmDeleteId(null);
                if (id) deleteProject(id);
              }}
              variant="destructive"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
