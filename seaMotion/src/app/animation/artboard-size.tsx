import type * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { TextInput } from "@/toolcraft/ui";

import styles from "./animation-controls.module.css";

const WIDTH_TARGET = "canvas.size.width";
const HEIGHT_TARGET = "canvas.size.height";

// The artboard's width and height (the canvas size); the Project info tab no longer shows them.
export function ArtboardSize({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const { height, width } = state.canvas.size;
  const set = (target: string, label: string, raw: string, current: number): void => {
    const next = Math.round(Number.parseFloat(raw));
    if (!Number.isFinite(next) || next < 1 || next === current) return;
    dispatch({ label, target, type: "controls.setValue", value: next });
  };
  return (
    <div className={styles.pair}>
      <TextInput commitOnBlur name="Artboard width" onValueChange={(raw) => set(WIDTH_TARGET, "Artboard width", raw, width)} value={String(Math.round(width))} />
      <TextInput commitOnBlur name="Artboard height" onValueChange={(raw) => set(HEIGHT_TARGET, "Artboard height", raw, height)} value={String(Math.round(height))} />
    </div>
  );
}
