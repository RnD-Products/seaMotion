import type * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, FieldDescription, Segmented, Slider, Switch, Vector } from "@/toolcraft/ui";

import { useActiveLayerId } from "../mo/mo-layer-selection";
import { ANIMATION_PARAMS_TARGET, getActiveAnimation, resolveParams } from "./animation-spec";
import styles from "./animation-controls.module.css";
import { DEFAULT_FRAME_PERSPECTIVE, type FramePerspective } from "./frame-transform";
import { LAYER_PERSPECTIVE_KEY, TOOL_PERSPECTIVE_TARGET, readLayerPerspectives } from "./layer-perspective";
import { selectPerspectiveCorner, useSelectedPerspectiveCorner } from "./perspective-selection";

const PIN_OPTIONS = [
  { label: "TL", value: "topLeft" },
  { label: "TR", value: "topRight" },
  { label: "BR", value: "bottomRight" },
  { label: "BL", value: "bottomLeft" },
] as const;

// Perspective for the layer (or group) selected in the Layers tab, with the same settings as the frame's perspective:
// Perspective pins, Reset pins, Select pin, Move selected pin and the precise sliders.
export function LayerPerspectiveControl({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  const activeLayerId = useActiveLayerId(state.selectedLayerId);
  const layer = state.layers.find((item) => item.id === activeLayerId);
  const corner = useSelectedPerspectiveCorner();
  const close = (): void => dispatch({ label: "Perspective", target: TOOL_PERSPECTIVE_TARGET, type: "controls.setValue", value: false });
  if (!spec || !layer) {
    return (
      <div className={styles.root}>
        <FieldDescription>Select a layer or a group in the Layers tab to give it perspective.</FieldDescription>
        <Button onClick={close} size="sm" type="button" variant="ghost">
          Close
        </Button>
      </div>
    );
  }
  const params = resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]);
  const perspective: FramePerspective = readLayerPerspectives(params)[layer.id] ?? DEFAULT_FRAME_PERSPECTIVE;
  const point = perspective.points[corner];
  const write = (next: FramePerspective, historyGroup?: string): void => {
    const rest = { ...((params[LAYER_PERSPECTIVE_KEY] ?? {}) as Record<string, unknown>), [layer.id]: next };
    dispatch({ historyGroup, label: "Layer perspective", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [LAYER_PERSPECTIVE_KEY]: rest } });
  };
  const move = (next: Readonly<{ x: number; y: number }>, historyGroup?: string): void =>
    write({ ...perspective, enabled: true, points: { ...perspective.points, [corner]: next } }, historyGroup);
  return (
    <div className={styles.root}>
      <FieldDescription>{layer.displayName ?? layer.name}: a group moves all its layers together.</FieldDescription>
      <div className={styles.pair}>
        <Switch checked={perspective.enabled} name="Perspective pins" onCheckedChange={(enabled) => write({ ...perspective, enabled })} />
        {perspective.enabled ? (
          <Button onClick={() => write({ ...DEFAULT_FRAME_PERSPECTIVE, enabled: true })} size="sm" type="button" variant="outline">
            Reset pins
          </Button>
        ) : null}
      </div>
      {perspective.enabled ? (
        <>
          <Segmented name="Select pin" onValueChange={(next) => selectPerspectiveCorner(next as (typeof PIN_OPTIONS)[number]["value"])} options={PIN_OPTIONS} value={corner} />
          <Vector
            defaultValue={{ x: "0", y: "0" }}
            name="Move selected pin"
            onValueChange={(next, meta) => {
              const x = Number.parseFloat(next.x);
              const y = Number.parseFloat(next.y);
              move(
                {
                  x: Number.isFinite(x) ? Math.min(0.5, Math.max(-0.5, x / 2)) : point.x,
                  y: Number.isFinite(y) ? Math.min(0.5, Math.max(-0.5, y / 2)) : point.y,
                },
                meta?.historyGroup,
              );
            }}
            padCoordinateMode="screen"
            padShape="square"
            x={(point.x * 2).toFixed(3)}
            xLabel="X"
            y={(point.y * 2).toFixed(3)}
            yLabel="Y"
          />
          <Slider max={0.5} min={-0.5} name="Precise X" onValueChange={(x, meta) => move({ ...point, x }, meta?.historyGroup)} showFill={false} step={0.0005} value={point.x} valueLabel={point.x.toFixed(4)} />
          <Slider max={0.5} min={-0.5} name="Precise Y" onValueChange={(y, meta) => move({ ...point, y }, meta?.historyGroup)} showFill={false} step={0.0005} value={point.y} valueLabel={point.y.toFixed(4)} />
        </>
      ) : null}
      <Button onClick={close} size="sm" type="button" variant="ghost">
        Done
      </Button>
    </div>
  );
}
