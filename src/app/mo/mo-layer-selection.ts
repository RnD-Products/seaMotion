import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { getActiveAnimation, getLayerImageAssets } from "../animation/animation-spec";

// The runtime can select a layer but has no command to clear the selection, so "deselected" is kept
// here: the layer that was selected when the user clicked away. It counts as deselected until a
// layer row is clicked again or another layer becomes selected.
let dismissedLayerId: string | null = null;
// When the user last clicked a layer row. A selection the runtime makes by itself (opening a project, a
// reload) is not a pick, so it starts out deselected.
let lastPickAt = 0;
const PICK_WINDOW_MS = 1000;
const listeners = new Set<() => void>();

function setDismissed(next: string | null): void {
  if (dismissedLayerId === next) return;
  dismissedLayerId = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The layer being edited: the runtime selection unless the user has deselected it.
export function useActiveLayerId(selectedLayerId: string | null): string | null {
  const dismissed = React.useSyncExternalStore(subscribe, () => dismissedLayerId);
  return selectedLayerId !== null && selectedLayerId === dismissed ? null : selectedLayerId;
}

const LAYER_ROW = "[data-layer-id]";
// Clicks here edit or navigate; they never clear the selection. Layer buttons, the inspector,
// the timeline and toolbar are panels; popups render outside them.
const KEEP_SELECTION =
  '[data-panel-type], [data-mo-app-sidebar], [data-mo-canvas-edit], [data-slot^="layers-panel"], [data-layer-list], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"]';
const CLICK_SLOP = 4;

// Clicking empty artboard space lets go of the selected layer.
export function dismissLayerSelection(selectedLayerId: string | null): void {
  setDismissed(selectedLayerId);
}

// A layer chosen by the app on purpose (a bar picked in the timeline) counts as picked, so its row stays highlighted.
export function notePickedLayer(): void {
  lastPickAt = Date.now();
  setDismissed(null);
}

// Clicking the canvas or empty space deselects the layer; a drag (pan) does not.
export function useLayerDeselect(selectedLayerId: string | null): void {
  const selectedRef = React.useRef(selectedLayerId);
  selectedRef.current = selectedLayerId;

  React.useEffect(() => {
    if (selectedLayerId === null) {
      setDismissed(null);
      return;
    }
    // Only a click on a layer row selects a layer; anything else selected it automatically.
    if (Date.now() - lastPickAt > PICK_WINDOW_MS) setDismissed(selectedLayerId);
    else if (dismissedLayerId !== null && dismissedLayerId !== selectedLayerId) setDismissed(null);
  }, [selectedLayerId]);

  React.useEffect(() => {
    let start: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(LAYER_ROW)) {
        lastPickAt = Date.now();
        setDismissed(null);
        start = null;
        return;
      }
      start = event.button === 0 && !target?.closest(KEEP_SELECTION) ? { x: event.clientX, y: event.clientY } : null;
    };
    const onUp = (event: PointerEvent): void => {
      const origin = start;
      start = null;
      if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > CLICK_SLOP) return;
      setDismissed(selectedRef.current);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, []);

  // The Layers panel marks the runtime selection; while it is dismissed the highlight is removed too.
  const dismissed = React.useSyncExternalStore(subscribe, () => dismissedLayerId);
  React.useEffect(() => {
    const root = document.body;
    const sync = (): void => {
      for (const row of root.querySelectorAll<HTMLElement>(`[data-layer-list] ${LAYER_ROW}`)) {
        const surface = row.querySelector<HTMLElement>("[data-layer-row-surface]");
        if (!surface) continue;
        if (dismissed !== null && row.dataset.layerId === dismissed) {
          // The highlight is a class of the runtime row, so it is covered rather than removed (the rule in mo-layers-scroll.ts, which still lets
          // the hover fill show).
          if (row.dataset.selected !== "false") row.dataset.selected = "false";
          if (row.getAttribute("aria-selected") !== "false") row.setAttribute("aria-selected", "false");
          row.dataset.deselected = "";
          if (surface.style.backgroundColor === "transparent") surface.style.removeProperty("background-color");
        } else if ("deselected" in row.dataset) {
          surface.style.removeProperty("background-color");
          delete row.dataset.deselected;
        }
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributeFilter: ["data-selected"], attributes: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, [dismissed, selectedLayerId]);
}

// Target of the hidden flag that shows the Modifier file upload while the edited layer holds images.
export const LAYER_FILES_TARGET = "modifier.layerFiles";

export function useLayerFilesFlag(activeLayerId: string | null): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const spec = getActiveAnimation(values);
  const holdsFiles = spec !== null && activeLayerId !== null && getLayerImageAssets(spec, activeLayerId).length > 0;
  const current = values[LAYER_FILES_TARGET] === true;
  React.useEffect(() => {
    if (current === holdsFiles) return;
    dispatch({ history: "skip", label: "Layer files", target: LAYER_FILES_TARGET, type: "controls.setValue", value: holdsFiles });
  }, [current, dispatch, holdsFiles]);
}

// Target of the hidden flag that shows the Modifier Layer section while a layer is selected.
export const LAYER_ACTIVE_TARGET = "modifier.layerActive";

export function useLayerActiveFlag(activeLayerId: string | null): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const active = activeLayerId !== null && layers.some((layer) => layer.id === activeLayerId);
  const current = values[LAYER_ACTIVE_TARGET] === true;
  React.useEffect(() => {
    if (current === active) return;
    dispatch({ history: "skip", label: "Layer selected", target: LAYER_ACTIVE_TARGET, type: "controls.setValue", value: active });
  }, [active, current, dispatch]);
}

// The framework's Background switch (Settings) and the BG Setting mode are one setting: the runtime
// draws or skips the background fill by that switch, and Transparent means it is off.
export function useBackgroundModeSync(): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const mode = values["bg.mode"];
  const include = mode !== "transparent";
  const current = values["export.includeBackground"] !== false;
  React.useEffect(() => {
    if (current === include) return;
    dispatch({ history: "skip", label: "Background", target: "export.includeBackground", type: "controls.setValue", value: include });
  }, [current, dispatch, include]);
}

// The Timeline switch in Settings starts on. It is turned on once per workspace (remembered in a
// hidden value), so switching it off afterwards sticks.
export function useTimelineDefault(): void {
  const dispatch = useToolcraftDispatch();
  const defaulted = useToolcraftSelector((state) => state.values["app.timelineDefaulted"] === true);
  React.useEffect(() => {
    if (defaulted) return;
    dispatch({ history: "skip", label: "Timeline", target: "panels.timeline.extended", type: "controls.setValue", value: true });
    dispatch({ history: "skip", label: "Timeline", target: "app.timelineDefaulted", type: "controls.setValue", value: true });
  }, [defaulted, dispatch]);
}

// The artboard's name (Modifier > Artboard > Name) and the main layer (the first top-level group) are one name: renaming either
// renames the other. When a project opens, the main layer's name wins.
export function useArtboardNameSync(): void {
  const dispatch = useToolcraftDispatch();
  const layers = useToolcraftSelector((state) => state.layers);
  const stored = useToolcraftSelector((state) => state.values["artboard.name"]);
  const artboard = typeof stored === "string" ? stored : "";
  const main = layers.find((layer) => layer.kind === "group" && !layer.parentGroupId);
  const mainId = main?.id ?? null;
  const mainName = main ? (main.displayName ?? main.name ?? "").trim() : "";
  const seen = React.useRef<{ artboard: string; id: string | null; main: string }>({ artboard: "", id: null, main: "" });
  React.useEffect(() => {
    const before = seen.current;
    if (mainId === null || !mainName) return;
    const sameLayer = before.id === mainId;
    seen.current = { artboard, id: mainId, main: mainName };
    if (sameLayer && artboard !== before.artboard && artboard.trim() && artboard.trim() !== mainName) {
      seen.current = { artboard, id: mainId, main: artboard.trim() };
      dispatch({ layerId: mainId, name: artboard.trim(), type: "layers.rename" });
    } else if (artboard !== mainName) {
      seen.current = { artboard: mainName, id: mainId, main: mainName };
      dispatch({ history: "skip", label: "Artboard name", target: "artboard.name", type: "controls.setValue", value: mainName });
    }
  }, [artboard, dispatch, mainId, mainName]);
}
