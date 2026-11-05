import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { ANIMATION_LIBRARY_TARGET, ANIMATION_PARAMS_TARGET, getActiveAnimation, readAnimationLibrary, resolveParams } from "../animation/animation-spec";
import { copyLayer, duplicateLayer, pasteClip, type ClipMode, type LayerClip, type LayerDuplicate } from "../animation/layer-duplicate";
import { notePickedLayer } from "./mo-layer-selection";

// What the layers' right-click menu does (and Cmd / Ctrl + D): Copy, Duplicate, Paste and Delete. The copied layer lives here, in the page, so it
// can be pasted into the open project or another one.
let clipboard: LayerClip | null = null;
const listeners = new Set<() => void>();

function setClipboard(next: LayerClip | null): void {
  clipboard = next;
  for (const listener of listeners) listener();
}

export function useHasCopiedLayer(): boolean {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => clipboard !== null,
    () => false,
  );
}

export type LayerActions = Readonly<{
  copy: (id: string, mode?: ClipMode) => void;
  duplicate: (id: string) => boolean;
  paste: (id: string) => boolean;
  remove: (id: string) => void;
}>;

export function useLayerActions(): LayerActions {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const live = React.useRef({ dispatch, layers, values });
  live.current = { dispatch, layers, values };

  return React.useMemo((): LayerActions => {
    const apply = (made: LayerDuplicate, label: string): void => {
      const { dispatch: send, values: now } = live.current;
      const library = readAnimationLibrary(now[ANIMATION_LIBRARY_TARGET]);
      send({ label, target: ANIMATION_LIBRARY_TARGET, type: "controls.setValue", value: { items: { ...library.items, [made.spec.id]: made.spec } } });
      if (made.params) send({ label: `${label} settings`, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: made.params });
      for (const add of made.adds) send({ insertIndex: add.index, layer: add.draft, type: "layers.add" });
      notePickedLayer();
      send({ layerId: made.rootId, type: "layers.select" });
    };
    return {
      copy: (id, mode = "layer") => {
        const { layers: list, values: now } = live.current;
        const spec = getActiveAnimation(now);
        if (!spec) return;
        setClipboard(copyLayer(spec, list, id, resolveParams(spec, now[ANIMATION_PARAMS_TARGET]), mode));
      },
      duplicate: (id) => {
        const { layers: list, values: now } = live.current;
        const spec = getActiveAnimation(now);
        if (!spec) return false;
        const made = duplicateLayer(spec, list, id, resolveParams(spec, now[ANIMATION_PARAMS_TARGET]));
        if (!made) return false;
        apply(made, "Duplicate layer");
        return true;
      },
      paste: (id) => {
        const { layers: list, values: now } = live.current;
        const spec = getActiveAnimation(now);
        const target = list.findIndex((layer) => layer.id === id);
        if (!spec || !clipboard || target < 0) return false;
        const at = list[target]?.parentGroupId;
        const made = pasteClip(spec, list, clipboard, resolveParams(spec, now[ANIMATION_PARAMS_TARGET]), { index: target, ...(at ? { parentGroupId: at } : {}) }, "");
        if (!made) return false;
        apply(made, "Paste layer");
        return true;
      },
      remove: (id) => {
        live.current.dispatch({ layerId: id, type: "layers.delete" });
      },
    };
  }, []);
}

// Cmd / Ctrl + D with a layer selected in the Layers panel: the layer (a group with everything in it) is copied right above itself and the copy
// is selected. Bars picked in the timeline come first (the timeline copies those).
export function useLayerDuplicate(activeLayerId: string | null, duplicate: (id: string) => boolean): void {
  const live = React.useRef({ activeLayerId, duplicate });
  live.current = { activeLayerId, duplicate };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "d") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="textbox"]'))) return;
      if (document.documentElement.dataset.moTimelineSelection) return;
      const { activeLayerId: id, duplicate: run } = live.current;
      if (!id) return;
      if (run(id)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
