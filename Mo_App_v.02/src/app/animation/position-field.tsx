import { LinkSimple, LinkSimpleBreak } from "@phosphor-icons/react";
import * as React from "react";
import { Slider, TextInput } from "@/toolcraft/ui";

import styles from "./animation-controls.module.css";

// A position in pixels: a slider to drag and a box to type in, kept in step.
export function PositionField({
  max = 3200,
  min = -1600,
  name,
  onValueChange,
  value,
}: Readonly<{
  max?: number;
  min?: number;
  name: string;
  onValueChange: (value: number, historyGroup?: string) => void;
  value: number;
}>): React.JSX.Element {
  return (
    <div style={{ alignItems: "end", display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) 68px" }}>
      <Slider
        max={max}
        min={min}
        name={name}
        onValueChange={(next, meta) => onValueChange(Math.round(next), meta?.historyGroup)}
        step={1}
        unit="px"
        value={Math.min(max, Math.max(min, value))}
      />
      <TextInput
        commitOnBlur
        name={`${name} (type)`}
        onValueChange={(raw) => {
          const parsed = Number.parseFloat(raw);
          if (Number.isFinite(parsed)) onValueChange(Math.round(parsed));
        }}
        showLabel={false}
        value={String(Math.round(value))}
      />
    </div>
  );
}

type PairField = Readonly<{ label: string; onChange: (value: number, historyGroup?: string) => void; value: number }>;

// Two number boxes side by side in one row. Clicking a box opens a slider for it underneath, to drag; it closes when focus leaves the two boxes and
// the slider. Used for X / Y and Width / Height.
export function SliderPair({
  first,
  lock,
  max,
  min,
  second,
  unit = "px",
}: Readonly<{ first: PairField; lock?: Readonly<{ locked: boolean; onToggle: () => void }>; max: number; min: number; second?: PairField; unit?: string }>): React.JSX.Element {
  const [open, setOpen] = React.useState<0 | 1 | null>(null);
  const fields = second ? ([first, second] as const) : ([first] as const);
  const commit = (apply: (value: number) => void) => (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) apply(Math.round(parsed));
  };
  const current = open === null ? null : (fields[open] ?? null);
  return (
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div className={styles.pair} style={lock ? { gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)" } : undefined}>
        {fields.map((field, at) => (
          <React.Fragment key={field.label}>
            {at === 1 && lock ? (
              <button
                aria-label="Lock ratio"
                aria-pressed={lock.locked}
                className={styles.lockButton}
                data-locked={lock.locked ? "true" : "false"}
                onClick={lock.onToggle}
                title={lock.locked ? "Width and Height change together (click to unlock)" : "Lock ratio: Width and Height change together"}
                type="button"
              >
                {lock.locked ? <LinkSimple size={14} /> : <LinkSimpleBreak size={14} />}
              </button>
            ) : null}
            <div onFocus={() => setOpen(at as 0 | 1)}>
              <TextInput commitOnBlur name={field.label} onValueChange={commit((next) => field.onChange(next))} value={String(Math.round(field.value))} />
            </div>
          </React.Fragment>
        ))}
        {second ? null : <div />}
      </div>
      {current ? (
        // Pressing the slider must not take focus from the box, or the slider would close under the pointer.
        <div onMouseDown={(event) => event.preventDefault()}>
          <Slider
            max={max}
            min={min}
            name={current.label}
            onValueChange={(next, meta) => current.onChange(Math.round(next), meta?.historyGroup)}
            step={1}
            unit={unit}
            value={Math.min(max, Math.max(min, current.value))}
          />
        </div>
      ) : null}
    </div>
  );
}

// Position X and Position Y in one row (the boxes are labelled X and Y; the slider says which one it moves).
export function PositionPair({
  max = 3200,
  min = -1600,
  onXChange,
  onYChange,
  x,
  y,
}: Readonly<{ max?: number; min?: number; onXChange: (value: number, historyGroup?: string) => void; onYChange: (value: number, historyGroup?: string) => void; x: number; y: number }>): React.JSX.Element {
  return <SliderPair first={{ label: "X", onChange: onXChange, value: x }} max={max} min={min} second={{ label: "Y", onChange: onYChange, value: y }} />;
}
