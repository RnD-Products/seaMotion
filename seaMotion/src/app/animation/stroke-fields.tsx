import { BoundingBox, Minus, Plus, SlidersHorizontal } from "@phosphor-icons/react";
import type * as React from "react";
import { Label, TextInput } from "@/toolcraft/ui";

import styles from "./stroke-fields.module.css";

// The head of a layer's Stroke or Fill part, as in Figma: the title, and a + that adds one (a black one pixel stroke inside the box, a light grey fill)
// or a - that takes it away.
export function StrokeHead({
  hasStroke,
  onAdd,
  onRemove,
  title = "Stroke",
}: Readonly<{ hasStroke: boolean; onAdd: () => void; onRemove: () => void; title?: string }>): React.JSX.Element {
  const noun = title.toLowerCase();
  return (
    <div className={styles.head}>
      <Label className={styles.label}>{title}</Label>
      <button aria-label={hasStroke ? `Remove ${noun}` : `Add ${noun}`} className={styles.button} onClick={hasStroke ? onRemove : onAdd} title={hasStroke ? `Remove the ${noun}` : `Add a ${noun}`} type="button">
        {hasStroke ? <Minus size={14} /> : <Plus size={14} />}
      </button>
    </div>
  );
}

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const round = (value: number): number => Math.round(value * 100) / 100;

// The button beside Weight that switches between one weight all round and a weight for each side ("Individual strokes", as in Figma).
export function SidesToggle({ each, onToggle }: Readonly<{ each: boolean; onToggle: () => void }>): React.JSX.Element {
  return (
    <button
      aria-label="Stroke each side on its own"
      aria-pressed={each}
      className={styles.button}
      data-on={each ? "true" : "false"}
      onClick={onToggle}
      title="Individual strokes: a weight for each side"
      type="button"
    >
      <BoundingBox size={16} />
    </button>
  );
}

// A weight for each side, top and right on the first row, left and bottom under them. `sides` is top, right, bottom, left.
export function SideBoxes({ onChange, sides }: Readonly<{ onChange: (sides: number[]) => void; sides: readonly number[] }>): React.JSX.Element {
  return (
    <div className={styles.grid}>
      {[0, 1, 3, 2].map((at) => (
        <TextInput
          commitOnBlur
          key={SIDES[at]}
          name={SIDES[at] ?? ""}
          onValueChange={(raw) => {
            const parsed = Number.parseFloat(raw);
            if (Number.isFinite(parsed)) onChange(sides.map((value, to) => (to === at ? Math.max(0, parsed) : value)));
          }}
          value={String(round(sides[at] ?? 0))}
        />
      ))}
    </div>
  );
}

// The button after Weight that opens or closes the line style (solid or dashed, dash and gap, ends and joins), kept out of sight until it is needed.
export function AdvancedToggle({ onToggle, open }: Readonly<{ onToggle: () => void; open: boolean }>): React.JSX.Element {
  return (
    <button aria-expanded={open} aria-label="Stroke settings" className={styles.button} data-on={open ? "true" : "false"} onClick={onToggle} title="Line style: dashes, ends and joins" type="button">
      <SlidersHorizontal size={16} />
    </button>
  );
}

// The line style fields, shown under the Weight row while the advanced button is on.
export function StrokeAdvanced({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <div className={styles.advancedBody}>{children}</div>;
}
