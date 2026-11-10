import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { ANIMATION_PARAMS_TARGET, getActiveAnimation } from "../animation/animation-spec";
import { LOCK_KEY, lockedLayers, readLocked, withLock } from "../animation/layer-lock";
import { newPlanId, planAnimationRange, readInteractionPlan, type PlanAnimation } from "../animation/interaction-plan";
import { floatRoom } from "../animation/float-room";
import { floatAnimation, FLOAT_PREFIX } from "../animation/motion-presets";
import { resolveProjectScenes } from "../animation/scenes";

// What the layer menu adds to Copy, Duplicate, Paste and Delete: layer structure (group, rename, lock, hide), stacking order, and motion
// (the preset, copy and paste of a layer's motion, trimming at the playhead, clearing). Motion is the layer's animations in the Motion Plan.
const MIN_SECONDS = 0.05;

// The motion copied from a layer; it lives in the page, so it can be pasted onto any layer of this or another project.
let motionClip: readonly PlanAnimation[] = [];

type Layer = Readonly<{ displayName?: string; id: string; kind?: string; name: string; parentGroupId?: string; visible: boolean }>;

// A layer and everything inside it.
function subtree(layers: readonly Layer[], id: string): Layer[] {
  const start = layers.findIndex((layer) => layer.id === id);
  if (start < 0) return [];
  const inside = new Set([id]);
  const out: Layer[] = [layers[start] as Layer];
  for (let index = start + 1; index < layers.length; index += 1) {
    const layer = layers[index] as Layer;
    if (!layer.parentGroupId || !inside.has(layer.parentGroupId)) break;
    inside.add(layer.id);
    out.push(layer);
  }
  return out;
}

export type LayerMenuActions = Readonly<{
  applyFloating: (id: string) => void;
  clearMotion: (id: string) => void;
  copyMotion: (id: string) => void;
  frameOf: (id: string) => { id: string; name: string } | undefined;
  group: (id: string, name?: string) => void;
  groupTargets: (id: string) => { id: string; name: string }[];
  hasMotion: (id: string) => boolean;
  hasMotionClip: () => boolean;
  isGroup: (id: string) => boolean;
  isHidden: (id: string) => boolean;
  isLocked: (id: string) => boolean;
  isLottie: () => boolean;
  moveInto: (id: string, groupId: string) => void;
  pasteMotion: (id: string) => void;
  rename: (id: string) => void;
  toBack: (id: string) => void;
  toFront: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleVisible: (id: string) => void;
  trimEnd: (id: string) => void;
  trimStart: (id: string) => void;
  ungroup: (id: string) => void;
}>;

export function useLayerMenuActions(): LayerMenuActions {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers) as readonly Layer[];
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  // The playhead while paused; not followed during playback, so the menu does not redraw every frame.
  const timeSeconds = useToolcraftSelector((state) => (state.timeline.isPlaying ? 0 : state.timeline.currentTimeSeconds));
  const live = React.useRef({ dispatch, durationSeconds, layers, timeSeconds, values });
  live.current = { dispatch, durationSeconds, layers, timeSeconds, values };

  return React.useMemo((): LayerMenuActions => {
    const params = (): Record<string, unknown> => {
      const raw = live.current.values[ANIMATION_PARAMS_TARGET];
      return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
    };
    const writeParams = (next: Record<string, unknown>, label: string): void =>
      live.current.dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: next });
    const writeAnimations = (animations: readonly PlanAnimation[], label: string): void => {
      const current = params();
      writeParams({ ...current, plan: { ...readInteractionPlan(current), animations } }, label);
    };
    const plan = () => readInteractionPlan(params());
    const layerOf = (id: string): Layer | undefined => live.current.layers.find((layer) => layer.id === id);
    // The playhead in the shown scene's own time (a plan runs from the start of its scene).
    const sceneTime = (): number => {
      const scenes = resolveProjectScenes(live.current.values, live.current.durationSeconds);
      const shown = scenes.items[scenes.activeIndex];
      return Math.max(0, live.current.timeSeconds - (shown?.start ?? 0));
    };
    const ownAnimations = (id: string): PlanAnimation[] => plan().animations.filter((animation) => animation.layer === id);
    const spec = (): ReturnType<typeof getActiveAnimation> => getActiveAnimation(live.current.values);

    const reorder = (id: string, toFront: boolean): void => {
      const all = live.current.layers;
      const block = subtree(all, id);
      const first = block[0];
      if (!first) return;
      const ids = new Set(block.map((layer) => layer.id));
      const rest = all.filter((layer) => !ids.has(layer.id));
      const siblings = rest.map((layer, index) => ({ index, layer })).filter((entry) => (entry.layer.parentGroupId ?? null) === (first.parentGroupId ?? null));
      let at: number;
      if (siblings.length === 0) {
        const parentAt = first.parentGroupId ? rest.findIndex((layer) => layer.id === first.parentGroupId) : -1;
        at = parentAt + 1;
      } else if (toFront) {
        at = (siblings[0] as { index: number }).index;
      } else {
        const last = siblings[siblings.length - 1] as { index: number; layer: Layer };
        at = last.index + subtree(rest, last.layer.id).length;
      }
      const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
      live.current.dispatch({ layers: next as never, selectedLayerId: id, type: "layers.reorder" });
    };

    return {
      applyFloating: (id) => {
        const layer = layerOf(id);
        const design = spec();
        if (!layer || !design) return;
        const scenes = resolveProjectScenes(live.current.values, live.current.durationSeconds);
        const shown = scenes.items[scenes.activeIndex];
        const scene = shown ? Math.max(0.1, shown.end - shown.start) : live.current.durationSeconds;
        const size = design.size ? Math.min(design.size.width, design.size.height) : 330;
        const others = plan().animations.filter((animation) => !(animation.layer === id && animation.id.startsWith(`${FLOAT_PREFIX}-`)));
        writeAnimations([...others, floatAnimation({ id, name: layer.displayName ?? layer.name }, scene, size, design.size ? floatRoom(design, live.current.layers, params(), id, design.size) : null)], "Floating preset");
      },
      clearMotion: (id) => writeAnimations(plan().animations.filter((animation) => animation.layer !== id), "Clear motion"),
      copyMotion: (id) => {
        motionClip = ownAnimations(id);
      },
      group: (id, name = "Group") => {
        const layer = layerOf(id);
        if (!layer) return;
        const groupId = `grp-${Date.now().toString(36)}`;
        const at = live.current.layers.findIndex((item) => item.id === id);
        live.current.dispatch({
          insertIndex: at,
          layer: { id: groupId, kind: "group", name, visible: true, ...(layer.parentGroupId ? { parentGroupId: layer.parentGroupId } : {}) },
          type: "layers.add",
        });
        live.current.dispatch({ layerIds: [id], parentGroupId: groupId, type: "layers.moveToGroup" });
        live.current.dispatch({ layerId: groupId, type: "layers.select" });
      },
      // The artboard (main layer), when the layer is not already directly inside it.
      frameOf: (id) => {
        const main = live.current.layers.find((layer) => layer.kind === "group" && !layer.parentGroupId);
        const layer = layerOf(id);
        if (!main || !layer || main.id === id || layer.parentGroupId === main.id) return undefined;
        return { id: main.id, name: main.displayName ?? main.name };
      },
      // The other groups this layer can move into: not the artboard, itself, its own contents, or the group it is already in.
      groupTargets: (id) => {
        const layer = layerOf(id);
        if (!layer) return [];
        const main = live.current.layers.find((item) => item.kind === "group" && !item.parentGroupId);
        const own = new Set(subtree(live.current.layers, id).map((item) => item.id));
        return live.current.layers
          .filter((item) => item.kind === "group" && item.id !== main?.id && !own.has(item.id) && item.id !== layer.parentGroupId)
          .map((item) => ({ id: item.id, name: item.displayName ?? item.name }));
      },
      moveInto: (id, groupId) => {
        live.current.dispatch({ layerIds: [id], parentGroupId: groupId, type: "layers.moveToGroup" });
        live.current.dispatch({ layerId: id, type: "layers.select" });
      },
      hasMotion: (id) => ownAnimations(id).length > 0,
      hasMotionClip: () => motionClip.length > 0,
      isGroup: (id) => layerOf(id)?.kind === "group",
      isHidden: (id) => layerOf(id)?.visible === false,
      isLocked: (id) => lockedLayers(live.current.layers, readLocked(params())).has(id),
      isLottie: () => Boolean(spec()?.lottie),
      pasteMotion: (id) => {
        const layer = layerOf(id);
        if (!layer || motionClip.length === 0) return;
        const copies = motionClip.map((animation) => ({ ...animation, id: newPlanId(`paste-${id}`), layer: id }));
        writeAnimations([...plan().animations, ...copies], "Paste motion");
      },
      rename: (id) => {
        const name = layerOf(id);
        if (!name) return;
        const label = name.displayName ?? name.name;
        window.dispatchEvent(new Event("mo-show-layers"));
        window.setTimeout(() => {
          const row = document.querySelector(`[data-layer-id="${id}"]`);
          const text = row ? [...row.querySelectorAll("*")].find((element) => element.children.length === 0 && element.textContent?.trim() === label) : null;
          text?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        }, 160);
      },
      toBack: (id) => reorder(id, false),
      toFront: (id) => reorder(id, true),
      toggleLock: (id) => {
        const current = params();
        const locked = readLocked(current)[id] === true;
        writeParams({ ...current, [LOCK_KEY]: withLock(readLocked(current), id, !locked) }, locked ? "Unlock layer" : "Lock layer");
      },
      toggleVisible: (id) => live.current.dispatch({ layerId: id, type: "layers.toggleVisibility" }),
      // The end of the layer's animations is the playhead; their start stays.
      trimEnd: (id) => {
        const t = sceneTime();
        const current = plan();
        writeAnimations(
          current.animations.map((animation) => {
            if (animation.layer !== id) return animation;
            const [start] = planAnimationRange(current, animation);
            return { ...animation, duration: Math.max(MIN_SECONDS, Math.round((t - start) * 1000) / 1000) };
          }),
          "End at playhead",
        );
      },
      // The start of the layer's animations is the playhead; their end stays.
      trimStart: (id) => {
        const t = sceneTime();
        const current = plan();
        writeAnimations(
          current.animations.map((animation) => {
            if (animation.layer !== id) return animation;
            const [start, end] = planAnimationRange(current, animation);
            const duration = Math.max(MIN_SECONDS, Math.round((end - t) * 1000) / 1000);
            return { ...animation, delay: Math.max(0, Math.round((animation.delay + (t - start)) * 1000) / 1000), duration };
          }),
          "Start at playhead",
        );
      },
      ungroup: (id) => {
        const group = layerOf(id);
        if (!group || group.kind !== "group") return;
        const children = live.current.layers.filter((layer) => layer.parentGroupId === id).map((layer) => layer.id);
        if (children.length > 0) live.current.dispatch({ layerIds: children, parentGroupId: group.parentGroupId ?? null, type: "layers.moveToGroup" });
        live.current.dispatch({ layerId: id, type: "layers.delete" });
      },
    };
    // The actions read the latest state when they run.
  }, []);
}
