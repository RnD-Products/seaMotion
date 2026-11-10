import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Color, Segmented, Select, Slider, Switch } from "@/toolcraft/ui";

import type { ControlSpec } from "./animation-spec";
import styles from "./animation-controls.module.css";

type Change = (id: string, next: unknown, meta?: Parameters<ToolcraftCustomControlRendererProps["setValue"]>[1]) => void;

const FALLBACK_GROUP = "Controls";

// Draws a set of controls from a spec, one category at a time. A disabled list shows the same
// controls greyed out and untouchable.
export function ControlList({
  controls,
  disabled = false,
  onChange,
  params,
}: Readonly<{
  controls: readonly ControlSpec[];
  disabled?: boolean;
  onChange: Change;
  params: Readonly<Record<string, unknown>>;
}>): React.ReactNode {
  const [selectedGroup, setSelectedGroup] = React.useState<string | null>(null);
  const groups = [...new Set(controls.map((control) => control.group ?? FALLBACK_GROUP))];
  const group = selectedGroup && groups.includes(selectedGroup) ? selectedGroup : (groups[0] ?? FALLBACK_GROUP);
  const visible = controls.filter(
    (control) =>
      (control.group ?? FALLBACK_GROUP) === group && (!control.showWhen || params[control.showWhen.id] === control.showWhen.equals),
  );
  return (
    <div
      aria-disabled={disabled || undefined}
      className={disabled ? `${styles.root} ${styles.disabled}` : styles.root}
      inert={disabled || undefined}
    >
      {groups.length > 1 ? (
        <Select
          name="Category"
          onValueChange={setSelectedGroup}
          options={groups.map((name) => ({ label: name, value: name }))}
          showLabel={false}
          value={group}
        />
      ) : null}
      {visible.map((control) => (
        <div className={styles.item} key={control.id}>
          {renderControl(control, params[control.id], (next, meta) => onChange(control.id, next, meta))}
        </div>
      ))}
    </div>
  );
}

function renderControl(
  control: ControlSpec,
  current: unknown,
  change: (next: unknown, meta?: Parameters<ToolcraftCustomControlRendererProps["setValue"]>[1]) => void,
): React.ReactNode {
  switch (control.type) {
    case "slider":
      return (
        <Slider
          max={control.max ?? 100}
          min={control.min ?? 0}
          name={control.label}
          onValueChange={(next, meta) => change(next, meta)}
          step={control.step ?? 1}
          unit={control.unit}
          value={typeof current === "number" ? current : Number(control.default ?? 0)}
        />
      );
    case "segmented":
      return (
        <Segmented
          name={control.label}
          onValueChange={(next) => change(next)}
          options={control.options ?? []}
          value={typeof current === "string" ? current : String(control.default ?? "")}
        />
      );
    case "select":
      return (
        <Select
          name={control.label}
          onValueChange={(next) => change(next)}
          options={control.options ?? []}
          value={typeof current === "string" ? current : String(control.default ?? "")}
        />
      );
    case "switch":
      return <Switch checked={current === true} name={control.label} onCheckedChange={(next) => change(next)} />;
    case "color":
      return (
        <Color
          hex={typeof current === "string" ? current : String(control.default ?? "#000000")}
          name={control.label}
          onValueChange={(next) => change(next.hex)}
        />
      );
  }
}
