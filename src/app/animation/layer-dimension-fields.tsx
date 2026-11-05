import * as React from "react";

import { ANIMATION_PARAMS_TARGET, type AnimationSpec } from "./animation-spec";
import { SliderPair } from "./position-field";
import { LAYER_SIZE_KEY, NO_SIZE, isUnscaled, readLayerSizes } from "./layer-size";
import { currentBox, readGrows, readMoves, readPlaced, withBoxes } from "./layer-geometry";

// Width and Height of a drawn layer (a picture, shape, text or vector of a pasted design), in artboard pixels. Editing one stretches the layer from its
// top-left corner, the same stretch the artboard's corner handles make (kept as params.__grow), so the two always agree. A group has its own size editor.
export function LayerDimensionFields({
  area,
  dispatch,
  layerId,
  params,
  spec,
}: Readonly<{
  area: Readonly<{ height: number; width: number }>;
  dispatch: (command: Record<string, unknown>) => void;
  layerId: string;
  params: Readonly<Record<string, unknown>>;
  spec: AnimationSpec;
}>): React.JSX.Element | null {
  const placed = React.useMemo(() => readPlaced(spec, area), [spec, area]);
  const base = placed.get(layerId);
  if (!base) return null;
  const box = currentBox(base, readMoves(params), readGrows(params));
  const own = readLayerSizes(params)[layerId] ?? NO_SIZE;
  const write = (next: { h: number; w: number }, historyGroup?: string): void =>
    dispatch({ historyGroup, label: "Layer size", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: withBoxes(params, placed, new Map([[layerId, { ...box, ...next }]])) });
  const clamp = (value: number): number => Math.min(10000, Math.max(1, value));
  // Lock ratio: the other side follows, keeping the shape the layer has now.
  const ratio = box.h / box.w;
  const toggleLock = (): void => {
    const next = { ...own, lock: !own.lock };
    const map = { ...((params[LAYER_SIZE_KEY] ?? {}) as Record<string, unknown>) };
    if (isUnscaled(next) && next.lock) delete map[layerId];
    else map[layerId] = next;
    const { [LAYER_SIZE_KEY]: _old, ...others } = params;
    dispatch({ label: "Lock ratio", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: Object.keys(map).length > 0 ? { ...others, [LAYER_SIZE_KEY]: map } : others });
  };
  return (
    <SliderPair
      first={{ label: "Width", onChange: (value, historyGroup) => write({ h: own.lock ? clamp(value * ratio) : box.h, w: clamp(value) }, historyGroup), value: box.w }}
      lock={{ locked: own.lock, onToggle: toggleLock }}
      max={4000}
      min={1}
      second={{ label: "Height", onChange: (value, historyGroup) => write({ h: clamp(value), w: own.lock ? clamp(value / ratio) : box.w }, historyGroup), value: box.h }}
    />
  );
}

// The turn of a layer, in degrees about the middle of its box. Kept with the layer's size setting (`__layerSize`), which the drawing applies to any
// layer, so it works for pictures, shapes, text and vectors alike.
export function LayerRotationField({
  dispatch,
  layerId,
  params,
}: Readonly<{ dispatch: (command: Record<string, unknown>) => void; layerId: string; params: Readonly<Record<string, unknown>> }>): React.JSX.Element {
  const size = readLayerSizes(params)[layerId] ?? NO_SIZE;
  const write = (rot: number, historyGroup?: string): void => {
    const next = { ...size, rot };
    const map = { ...((params[LAYER_SIZE_KEY] ?? {}) as Record<string, unknown>) };
    if (isUnscaled(next) && next.lock) delete map[layerId];
    else map[layerId] = next;
    const { [LAYER_SIZE_KEY]: _old, ...others } = params;
    dispatch({ historyGroup, label: "Layer rotation", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: Object.keys(map).length > 0 ? { ...others, [LAYER_SIZE_KEY]: map } : others });
  };
  return <SliderPair first={{ label: "Rotation", onChange: (value, historyGroup) => write(Math.max(-180, Math.min(180, value)), historyGroup), value: size.rot }} max={180} min={-180} unit="°" />;
}
