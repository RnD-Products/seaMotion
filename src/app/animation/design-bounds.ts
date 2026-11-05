import * as React from "react";
import { useToolcraftSelector } from "@/toolcraft/runtime/react";

import type { AnimationSandbox, DesignBounds } from "./animation-sandbox";
import { ANIMATION_PARAMS_TARGET, getActiveAnimation, getRenderSize, resolveParams, type AnimationSpec } from "./animation-spec";
import { getFrameSizePreset, readFrameTransform, type FrameTransform } from "./frame-transform";
import { getProbeSandbox, useProbeSandboxVersion } from "./layer-texts";

const MEASURE_SCALE = 1;

// The layer whose area is the frame. The Card layer is removed from the Layers panel; the frame
// takes over its fill, radius and stroke, so its area is still measured from the script's own card.
export const FRAME_LAYER_ID = "design-card";

// Measures the frame's box: the Card layer's area when the design has one, otherwise everything it draws.
export function measureFrameBounds(
  sandbox: AnimationSandbox,
  spec: AnimationSpec,
  options: Readonly<{ canvas: Readonly<{ height: number; width: number }>; durationSeconds: number; params: unknown }>,
): Promise<DesignBounds | null> {
  const drawSize = getRenderSize(spec, options.canvas);
  const layerStack = spec.layers.some((layer) => layer.id === FRAME_LAYER_ID) ? [FRAME_LAYER_ID] : spec.layers.map((layer) => layer.id);
  return sandbox.measureBounds({
    durationSeconds: options.durationSeconds,
    height: drawSize.height,
    layerStack,
    params: resolveParams(spec, options.params),
    pixelHeight: Math.max(1, Math.ceil(drawSize.height * MEASURE_SCALE)),
    pixelScale: MEASURE_SCALE,
    pixelWidth: Math.max(1, Math.ceil(drawSize.width * MEASURE_SCALE)),
    timeSeconds: 0,
    width: drawSize.width,
  });
}

// The size of the design itself: the box around everything it draws at its first moment, in
// design units. The canvas is only the artboard behind it, so this is what Frame Settings sizes.
// Null until measured or when nothing is drawn.
export function useRawDesignBounds(): DesignBounds | null {
  const values = useToolcraftSelector((state) => state.values);
  const size = useToolcraftSelector((state) => state.canvas.size);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const sandboxId = useProbeSandboxVersion();
  const spec = getActiveAnimation(values);
  const key = spec ? `${spec.id}#${spec.imageAssets.join(",")}` : "";
  const latest = React.useRef({ durationSeconds, params: values[ANIMATION_PARAMS_TARGET], size, spec });
  latest.current = { durationSeconds, params: values[ANIMATION_PARAMS_TARGET], size, spec };
  const [measured, setMeasured] = React.useState<{ bounds: DesignBounds | null; key: string }>({ bounds: null, key: "" });

  React.useEffect(() => {
    const sandbox = getProbeSandbox();
    const { durationSeconds: duration, params, size: canvas, spec: current } = latest.current;
    if (!sandbox || !current) return;
    let cancelled = false;
    measureFrameBounds(sandbox, current, { canvas, durationSeconds: duration, params }).then(
      (bounds) => {
        if (!cancelled) setMeasured({ bounds, key });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [key, sandboxId]);

  return measured.key === key ? measured.bounds : null;
}

export type FrameLayout = Readonly<{ bounds: DesignBounds | null; boxH: number; boxW: number; fit: number; transform: FrameTransform }>;

// Where the frame sits for the artboard's current shape. Whenever the artboard is not the size the
// design was made at, the frame keeps its own shape, is centred, and is scaled up or down so it fits
// the artboard whole, leaving the design's own margin of background around it. It is derived from the artboard every time, so it holds for any way the size changes. The
// stored scale and position are adjustments on top of this fit (100% and 0 mean "as fitted").
export function layoutFrame(
  raw: DesignBounds | null,
  spec: AnimationSpec | null,
  canvas: Readonly<{ height: number; width: number }>,
  stored: FrameTransform,
): FrameLayout {
  const preset = getFrameSizePreset(stored.sizePreset);
  const origin = spec?.size;
  const fitted = Boolean(raw && spec && origin && !(origin.width === canvas.width && origin.height === canvas.height));
  let fit = 1;
  let margin = 0;
  if (raw && spec && fitted) {
    const render = getRenderSize(spec, canvas);
    margin = Math.min(0.12, Math.max(0.03, Math.max(0, render.width - raw.width) / 2 / render.width));
    fit = Math.min((canvas.width * (1 - 2 * margin)) / raw.width, (canvas.height * (1 - 2 * margin)) / raw.height);
  }
  // The frame rectangle can be made wider or taller than the design (Lock ratio off, or a size
  // preset); it grows about its centre and the design stays put. A preset sets the frame's
  // unscaled size in artboard px; the frame Scale then transforms its fill with the design.
  const baseWidth = (raw ? raw.width : canvas.width) * fit;
  const baseHeight = (raw ? raw.height : canvas.height) * fit;
  const clamp = (value: number): number => Math.min(1000, Math.max(5, value));
  const boxW = preset ? clamp((preset.width / baseWidth) * 100) : stored.boxW;
  const boxH = preset ? clamp((preset.height / baseHeight) * 100) : stored.boxH;
  const boxed = (box: DesignBounds | null): DesignBounds | null => {
    if (!box) return null;
    const width = (box.width * boxW) / 100;
    const height = (box.height * boxH) / 100;
    return { height, width, x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2 };
  };
  if (!raw || !spec || !fitted) {
    return { bounds: boxed(raw), boxH, boxW, fit: 1, transform: { ...stored, boxH, boxW } };
  }
  const render = getRenderSize(spec, canvas);
  const k = (fit * stored.scale) / 100;
  return {
    bounds: boxed(raw),
    boxH,
    boxW,
    fit,
    transform: {
      ...stored,
      boxH,
      boxW,
      scale: k * 100,
      x: stored.x - k * (raw.x + raw.width / 2 - render.width / 2),
      y: stored.y - k * (raw.y + raw.height / 2 - render.height / 2),
    },
  };
}

export function useFrameLayout(): FrameLayout {
  const raw = useRawDesignBounds();
  const values = useToolcraftSelector((state) => state.values);
  const size = useToolcraftSelector((state) => state.canvas.size);
  return React.useMemo(() => layoutFrame(raw, getActiveAnimation(values), size, readFrameTransform(values)), [raw, values, size]);
}

// The frame's box as drawn.
export function useDesignBounds(): DesignBounds | null {
  return useFrameLayout().bounds;
}
