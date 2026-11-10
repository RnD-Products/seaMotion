import { LinkBreak, LinkSimple, X } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, Color, FieldDescription, Segmented, Slider, TextInput } from "@/toolcraft/ui";

import { getActiveAnimation } from "./animation-spec";
import { createItemsFromMotion } from "./interaction-motion";
import { getProbeSandbox, useProbeSandboxVersion } from "./layer-texts";
import {
  createInteraction,
  getCursorLayerId,
  INTERACTION_LABELS,
  INTERACTION_TYPES,
  patchInteraction,
  readInteractionsValue,
  removeInteraction,
  sameTiming,
  TYPE_HAS_DEVICE,
  TYPE_HAS_END,
  type InteractionItem,
  type InteractionType,
} from "./interactions";
import styles from "./interaction-list.module.css";

const DEVICES = [
  { label: "Desktop", value: "desktop" },
  { label: "Phone", value: "phone" },
  { label: "Tablet", value: "tablet" },
];
const LOADING = [
  { label: "Spinner", value: "spinner" },
  { label: "Dots", value: "dots" },
  { label: "Bar", value: "bar" },
];
const DIRECTIONS = [
  { label: "Zoom in", value: "in" },
  { label: "Zoom out", value: "out" },
];

// The kit items on the timeline: which kind of icon, and when it is on. Items take the animation's own
// cursor motion, so they move where the animation moves, and the animation's own cursor is not drawn
// while the kit is on. Turning the kit on starts with a ready-made list that can be changed.
export function InteractionList({ setValue, state, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const current = readInteractionsValue(value);
  const { items } = current;
  const duration = Math.max(1, state.timeline.durationSeconds);
  // Items take the animation's cursor motion when it has one; a design without a cursor starts
  // with no items. There are no position controls.
  const spec = getActiveAnimation(state.values);
  const selected = items.find((item) => item.id === current.selected) ?? null;
  // Neighbours that play together (same start, duration and hold) are one row, e.g. "Cursor & Tap".
  const rows: InteractionItem[][] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    const head = last?.[0];
    if (last && head && sameTiming(head, item)) last.push(item);
    else rows.push([item]);
  }
  const selectedRow = rows.find((row) => row.some((item) => item.id === selected?.id)) ?? [];
  // An item that stays where it is (a cursor, drag, move or resize with the same start and end point) is only a pause.
  const isPause = (item: InteractionItem): boolean => TYPE_HAS_END[item.type] && item.x === item.toX && item.y === item.toY;
  const rowLabel = (row: readonly InteractionItem[]): string => row.map((item) => (isPause(item) ? "Pause" : INTERACTION_LABELS[item.type])).join(" & ");

  // Turning the kit on starts with no items. Once the animation is open, one item is made for each
  // segment of its own cursor motion (a Cursor item where it travels, a Tap item where it rests).
  const latest = React.useRef({ canvas: state.canvas.size, duration, params: state.values["animation.params"], setValue });
  latest.current = { canvas: state.canvas.size, duration, params: state.values["animation.params"], setValue };
  const sandboxVersion = useProbeSandboxVersion();
  const [reading, setReading] = React.useState(false);
  const specId = spec?.id;
  const seeded = current.seeded;
  React.useEffect(() => {
    if (seeded || !spec) return;
    const cursorLayerId = getCursorLayerId(spec.layers);
    if (!cursorLayerId) {
      latest.current.setValue({ items: [], seeded: true, selected: null });
      return;
    }
    const sandbox = getProbeSandbox();
    if (!sandbox) return;
    let cancelled = false;
    setReading(true);
    createItemsFromMotion(sandbox, spec, {
      canvas: latest.current.canvas,
      cursorLayerId,
      durationSeconds: latest.current.duration,
      params: latest.current.params,
    })
      .catch(() => [] as InteractionItem[])
      .then((made) => {
        if (cancelled) return;
        setReading(false);
        latest.current.setValue({ items: made, seeded: true, selected: made[0]?.id ?? null });
      });
    return () => {
      cancelled = true;
      setReading(false);
    };
    // The reading depends on which animation is open and its sandbox, not on every value.
  }, [seeded, specId, sandboxVersion]);

  const write = (next: readonly InteractionItem[], nextSelected: string | null): void => {
    setValue({ items: next, seeded: true, selected: nextSelected });
  };
  // Edits every item of the selected row. A longer (or shorter) Duration or Hold moves the items linked below by
  // the same amount.
  const patch = (changes: Partial<InteractionItem>, meta?: Parameters<typeof setValue>[1]): void => {
    if (!selected) return;
    setValue({ items: patchInteraction(items, selectedRow.map((item) => item.id), changes), seeded: true, selected: selected.id }, meta);
  };
  const add = (type: InteractionType): void => {
    const start = Math.min(Math.max(0, duration - 0.5), items.reduce((end, it) => Math.max(end, it.start + it.duration), 0));
    const item = createInteraction(type, { start });
    write([...items, item], item.id);
  };
  // Removing a row pulls the items linked below it up into its place; unlinked ones stay.
  const remove = (row: readonly InteractionItem[]): void => {
    const next = row.reduce<readonly InteractionItem[]>((list, item) => removeInteraction(list, item.id), items);
    const gone = row.some((item) => item.id === current.selected);
    write(next, gone ? (next[0]?.id ?? null) : current.selected);
  };
  // A row's link is its first item's link to the row above.
  const toggleLink = (row: readonly InteractionItem[]): void => {
    const head = row[0];
    if (!head) return;
    write(items.map((item) => (item.id === head.id ? { ...item, linked: !item.linked } : item)), current.selected);
  };

  return (
    <div className={styles.root}>
      <div className={styles.list}>
        {items.length === 0 ? (
          <FieldDescription>{reading ? "Reading the animation's cursor motion…" : "No interactions yet. Add one below."}</FieldDescription>
        ) : null}
        {rows.map((row, index) => {
          const head = row[0];
          if (!head) return null;
          const label = rowLabel(row);
          const isSelected = row.some((item) => item.id === selected?.id);
          return (
            <div className={styles.row} key={head.id}>
              <Button
                aria-pressed={isSelected}
                className={styles.rowOpen}
                onClick={() => write(items, head.id)}
                size="default"
                type="button"
                variant={isSelected ? "secondary" : "ghost"}
              >
                {label}
                {/* An item that stays on its last moment (Hold) is tagged (pause); its times are start · duration + stay. A pause
                    (only waiting) shows its start and whole wait. */}
                {head.hold > 0 && !isPause(head) ? <span className={styles.tag}>(pause)</span> : null}
                <span
                  className={styles.meta}
                  title={isPause(head) ? "Start · Pause" : head.hold > 0 ? "Start · Duration + Stay (Hold)" : "Start · Duration"}
                >
                  {isPause(head)
                    ? `${head.start.toFixed(1)}s · ${(head.duration + head.hold).toFixed(1)}s`
                    : `${head.start.toFixed(1)}s · ${head.duration.toFixed(1)}s${head.hold > 0 ? ` + ${head.hold.toFixed(1)}s` : ""}`}
                </span>
              </Button>
              {/* Linked to the row above (the node line joins them): it moves when that one changes or is removed. */}
              <span className={index > 0 && head.linked ? `${styles.link} ${styles.chained}` : styles.link}>
                {index > 0 ? (
                  <Button
                    aria-label={head.linked ? `Unlink ${label} from the item above` : `Link ${label} to the item above`}
                    aria-pressed={head.linked}
                    className={head.linked ? undefined : styles.unlinked}
                    onClick={() => toggleLink(row)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    {head.linked ? <LinkSimple size={12} /> : <LinkBreak size={12} />}
                  </Button>
                ) : null}
              </span>
              <Button aria-label={`Remove ${label}`} onClick={() => remove(row)} size="icon-xs" type="button" variant="ghost">
                <X size={12} />
              </Button>
            </div>
          );
        })}
      </div>
      <div className={styles.add}>
        <span className={styles.label}>Add</span>
        {INTERACTION_TYPES.map((type) => (
          <Button key={type} onClick={() => add(type)} size="default" type="button" variant="outline">
            {INTERACTION_LABELS[type]}
          </Button>
        ))}
      </div>
      {selected ? (
        <div className={styles.editor}>
          {TYPE_HAS_DEVICE[selected.type] ? (
            <Segmented name="Device" onValueChange={(next) => patch({ device: next as InteractionItem["device"] })} options={DEVICES} value={selected.device} />
          ) : null}
          {selected.type === "loading" ? (
            <Segmented name="Style" onValueChange={(next) => patch({ loading: next as InteractionItem["loading"] })} options={LOADING} value={selected.loading} />
          ) : null}
          {selected.type === "pinch" ? (
            <Segmented name="Direction" onValueChange={(next) => patch({ direction: next as InteractionItem["direction"] })} options={DIRECTIONS} value={selected.direction} />
          ) : null}
          {selected.type === "typing" ? (
            <TextInput name="Text" onValueChange={(next, meta) => patch({ text: next }, meta)} value={selected.text} />
          ) : null}
          <Slider max={240} min={16} name="Size" onValueChange={(next, meta) => patch({ size: next }, meta)} step={1} unit="px" value={selected.size} />
          <Color hex={selected.color} name="Color" onValueChange={(next) => patch({ color: next.hex })} />
        </div>
      ) : null}
    </div>
  );
}
