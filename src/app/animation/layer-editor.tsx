import type * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { FieldDescription, Select, Slider } from "@/toolcraft/ui";

import { useActiveLayerId } from "../mo/mo-layer-selection";
import { ANIMATION_PARAMS_TARGET, LAYER_STYLE_KEY, type LayerStyle, getActiveAnimation, getControlLayerId, getRenderSize, resolveParams } from "./animation-spec";
import styles from "./animation-controls.module.css";
import { ControlList } from "./control-list";
import { findFigmaItem, frameDefaultStyle } from "../mo/figma-paste-import";
import { FigmaLayerSettings, FrameSettings } from "../mo/figma-layer-settings";
import { ClipSettings } from "../mo/clip-settings";
import { GroupStyleEditor } from "./group-style-editor";
import { LayerAlignRow } from "./layer-align-row";
import { LayerDimensionFields } from "./layer-dimension-fields";
import { LayerSizeEditor } from "./layer-size-editor";

// Editors for the layer selected in the Layers tab. Its controls are the animation's own, picked
// by layer (see getControlLayerId); values live with the animation's, so they travel in project
// files and versions like every other design setting.
const BLENDS = [
  ["design", "As designed"],
  ["source-over", "Normal"],
  ["multiply", "Multiply"],
  ["screen", "Screen"],
  ["overlay", "Overlay"],
  ["soft-light", "Soft light"],
  ["hard-light", "Hard light"],
  ["color-dodge", "Color dodge"],
  ["color-burn", "Color burn"],
  ["darken", "Darken"],
  ["lighten", "Lighten"],
  ["difference", "Difference"],
  ["exclusion", "Exclusion"],
  ["lighter", "Plus lighter"],
] as const;

export function LayerEditor({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  const activeLayerId = useActiveLayerId(state.selectedLayerId);
  const layer = state.layers.find((item) => item.id === activeLayerId);
  if (!spec || !layer) return <FieldDescription>Select a layer in the Layers tab to edit it. Click outside to deselect it.</FieldDescription>;
  // A group has no design controls of its own: its visibility, whether it clips what it holds and the corner radius of that.
  if (layer.kind === "group") {
    const groupParams = resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]);
    // A frame (from Figma) is a group with its own fill, stroke and effects under what it holds, and its own clip and corner radii.
    const frameStyle = frameDefaultStyle(spec, layer.id);
    return (
      <div className={styles.root}>
        <LayerAlignRow area={getRenderSize(spec, state.canvas.size)} dispatch={dispatch as (command: Record<string, unknown>) => void} layerId={layer.id} layers={state.layers} params={groupParams} spec={spec} />
        <LayerSizeEditor dispatch={dispatch as (command: Record<string, unknown>) => void} groupId={layer.id} layers={state.layers} params={groupParams} spec={spec} />
        <GroupStyleEditor dispatch={dispatch as (command: Record<string, unknown>) => void} fallback={frameStyle ?? undefined} groupId={layer.id} params={groupParams} />
        {frameStyle ? <FrameSettings dispatch={dispatch} layerId={layer.id} params={groupParams} projectSeconds={state.timeline.durationSeconds} spec={spec} values={state.values} /> : null}
      </div>
    );
  }
  const section = spec.page?.sections.find((item) => item.id === layer.id);
  const controls = spec.controls.filter((control) => getControlLayerId(spec, control) === layer.id);
  const params = resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]);
  const styleMap = (params[LAYER_STYLE_KEY] ?? {}) as Record<string, LayerStyle>;
  const own = styleMap[layer.id] ?? {};
  // A layer of a pasted Figma design: its text or picture settings.
  const pasted = findFigmaItem(spec, layer.id);
  // A video or GIF layer: how it plays.
  const clip = spec.media?.[layer.id];
  const setStyle = (patch: LayerStyle): void => {
    const next: LayerStyle = { ...own, ...patch };
    const rest = { ...styleMap };
    if ((next.blend ?? "design") === "design" && (next.opacity ?? 100) === 100) delete rest[layer.id];
    else rest[layer.id] = next;
    dispatch({ label: "Layer blend", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [LAYER_STYLE_KEY]: rest } });
  };
  return (
    <div className={styles.root}>
      <LayerAlignRow area={getRenderSize(spec, state.canvas.size)} dispatch={dispatch as (command: Record<string, unknown>) => void} layerId={layer.id} layers={state.layers} params={params} spec={spec} />
      <LayerDimensionFields area={getRenderSize(spec, state.canvas.size)} dispatch={dispatch as (command: Record<string, unknown>) => void} layerId={layer.id} params={params} spec={spec} />
      {spec.page && !section ? (
        <>
          <div className={styles.item}>
            <Select
              name="Blend"
              onValueChange={(value) => setStyle({ blend: value })}
              options={BLENDS.map(([value, label]) => ({ label, value }))}
              value={own.blend ?? "design"}
            />
          </div>
          <div className={styles.item}>
            <Slider max={100} min={0} name="Opacity" onValueChange={(value) => setStyle({ opacity: value })} step={1} value={own.opacity ?? 100} />
          </div>
        </>
      ) : null}
      {clip ? <ClipSettings clipKey={layer.id} dataUrl={spec.assets[clip.asset]} dispatch={dispatch} media={clip} params={params} projectSeconds={state.timeline.durationSeconds} /> : null}
      {pasted ? <FigmaLayerSettings dispatch={dispatch} layerId={layer.id} params={params} projectSeconds={state.timeline.durationSeconds} spec={spec} values={state.values} /> : null}
      {controls.length > 0 ? (
        <ControlList
          controls={controls}
          onChange={(id, next) =>
            dispatch({ label: "Layer setting", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [id]: next } })
          }
          params={params}
        />
      ) : section ? (
        <FieldDescription>
          {`A section of the page: it starts ${section.top.toLocaleString()} px down and is ${section.height.toLocaleString()} px tall. Open it in the Layers tab to edit its parts and texts. Its scrolling is set in the Scroll plan.`}
        </FieldDescription>
      ) : clip || pasted ? null : (
        <FieldDescription>This layer has no design controls.</FieldDescription>
      )}
    </div>
  );
}
