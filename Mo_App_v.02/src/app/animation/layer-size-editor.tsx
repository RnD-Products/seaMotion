import * as React from "react";
import { Slider } from "@/toolcraft/ui";

import { ANIMATION_PARAMS_TARGET, type AnimationSpec } from "./animation-spec";
import styles from "./animation-controls.module.css";
import { naturalGroupBox as naturalBox, type LayerLike } from "./group-box";
import { PositionPair, SliderPair } from "./position-field";
import { LAYER_SIZE_KEY, NO_SIZE, isUnscaled, readLayerSizes, type LayerSize } from "./layer-size";

// A group's size and place: Width and Height in px, Position X / Y, Lock ratio (Width and Height then move together), Scale in percent and Rotation.
export function LayerSizeEditor({
  dispatch,
  groupId,
  layers,
  params,
  spec,
}: Readonly<{
  dispatch: (command: Record<string, unknown>) => void;
  groupId: string;
  layers: readonly LayerLike[];
  params: Readonly<Record<string, unknown>>;
  spec: AnimationSpec;
}>): React.JSX.Element {
  const size: LayerSize = readLayerSizes(params)[groupId] ?? NO_SIZE;
  const natural = React.useMemo(() => naturalBox(spec, layers, groupId, params), [spec, layers, groupId, params]);
  // Position is where the group sits inside its parent group (or in the design, for a top-level group): its own place in the
  // design plus the move set here, measured from the parent's top-left corner. The stored value stays the move itself.
  const parentId = layers.find((item) => item.id === groupId)?.parentGroupId;
  const parent = React.useMemo(() => (parentId ? naturalBox(spec, layers, parentId, params) : null), [spec, layers, parentId, params]);
  const baseX = natural ? natural.x - (parent?.x ?? 0) : 0;
  const baseY = natural ? natural.y - (parent?.y ?? 0) : 0;
  const write = (next: LayerSize, historyGroup?: string): void => {
    const map = { ...((params[LAYER_SIZE_KEY] ?? {}) as Record<string, unknown>) };
    if (isUnscaled(next) && next.lock) delete map[groupId];
    else map[groupId] = next;
    const { [LAYER_SIZE_KEY]: _old, ...others } = params;
    dispatch({ historyGroup, label: "Group size", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: Object.keys(map).length > 0 ? { ...others, [LAYER_SIZE_KEY]: map } : others });
  };
  const scale = Math.round((size.sx + size.sy) / 2);
  const clamp = (value: number): number => Math.min(2000, Math.max(1, value));
  return (
    <>
      {natural ? (
        <SliderPair
          lock={{ locked: size.lock, onToggle: () => write(size.lock ? { ...size, lock: false } : { ...size, lock: true, sy: size.sx }) }}
          first={{
            label: "Width",
            onChange: (value, historyGroup) => {
              const sx = clamp((value / natural.w) * 100);
              write({ ...size, sx, sy: size.lock ? sx : size.sy }, historyGroup);
            },
            value: natural.w * (size.sx / 100),
          }}
          max={4000}
          min={1}
          second={{
            label: "Height",
            onChange: (value, historyGroup) => {
              const sy = clamp((value / natural.h) * 100);
              write({ ...size, sx: size.lock ? sy : size.sx, sy }, historyGroup);
            },
            value: natural.h * (size.sy / 100),
          }}
        />
      ) : null}
      <PositionPair onXChange={(value, historyGroup) => write({ ...size, x: value - Math.round(baseX) }, historyGroup)} onYChange={(value, historyGroup) => write({ ...size, y: value - Math.round(baseY) }, historyGroup)} x={Math.round(baseX) + size.x} y={Math.round(baseY) + size.y} />
      <Slider max={400} min={10} name="Scale" onValueChange={(value, meta) => write({ ...size, sx: clamp(value), sy: clamp(value) }, meta?.historyGroup)} step={1} unit="%" value={scale} />
      <SliderPair first={{ label: "Rotation", onChange: (value, historyGroup) => write({ ...size, rot: Math.max(-180, Math.min(180, value)) }, historyGroup), value: size.rot }} max={180} min={-180} unit="°" />
    </>
  );
}
