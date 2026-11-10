import { CornersOut } from "@phosphor-icons/react";
import * as React from "react";
import { Label, Slider, TextInput } from "@/toolcraft/ui";

import styles from "./corner-radius-fields.module.css";

type Radius = number | readonly number[];

const NAMES = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;
// A quarter circle drawn in the corner it names: the icon beside each box says which corner the box sets.
const ARCS: readonly string[] = ["M3 12V8a5 5 0 0 1 5-5h4", "M4 3h4a5 5 0 0 1 5 5v4", "M13 4v4a5 5 0 0 1-5 5H4", "M12 13H8a5 5 0 0 1-5-5V4"];

const asCorners = (radius: Radius): number[] => (Array.isArray(radius) ? [...radius] : [radius as number, radius as number, radius as number, radius as number]);
const round = (value: number): number => Math.round(value * 100) / 100;
const readNumber = (raw: string, fallback: number): number => {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
};

// "Corner radius": one box that sets every corner, and a button that opens a box for each corner (top left and top right on the first row, bottom left and
// bottom right under them). Equal corners are handed back as one radius.
export function CornerRadiusFields({ onChange, radius }: Readonly<{ onChange: (radius: number | number[], historyGroup?: string) => void; radius: Radius }>): React.JSX.Element {
  const corners = asCorners(radius);
  const same = corners.every((value) => value === corners[0]);
  const [each, setEach] = React.useState(!same);
  // The box that was clicked: its slider shows underneath until focus leaves the boxes and the slider.
  const [open, setOpen] = React.useState<"all" | 0 | 1 | 2 | 3 | null>(null);
  const commit = (next: number[], historyGroup?: string): void => onChange(next.every((value) => value === next[0]) ? (next[0] ?? 0) : next, historyGroup);
  const corner = (at: 0 | 1 | 2 | 3): React.JSX.Element => (
    <div onFocus={() => setOpen(at)}>
      <TextInput
        commitOnBlur
        name={`${NAMES[at]} radius`}
        onValueChange={(raw) => commit(corners.map((value, to) => (to === at ? readNumber(raw, value) : value)))}
        showLabel={false}
        value={String(round(corners[at] ?? 0))}
      />
    </div>
  );
  const sliderValue = open === null ? 0 : open === "all" ? Math.max(...corners) : (corners[open] ?? 0);
  const setSlider = (value: number, historyGroup?: string): void => commit(open === "all" ? corners.map(() => value) : corners.map((current, to) => (to === open ? value : current)), historyGroup);
  const icon = (at: number): React.JSX.Element => (
    <svg aria-hidden className={styles.corner} fill="none" height={16} stroke="currentColor" strokeDasharray="2 2" strokeLinecap="round" strokeWidth={1.5} viewBox="0 0 16 16" width={16}>
      <path d={ARCS[at] ?? ""} />
    </svg>
  );
  return (
    <div
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
    >
      <div className={styles.head}>
        <Label className={styles.label}>Corner radius</Label>
        <div onFocus={() => setOpen("all")}>
          <TextInput
            commitOnBlur
            name="Corner radius"
            onValueChange={(raw) => commit(corners.map(() => readNumber(raw, corners[0] ?? 0)))}
            showLabel={false}
            value={same ? String(round(corners[0] ?? 0)) : "Mixed"}
          />
        </div>
        <button aria-label="Set each corner on its own" aria-pressed={each} className={styles.toggle} data-on={each ? "true" : "false"} onClick={() => setEach((on) => !on)} title="Each corner on its own" type="button">
          <CornersOut size={16} />
        </button>
      </div>
      {each ? (
        <div className={styles.grid}>
          {icon(0)}
          {corner(0)}
          {corner(1)}
          {icon(1)}
          {icon(3)}
          {corner(3)}
          {corner(2)}
          {icon(2)}
        </div>
      ) : null}
      {open !== null ? (
        // Pressing the slider must not take focus from the box, or the slider would close under the pointer.
        <div onMouseDown={(event) => event.preventDefault()}>
          <Slider
            max={300}
            min={0}
            name={open === "all" ? "Corner radius" : `${NAMES[open]} radius`}
            onValueChange={(value, meta) => setSlider(Math.round(value), meta?.historyGroup)}
            step={1}
            unit="px"
            value={Math.min(300, Math.max(0, sliderValue))}
          />
        </div>
      ) : null}
    </div>
  );
}
