import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import type { AnimationSandbox, SandboxFrame } from "./animation-sandbox";
import { getActiveAnimation, getRenderSize, resolveParams, ANIMATION_PARAMS_TARGET } from "./animation-spec";
import { findFigmaItem } from "../mo/figma-paste-import";

// The texts a layer draws are found by drawing that layer alone at a few moments and noting every
// string the script passes to fillText. That works for any animation, whatever its code looks like.
const PROBE_FRACTIONS = [0, 0.25, 0.5, 0.75, 0.95];
const PROBE_SCALE = 0.25;
const LETTERS = /\p{L}{2}/u;

// Target of the hidden flag that shows the Modifier Text section while the edited layer draws text.
export const LAYER_TEXT_FLAG_TARGET = "modifier.layerHasText";

let sandbox: AnimationSandbox | null = null;
let sandboxVersion = 0;
let probed: Readonly<{ layerId: string; texts: readonly string[] }> | null = null;
const listeners = new Set<() => void>();
const emit = (): void => {
  for (const listener of listeners) listener();
};

export function getProbeSandbox(): AnimationSandbox | null {
  return sandbox;
}

export function useProbeSandboxVersion(): number {
  return React.useSyncExternalStore(subscribe, () => sandboxVersion);
}

export function setProbeSandbox(next: AnimationSandbox | null): void {
  sandbox = next;
  sandboxVersion += 1;
  probed = null;
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// The editable texts of the layer, in drawing order.
export function useProbedTexts(layerId: string | null): readonly string[] {
  const current = React.useSyncExternalStore(subscribe, () => probed);
  return layerId !== null && current?.layerId === layerId ? current.texts : [];
}

// Probes the edited layer and keeps the Text section's flag in step with the result.
export function useLayerTextsFlag(layerId: string | null): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const size = useToolcraftSelector((state) => state.canvas.size);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const spec = getActiveAnimation(values);
  const key = spec ? `${spec.id}#${spec.imageAssets.join(",")}` : "";
  const latest = React.useRef({ durationSeconds, params: values[ANIMATION_PARAMS_TARGET], size, spec });
  latest.current = { durationSeconds, params: values[ANIMATION_PARAMS_TARGET], size, spec };
  const [hasText, setHasText] = React.useState(false);
  // Re-probe when the sandbox is replaced.
  const sandboxId = React.useSyncExternalStore(subscribe, () => sandboxVersion);

  React.useEffect(() => {
    const { spec: current } = latest.current;
    // A pasted Figma text is edited in the Layer section, not here.
    if (!sandbox || !current || layerId === null || findFigmaItem(current, layerId)?.kind === "text") {
      probed = null;
      setHasText(false);
      emit();
      return;
    }
    let cancelled = false;
    const { durationSeconds: duration, params, size: canvasSize } = latest.current;
    const drawSize = getRenderSize(current, canvasSize);
    const frame: SandboxFrame = {
      durationSeconds: duration,
      height: drawSize.height,
      layerStack: [layerId],
      params: resolveParams(current, params),
      pixelHeight: Math.max(1, Math.ceil(drawSize.height * PROBE_SCALE)),
      pixelScale: PROBE_SCALE,
      pixelWidth: Math.max(1, Math.ceil(drawSize.width * PROBE_SCALE)),
      timeSeconds: 0,
      width: drawSize.width,
    };
    sandbox
      .probeTexts(frame, PROBE_FRACTIONS.map((fraction) => fraction * duration))
      .then((found) => {
        if (cancelled) return;
        const texts = [...new Set(found.map((text) => text.trim()).filter((text) => LETTERS.test(text) && text.length <= 200))];
        probed = { layerId, texts };
        setHasText(texts.length > 0);
        emit();
      })
      .catch(() => {
        if (!cancelled) setHasText(false);
      });
    return () => {
      cancelled = true;
    };
    // The probe depends on which layer and animation are open, not on every control value.
  }, [layerId, key, sandboxId]);

  const flagged = values[LAYER_TEXT_FLAG_TARGET] === true;
  React.useEffect(() => {
    if (flagged === hasText) return;
    dispatch({ history: "skip", label: "Layer text", target: LAYER_TEXT_FLAG_TARGET, type: "controls.setValue", value: hasText });
  }, [dispatch, flagged, hasText]);
}
