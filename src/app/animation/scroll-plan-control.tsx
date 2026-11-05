import { CaretDown, CaretRight, Copy, DotsSixVertical, PushPin, X } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, Color, FieldDescription, FieldError, Select, Switch, TextInput } from "@/toolcraft/ui";

import { getActiveAnimation, type PageInfo } from "./animation-spec";
import { readInteractions } from "./interactions";
import {
  addStep,
  applyEasing,
  autoSteps,
  buildSegments,
  DEFAULT_CUSTOM_EASING,
  effectivePlan,
  evaluateExpression,
  EASINGS,
  evaluateScroll,
  maxScroll,
  parseBezier,
  planDuration,
  readEasing,
  readLandingPlan,
  duplicateStep,
  moveStep,
  removeStep,
  replaceStep,
  stepEasing,
  newStartPart,
  withBlur,
  withStart,
  type EasingId,
  type StartPart,
  type PlanSecond,
  type PlanStep,
  type EndMode,
  type LandingPlan,
  type PlanSegment,
} from "./landing-plan";
import { LANDING_SECTIONS_TARGET, readSectionMotions, withWaits } from "./landing-motion";
import { clearLoopSegments, END_KEY, loopRanges, nextLoopTime, pickLoopSegment, segmentRange, START_KEY, useLoopSelection } from "./landing-loop";
import { setDraftPlan } from "./landing-draft";
import { isPreloader, readStartPreset, START_PRESETS } from "./start-screen";
import styles from "./scroll-plan-control.module.css";

// Rail geometry (px): the dot centre below the card top, and the gap from the card bottom to the next dot centre.
const RAIL_START = 14;
const RAIL_NEXT = 8;
const NO_WAIT = "__none";
const seconds = (value: number): string => `${Math.round(value * 100) / 100}`;
// A typed number or sum (see evaluateExpression); `fallback` when it does not read as one.
const toNumber = (text: string, fallback: number): number => evaluateExpression(text, fallback) ?? fallback;

const EASING_OPTIONS = EASINGS.map((item) => ({ label: item.label, value: item.id }));
const STEP_EASING_OPTIONS = [{ label: "Plan default", value: "plan" }, ...EASING_OPTIONS];
const SECOND_EASING_OPTIONS = [{ label: "2nd plan default", value: "plan" }, ...EASING_OPTIONS];
const START_OPTIONS = START_PRESETS.map((item) => ({ label: `${item.group} · ${item.label}`, value: item.id }));
const END_OPTIONS: readonly { label: string; value: EndMode }[] = [
  { label: "Hold on the bottom", value: "hold" },
  { label: "Back to the top (loop)", value: "top" },
  { label: "Reload", value: "reload" },
];
const ACTION_OPTIONS: readonly { label: string; value: string }[] = [
  { label: "Auto steps · one stop per section", value: "auto" },
  { label: "Add a step further down", value: "step" },
  { label: "Add a step back up", value: "back" },
  { label: "Add a scroll to the top", value: "top" },
  { label: "Add a reload", value: "reload" },
];
const BEZIER_HELP = "Paste cubic-bezier(0.22, 1, 0.36, 1), four numbers, or ease / ease-in / ease-out / ease-in-out.";

// The shape of an easing as a small line: time across, distance up.
function Curve({ custom, id }: { custom?: string; id: EasingId }): React.ReactNode {
  const points = Array.from({ length: 25 }, (_, index) => {
    const x = index / 24;
    const y = applyEasing(id, x, custom);
    return `${(2 + x * 24).toFixed(1)},${(20 - Math.min(1.3, Math.max(-0.2, y)) * 16).toFixed(1)}`;
  }).join(" ");
  return (
    <svg aria-hidden="true" className={styles.curve} viewBox="0 0 28 24">
      <rect fill="none" height="16" opacity="0.25" stroke="currentColor" width="24" x="2" y="4" />
      <polyline fill="none" points={points} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

// A number field the arrow keys nudge: Up / Down by one step (1 px, 0.1 s), Shift by ten steps, Alt by a tenth. The canvas
// shows each nudge at once through a draft plan; the plan is saved once the keys have rested, so holding a key
// stays smooth. Typing works as before and is kept when the field loses focus or Enter is pressed.
function NumberField({
  max = Number.POSITIVE_INFINITY,
  min = 0,
  makePlan,
  name,
  onCommit,
  onEdit,
  onFocusField,
  step,
  value,
  whole = false,
}: {
  makePlan: (next: number) => LandingPlan;
  max?: number;
  min?: number;
  name: string;
  onCommit: (next: number) => void;
  // Called with the plan as it would be after every change (each arrow press and each typed value), so the
  // playhead can follow it.
  onEdit?: (plan: LandingPlan) => void;
  // Called when the field gets focus (a click or Tab into it).
  onFocusField?: () => void;
  step: number;
  value: number;
  whole?: boolean;
}): React.ReactNode {
  const format = (n: number): string => (whole ? `${Math.round(n)}` : seconds(n));
  const [shown, setShown] = React.useState(format(value));
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => setShown(format(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      setDraftPlan(null);
    },
    [],
  );
  const clamp = (n: number): number => {
    const bounded = Math.min(max, Math.max(min, n));
    return whole ? Math.round(bounded) : Math.round(bounded * 100) / 100;
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const size = event.shiftKey ? step * 10 : event.altKey ? step / 10 : step;
    const base = evaluateExpression(input.value, value) ?? value;
    // Going up never passes the top limit and going down never passes the bottom one; a value already past a
    // limit (an older plan) is left alone until it is moved back inside.
    const round = (n: number): number => (whole ? Math.round(n) : Math.round(n * 100) / 100);
    const next = event.key === "ArrowUp" ? Math.max(base, round(Math.min(max, base + size))) : Math.min(base, round(Math.max(min, base - size)));
    setShown(format(next));
    const drafted = makePlan(next);
    setDraftPlan(drafted);
    onEdit?.(drafted);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onCommit(next);
      setDraftPlan(null);
    }, 250);
  };
  return (
    <div onFocus={onFocusField} onKeyDown={onKeyDown} onPointerDownCapture={onFocusField} style={{ display: "contents" }}>
      <TextInput
        commitOnBlur
        name={name}
        onValueChange={(text) => {
          window.clearTimeout(timer.current);
          setDraftPlan(null);
          const typed = clamp(toNumber(text, value));
          onCommit(typed);
          onEdit?.(makePlan(typed));
        }}
        value={shown}
      />
    </div>
  );
}

// A field for a pasted easing curve. Only a curve that reads correctly is kept.
function CurveInput({ onCommit, value }: { onCommit: (text: string) => void; value: string }): React.ReactNode {
  const [error, setError] = React.useState(false);
  return (
    <div className={styles.curveInput}>
      <TextInput
        commitOnBlur
        name="Curve"
        onValueChange={(next) => {
          const text = next.trim();
          if (text === value) {
            setError(false);
          } else if (parseBezier(text)) {
            setError(false);
            onCommit(text);
          } else {
            setError(true);
          }
        }}
        value={value}
      />
      {error ? <FieldError>{BEZIER_HELP}</FieldError> : null}
    </div>
  );
}

// The Scroll plan of a Landing Page: the loading screen, every scroll step and the ending, as cards
// down a vertical rail, with the playhead moving along it.
export function ScrollPlanControl(props: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(props.state.values);
  const page = spec?.page;
  if (!page) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>No page yet</div>
        <FieldDescription>Import a design and the page appears here as a vertical bar, top to bottom, with its scroll steps.</FieldDescription>
      </div>
    );
  }
  return <PlanEditor {...props} page={page} />;
}

// A card's name. Double-click to rename it; clearing it (or typing the automatic name) goes back to
// the automatic one. Enter keeps the change and Escape drops it.
function EditableName({ fallback, onClick, onCommit, value }: { fallback: string; onClick?: () => void; onCommit: (name: string) => void; value: string }): React.ReactNode {
  const [editing, setEditing] = React.useState(false);
  // A single click runs `onClick` after a short wait, so a double-click (rename) does not also trigger it.
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!editing) return;
    const input = box.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [editing]);
  if (editing) {
    return (
      <div className={styles.nameEdit} onBlur={() => setEditing(false)} ref={box}>
        <TextInput
          commitOnBlur
          defaultValue={fallback}
          name="Name"
          onValueChange={(next) => {
            const text = next.trim().slice(0, 60);
            onCommit(text === fallback ? "" : text);
          }}
          showLabel={false}
          value={value || fallback}
        />
      </div>
    );
  }
  return (
    <span
      className={onClick ? `${styles.rowName} ${styles.rowNameToggle}` : styles.rowName}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(onClick, 220);
            }
          : undefined
      }
      onDoubleClick={() => {
        if (timer.current) clearTimeout(timer.current);
        setEditing(true);
      }}
      title={onClick ? "Click to collapse or expand. Double-click to rename" : "Double-click to rename"}
    >
      {value || fallback}
    </span>
  );
}

export type RailMark = Readonly<{ at: number; kind: "now" | "pin"; title: string }>;
type CardKey = "end" | "loading" | number;

export function RailCard({
  index,
  active,
  children,
  dot,
  dragging = false,
  first,
  last,
  looped,
  marks,
  onMarkDown,
  onScrub,
  onSelect,
  onToggle,
  range,
  selected,
  scope = "plan",
}: {
  active: boolean;
  children: React.ReactNode;
  dot: string;
  // The playhead mark is being dragged.
  dragging?: boolean;
  // The card's place in the stack (0 is Start), so it can be found and shown.
  index: number;
  first?: boolean;
  last?: boolean;
  // This segment (the stretch of rail below the dot) is picked to loop.
  looped: boolean;
  marks: readonly RailMark[];
  // Pressing the playhead mark starts a drag along the whole rail.
  onMarkDown?: (event: React.PointerEvent<HTMLElement>) => void;
  // A click beside the line: play from that time.
  onScrub: (time: number) => void;
  onSelect: (event: React.MouseEvent<HTMLDivElement>) => void;
  // A click on the line itself: picks or drops the segment, with the time that was clicked and
  // whether Shift (or Cmd / Ctrl) was held to add to the others.
  onToggle: (time: number, additive: boolean) => void;
  // The times this card covers; the rail beside it maps top to bottom onto them.
  range: readonly [number, number];
  scope?: "plan" | "section" | "layer";
  selected: boolean;
}): React.ReactNode {
  const state = [styles.cardRow, active ? styles.cardActive : "", selected ? styles.cardSelected : "", looped ? styles.cardLooped : ""].join(" ");
  // A ghost playhead follows the pointer down the rail; a click puts the real playhead there.
  const [ghost, setGhost] = React.useState<number | null>(null);
  const railRef = React.useRef<HTMLDivElement>(null);
  // The stroke runs from this dot's centre (14 px down) to the next dot's centre (8 px past the card), so time
  // is mapped over that length: the end of a segment sits exactly on the next step's number.
  const fraction = (event: { clientY: number; currentTarget: Element }): number => {
    const rect = (railRef.current ?? event.currentTarget).getBoundingClientRect();
    const length = rect.height + (last ? -RAIL_START : RAIL_NEXT);
    return length > 0 ? Math.min(1, Math.max(0, (event.clientY - rect.top - RAIL_START) / length)) : 0;
  };
  const topFor = (at: number): string => `calc(${RAIL_START}px + (100% + ${last ? -RAIL_START : RAIL_NEXT}px) * ${Math.min(1, Math.max(0, at))})`;
  const timeAt = (at: number): number => range[0] + at * Math.max(0, range[1] - range[0]);
  return (
    <div className={state} data-plan-card={scope === "plan" ? "" : undefined} data-plan-index={scope === "plan" ? index : undefined} data-section-card={scope === "section" ? "" : undefined} data-section-index={scope === "section" ? index : undefined} data-layer-card={scope === "layer" ? "" : undefined} data-layer-index={scope === "layer" ? index : undefined}>
      <div
        className={styles.rail}
        onClick={(event) => onScrub(timeAt(fraction(event)))}
        onPointerLeave={() => setGhost(null)}
        onPointerMove={(event) => setGhost(dragging ? null : fraction(event))}
        ref={railRef}
        role="presentation"
        title="Click to play from here"
      >
        <div className={[styles.railLine, last ? styles.railLineLast : ""].join(" ")} />
        <div
          className={[styles.pick, last ? styles.pickLast : ""].join(" ")}
          data-loop-keep=""
          onClick={(event) => {
            // The line picks the segment; the space beside it plays from a point.
            event.stopPropagation();
            onToggle(timeAt(fraction(event)), event.shiftKey || event.metaKey || event.ctrlKey);
          }}
          onMouseDown={(event) => {
            // Shift-click would otherwise select the text between the two clicks.
            if (event.shiftKey) event.preventDefault();
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            setGhost(null);
          }}
          role="presentation"
          title={looped ? "Looping this segment. Click to stop, Shift-click to take it away" : "Click to loop this segment. Shift-click to add it to the others"}
        />
        {/* After the click area on purpose: the area's hover lights this stroke up. */}
        <div className={[styles.segment, last ? styles.segmentLast : "", looped ? styles.segmentOn : ""].join(" ")} />
        <span className={styles.railDot}>{dot}</span>
        {marks.map((mark, index) => (
          <span
            className={mark.kind === "now" ? [styles.mark, dragging ? styles.markDragging : ""].join(" ") : styles.pin}
            key={`${mark.kind}-${index}`}
            onClick={mark.kind === "now" ? (event) => event.stopPropagation() : undefined}
            onPointerDown={mark.kind === "now" ? (event) => {
              setGhost(null);
              onMarkDown?.(event);
            } : undefined}
            onPointerEnter={mark.kind === "now" ? () => setGhost(null) : undefined}
            onPointerMove={mark.kind === "now" ? (event) => {
              // Over the handle the rail's hover line and the stroke stay quiet.
              event.stopPropagation();
              setGhost(null);
            } : undefined}
            style={{ top: topFor(mark.at) }}
            title={mark.kind === "now" ? `${mark.title} · drag to scrub` : mark.title}
          />
        ))}
        {ghost !== null ? (
          <span className={styles.ghost} style={{ top: topFor(ghost) }}>
            <span className={styles.ghostLabel}>{seconds(timeAt(ghost))} s</span>
          </span>
        ) : null}
      </div>
      <div className={styles.card} onClick={onSelect} role="presentation">
        {children}
      </div>
    </div>
  );
}

function PlanEditor({
  dispatch,
  page,
  setValue,
  state,
  value,
}: Pick<ToolcraftCustomControlRendererProps, "dispatch" | "setValue" | "state" | "value"> & { page: PageInfo }): React.ReactNode {
  const plan = effectivePlan(readLandingPlan(value), page);
  // The plan as it plays: steps that wait for a section animation hold on until it is over.
  const motions = React.useMemo(() => readSectionMotions(state.values[LANDING_SECTIONS_TARGET]), [state.values]);
  const played = withWaits(plan, page, motions);
  const [selected, setSelected] = React.useState<CardKey | null>(null);
  // Cards start folded down to their header; the ones opened are kept here (this session only).
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(new Set());
  const isFolded = (id: string): boolean => !opened.has(id);
  const toggleFold = (id: string): void =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [scrollSettingsOpen, setScrollSettingsOpen] = React.useState(false);
  const max = maxScroll(page);
  const time = state.timeline.currentTimeSeconds;
  const now = evaluateScroll(played, page, time);
  const { segments, total } = buildSegments(played, max);
  const animatedSections = Object.entries(motions).filter(([key, motion]) => motion.enabled && motion.items.length > 0 && page.sections.some((section) => section.name === (motion.section ?? key))).map(([key]) => key);
  const kit = state.values["interactions.enabled"] === true ? readInteractions(state.values) : [];

  const commit = (next: LandingPlan): void => setValue(next);
  const edit = (index: number, patch: Parameters<typeof replaceStep>[2]): void => commit(replaceStep(plan, index, patch));

  // Where the playhead (and each kit interaction) sits inside one card, 0 at its top and 1 at its bottom.
  const marksFor = (start: number, end: number): RailMark[] => {
    const span = Math.max(0.001, end - start);
    const list: RailMark[] = [];
    if (time >= start && time < end) list.push({ at: (time - start) / span, kind: "now", title: `${seconds(time)} s` });
    for (const item of kit) {
      if (item.start >= start && item.start < end) list.push({ at: (item.start - start) / span, kind: "pin", title: `${item.type} at ${seconds(item.start)} s` });
    }
    return list;
  };

  // Clicking a card picks it and shows it: the playhead jumps to where that step is on screen.
  // Clicking the picked card again drops the pick.
  const pick = (key: CardKey, at: number) => (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
    if (selected === key) {
      setSelected(null);
      return;
    }
    setSelected(key);
    dispatch({ currentTimeSeconds: Math.max(0, at), type: "timeline.setCurrentTime" });
  };

  // A click anywhere outside the cards (but not on the timeline controls or an open menu), or
  // Escape, drops the pick.
  React.useEffect(() => {
    if (selected === null) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-plan-card], [data-panel-type="timeline"], [role="listbox"], [role="dialog"], [role="alertdialog"]')) return;
      setSelected(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);

  // Drag to reorder: a 70% copy of the card follows the pointer, a blue guide shows where it will
  // land, and it only moves when the copy covers 60% or more of another step card.
  const startDrag = (event: React.PointerEvent<HTMLElement>, from: number): void => {
    if (event.button !== 0) return;
    const card = event.currentTarget.closest<HTMLElement>("[data-plan-card]");
    if (!card) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const ox = event.clientX - rect.left;
    const oy = event.clientY - rect.top;
    const scale = 0.7;
    const clone = card.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
      left: `${rect.left}px`,
      margin: "0",
      opacity: "0.92",
      pointerEvents: "none",
      position: "fixed",
      top: `${rect.top}px`,
      transformOrigin: `${ox}px ${oy}px`,
      width: `${rect.width}px`,
      zIndex: "1000",
    });
    const guide = document.createElement("div");
    Object.assign(guide.style, { background: "#4c8dff", borderRadius: "2px", display: "none", height: "3px", pointerEvents: "none", position: "fixed", zIndex: "999" });
    document.body.append(clone, guide);
    card.style.opacity = "0.35";
    let target: number | null = null;
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - event.clientX;
      const dy = move.clientY - event.clientY;
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      const top = rect.top + dy + oy * (1 - scale);
      const bottom = top + rect.height * scale;
      let best = 0;
      target = null;
      for (let to = 0; to < plan.steps.length; to += 1) {
        if (to === from) continue;
        const other = document.querySelector<HTMLElement>(`[data-plan-index="${to + 1}"]`)?.getBoundingClientRect();
        if (!other || other.height <= 0) continue;
        const share = (Math.min(bottom, other.bottom) - Math.max(top, other.top)) / other.height;
        if (share >= 0.6 && share > best) {
          best = share;
          target = to;
        }
      }
      if (target === null) {
        guide.style.display = "none";
        return;
      }
      const over = document.querySelector<HTMLElement>(`[data-plan-index="${target + 1}"]`)?.getBoundingClientRect();
      if (!over) return;
      Object.assign(guide.style, { display: "block", left: `${over.left}px`, top: `${(target < from ? over.top : over.bottom) - 1.5}px`, width: `${over.width}px` });
    };
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      clone.remove();
      guide.remove();
      card.style.opacity = "";
      if (target !== null) reorder(from, target);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    onMove(event.nativeEvent);
  };
  // Moves a step to a new place and keeps it picked.
  const reorder = (from: number, to: number): void => {
    const next = moveStep(plan, from, to);
    if (next === plan) return;
    commit(next);
    setSelected(to);
    showCard(to + 1);
  };
  const duplicate = (index: number): void => {
    commit(duplicateStep(plan, index));
    setSelected(index + 1);
    setNotice(`Duplicated step ${index + 1}`);
    showCard(index + 2);
  };
  // Up / Down arrows move the picked step (not while typing in a field).
  React.useEffect(() => {
    if (typeof selected !== "number") return;
    const onArrow = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [role=combobox], [role=listbox], [contenteditable=true]")) return;
      event.preventDefault();
      reorder(selected, selected + (event.key === "ArrowUp" ? -1 : 1));
    };
    document.addEventListener("keydown", onArrow);
    return () => document.removeEventListener("keydown", onArrow);
  });

  // Each field of a step shows its own moment: the first scroll's Scroll At / Scroll time at where that scroll
  // lands, the 2nd At's Scroll At / Scroll time where the second one lands, its Delay where it starts, Hold at
  // the end of the step (a hair inside it, so a picked loop keeps it).
  type Moment = "first" | "second" | "secondStart" | "end";
  const momentOf = (segment: PlanSegment | undefined, moment: Moment): number | null => {
    if (!segment) return null;
    const second = segment.second;
    const wanted =
      moment === "end"
        ? segment.end
        : moment === "first"
          ? segment.firstEnd
          : second
            ? moment === "second"
              ? second.start + second.travel
              : second.start
            : segment.travelEnd;
    return Math.max(segment.start, Math.min(wanted, segment.end - 0.02));
  };
  const showStepMoment = (segment: PlanSegment | undefined, moment: Moment): void => {
    const at = momentOf(segment, moment);
    if (at !== null) scrub(at);
  };
  // After an edit of step `index` the playhead goes to that moment of the step as it now is (the moments move
  // when a time is changed), so the result is always on screen.
  const followStep = (edited: LandingPlan, index: number, moment: Moment): void => {
    const at = momentOf(buildSegments(withWaits(edited, page, motions), max).segments[index], moment);
    if (at !== null) scrub(at);
  };
  const scrub = (at: number): void => dispatch({ currentTimeSeconds: Math.min(total, Math.max(0, at)), type: "timeline.setCurrentTime" });
  // A segment picked on the rail loops while the timeline plays; picking one also moves the playhead into it.
  const loopKeys = useLoopSelection();
  const looping = loopRanges(played, loopKeys, motions, page, total);
  // Play from a point beside the line. Moving to a time outside the looped segments lets go of the loop.
  const scrubFree = (time: number): void => {
    scrub(time);
    if (loopKeys.length > 0 && nextLoopTime(looping, time) !== null) clearLoopSegments();
  };
  // Dragging the playhead mark: the pointer is followed along the whole rail, so the playhead moves through
  // every step, forward and back (it is not tied to the card the mark started in).
  const [markDrag, setMarkDrag] = React.useState(false);
  const latest = React.useRef({ plan, scrubFree, segments, total });
  latest.current = { plan, scrubFree, segments, total };
  const startMarkDrag = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setMarkDrag(true);
    const timeAtY = (y: number): number => {
      const { plan: current, segments: list, total: length } = latest.current;
      const count = current.steps.length;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-plan-card]")];
      let result = y < (cards[0]?.getBoundingClientRect().top ?? 0) ? 0 : length;
      for (const card of cards) {
        const index = Number(card.dataset.planIndex);
        const rail = card.firstElementChild?.getBoundingClientRect();
        if (!rail) continue;
        const range: readonly [number, number] | null =
          index === 0 ? [0, current.loading] : index <= count ? (list[index - 1] ? [list[index - 1]!.start, list[index - 1]!.end] : null) : list[count] ? [list[count]!.start, list[count]!.end] : [length, length];
        if (!range) continue;
        const top = rail.top + RAIL_START;
        const bottom = index === count + 1 ? rail.bottom : rail.bottom + RAIL_NEXT + RAIL_START;
        if (y >= top && y < bottom) {
          result = range[0] + ((y - top) / Math.max(1, bottom - top)) * (range[1] - range[0]);
          break;
        }
      }
      return Math.min(length, Math.max(0, result));
    };
    const move = (moved: PointerEvent): void => latest.current.scrubFree(timeAtY(moved.clientY));
    const end = (released: PointerEvent): void => {
      // The spot where the pointer is let go counts too.
      if (released.type === "pointerup") move(released);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setMarkDrag(false);
      // The click that follows letting go must not pick or play anything under the pointer.
      const swallow = (click: MouseEvent): void => click.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };
  const toggle = (key: string) => (time: number, additive: boolean) => {
    const range = segmentRange(plan, key);
    if (!range) return;
    pickLoopSegment(key, additive);
    // Picking a segment puts the playhead at the bottom end of its stroke (where it lands, at the next dot),
    // not at the spot that was clicked. It stops a hair short of the end so it stays inside the picked loop.
    if (!loopKeys.includes(key) || (!additive && loopKeys.length > 1)) scrub(Math.max(range[0], range[1] - 0.02));
  };

  // Changes one part of the Start (and the total length follows).
  const editPart = (id: string, patch: Partial<StartPart>): void => {
    commit(withStart(plan, plan.start.map((part) => (part.id === id ? { ...part, ...patch } : part))));
  };

  // Changes the nested second scroll of a step (and pins the step, as any hand edit does).
  const editSecond = (index: number, step: PlanStep, patch: Partial<PlanSecond>): void => {
    if (!step.second) return;
    commit(replaceStep(plan, index, { second: { ...step.second, ...patch } }));
  };

  // The plan menu: each choice does its job and the menu goes back to its own label.
  const [menuKey, setMenuKey] = React.useState(0);
  // What the last choice did, shown under the menu for a moment: the menu itself always reads
  // 'Add to the plan', so this is how you see what you picked and where it went.
  const [notice, setNotice] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const showCard = (index: number): void => {
    window.setTimeout(() => document.querySelector(`[data-plan-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  };
  const runAction = (action: string): void => {
    const added = plan.steps.length;
    if (action === "auto") {
      const steps = autoSteps(page);
      commit({ ...plan, steps });
      setSelected(null);
      setNotice(`Auto steps: ${steps.length} steps, one stop per section`);
      showCard(1);
    } else if (action === "step" || action === "back" || action === "top" || action === "reload") {
      const next = addStep(plan, page, action === "step" ? "scroll" : action);
      const step = next.steps[added];
      commit(next);
      setSelected(added);
      const label =
        action === "reload"
          ? "a reload"
          : action === "top"
            ? "a scroll to the top"
            : action === "back"
              ? `a scroll back ${Math.abs(step?.scroll ?? 0).toLocaleString()} px`
              : `a scroll down ${Math.abs(step?.scroll ?? 0).toLocaleString()} px`;
      setNotice(`Added step ${added + 1}: ${label}`);
      showCard(added + 1);
    }
    setMenuKey((count) => count + 1);
  };

  const endSegment = segments[plan.steps.length];
  const endStart = endSegment?.start ?? total;
  const stepCount = plan.steps.length;

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <span>
          {stepCount} steps · {seconds(planDuration(played))} s
        </span>
        <span className={styles.muted}>Page {page.height.toLocaleString()} px</span>
      </div>

      <Select
        key={menuKey}
        name="Plan"
        onValueChange={runAction}
        options={ACTION_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
        showLabel={false}
        unlistedValueLabel="Add to scroll step"
        value="__menu"
      />
      {notice !== null ? <div className={styles.notice}>{notice}</div> : null}

      <section aria-label="Scroll settings" className={styles.settingsGroup}>
        <Button
          aria-expanded={scrollSettingsOpen}
          className={styles.settingsToggle}
          onClick={() => setScrollSettingsOpen((open) => !open)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span>Scroll settings</span>
          <CaretDown aria-hidden="true" className={scrollSettingsOpen ? "" : styles.settingsCaretClosed} size={14} />
        </Button>
        {scrollSettingsOpen ? (
          <div className={styles.settingsBody}>
            <div className={styles.easing}>
              <div className={styles.easingSelect}>
                <Select
                  name="Easing"
                  onValueChange={(next) => {
                    const easing = readEasing(next);
                    if (easing) commit({ ...plan, easing });
                  }}
                  options={EASING_OPTIONS}
                  value={plan.easing}
                />
              </div>
              <Curve custom={plan.customEasing} id={plan.easing} />
            </div>
            {plan.easing === "custom" ? <CurveInput onCommit={(text) => commit({ ...plan, customEasing: text })} value={plan.customEasing} /> : null}

            <div className={styles.easing}>
              <div className={styles.easingSelect}>
                <Select
                  name="2nd At easing"
                  onValueChange={(next) => {
                    const easing = readEasing(next);
                    if (easing) commit({ ...plan, secondEasing: easing });
                  }}
                  options={EASING_OPTIONS}
                  value={plan.secondEasing}
                />
              </div>
              <Curve custom={plan.secondCustomEasing} id={plan.secondEasing} />
            </div>
            {plan.secondEasing === "custom" ? <CurveInput onCommit={(text) => commit({ ...plan, secondCustomEasing: text })} value={plan.secondCustomEasing} /> : null}

            <div className={styles.blur} title="Motion blur while the page scrolls: a smear along the scroll, longer the faster it moves. 0 is off. Preview off hides it on the canvas only; a render always has it.">
              <NumberField
                makePlan={(next) => withBlur(plan, { amount: next })}
                max={100}
                name="Motion blur (0 = off)"
                onCommit={(next) => commit(withBlur(plan, { amount: next }))}
                step={5}
                value={plan.blur.amount}
                whole
              />
              <Switch checked={plan.blur.preview} name="Preview blur" onCheckedChange={(next) => commit(withBlur(plan, { preview: next }))} />
            </div>
          </div>
        ) : null}
      </section>

      <div className={styles.stack} data-mark-drag={markDrag ? "" : undefined}>
        <RailCard
          dragging={markDrag}
          onMarkDown={startMarkDrag}
          active={now.loading !== null}
          dot="S"
          index={0}
          first
          looped={loopKeys.includes(START_KEY)}
          marks={marksFor(0, plan.loading)}
          onScrub={scrubFree}
          onSelect={pick("loading", plan.loading / 2)}
          onToggle={toggle(START_KEY)}
          range={[0, plan.loading]}
          selected={selected === "loading"}
        >
          <div className={styles.rowHead}>
            <span
              className={`${styles.rowName} ${styles.rowNameToggle}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleFold("__start");
              }}
              title="Click to collapse or expand"
            >
              Start
            </span>
            <span className={styles.muted}>{plan.start.length > 0 ? `${seconds(plan.loading)} s · 0 s` : "none"}</span>
            <Button
              aria-expanded={!isFolded("__start")}
              aria-label={isFolded("__start") ? "Expand Start" : "Collapse Start"}
              onClick={(event) => {
                event.stopPropagation();
                toggleFold("__start");
              }}
              size="icon-xs"
              title={isFolded("__start") ? "Expand this card" : "Collapse this card"}
              type="button"
              variant="ghost"
            >
              {isFolded("__start") ? <CaretRight /> : <CaretDown />}
            </Button>
          </div>
          {isFolded("__start") ? null : (
          <>
          {plan.start.map((part, partIndex) => (
            <div className={styles.startPart} key={part.id}>
              <div className={styles.rowHead}>
                <span className={styles.rowName}>{`Part ${partIndex + 1}`}</span>
                <Button aria-label={`Remove part ${partIndex + 1} of the Start`} onClick={() => commit(withStart(plan, plan.start.filter((item) => item.id !== part.id)))} size="icon-xs" type="button" variant="ghost">
                  <X />
                </Button>
              </div>
              <div className={styles.fields2}>
                <NumberField
                  makePlan={(next) => withStart(plan, plan.start.map((item) => (item.id === part.id ? { ...item, duration: next } : item)))}
                  max={10}
                  name="Duration (s)"
                  onCommit={(next) => editPart(part.id, { duration: next })}
                  step={0.1}
                  value={part.duration}
                />
                <Select
                  name="Preset"
                  onValueChange={(next) => {
                    const preset = readStartPreset(next);
                    if (preset) editPart(part.id, { preset });
                  }}
                  options={START_OPTIONS}
                  value={part.preset}
                />
              </div>
              {isPreloader(part.preset) ? (
                <div className={styles.colorRow}>
                  <span className={styles.colorLabel}>Color</span>
                  <Color hex={part.color} name="Start color" onValueChange={(next) => editPart(part.id, { color: next.hex.toUpperCase() })} showLabel={false} />
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => commit(withStart(plan, [...plan.start, newStartPart(plan)]))} size="default" title="Add another part to the Start: a still thumbnail of the page top, a preloader, an intro transition" type="button" variant="ghost">
            + Add a part
          </Button>
          </>
          )}
        </RailCard>

        {plan.steps.map((step, index) => {
          const segment = segments[index];
          const own = stepEasing(plan, step);
          return (
            <RailCard
          dragging={markDrag}
          onMarkDown={startMarkDrag}
              active={now.loading === null && index === now.step}
              dot={step.kind === "reload" ? "R" : `${index + 1}`}
              index={index + 1}
              key={step.id}
              looped={loopKeys.includes(step.id)}
              marks={segment ? marksFor(segment.start, segment.end) : []}
              onScrub={scrubFree}
              onSelect={pick(index, segment ? Math.max(segment.start, segment.end - 0.02) : 0)}
              onToggle={toggle(step.id)}
              range={[segment?.start ?? 0, segment?.end ?? 0]}
              selected={selected === index}
            >
              <div className={isFolded(step.id) ? `${styles.rowHead} ${styles.rowHeadFolded}` : styles.rowHead}>
                <EditableName
                  fallback={`${step.kind === "reload" ? "Reload Step" : "Scroll Step"} ${String(index + 1).padStart(2, "0")}`}
                  onClick={() => toggleFold(step.id)}
                  onCommit={(name) => commit(replaceStep(plan, index, { name }))}
                  value={step.name ?? ""}
                />
                <span className={styles.muted}>{segment ? (isFolded(step.id) ? `${seconds(segment.start)} s · Hold ${seconds(step.pause)} s` : `${seconds(segment.start)} s`) : ""}</span>
                <Button
                  aria-expanded={!isFolded(step.id)}
                  aria-label={isFolded(step.id) ? `Expand step ${index + 1}` : `Collapse step ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFold(step.id);
                  }}
                  size="icon-xs"
                  title={isFolded(step.id) ? "Expand this step" : "Collapse this step"}
                  type="button"
                  variant="ghost"
                >
                  {isFolded(step.id) ? <CaretRight /> : <CaretDown />}
                </Button>
                <span
                  className={styles.grip}
                  onPointerDown={(event) => startDrag(event, index)}
                  role="presentation"
                  title="Drag to move this step. Select it and use the Up / Down arrow keys too"
                >
                  <DotsSixVertical />
                </span>
                <Button aria-label={`Duplicate step ${index + 1}`} onClick={() => duplicate(index)} size="icon-xs" title="Duplicate this step" type="button" variant="ghost">
                  <Copy />
                </Button>
                <Button aria-label={`Remove step ${index + 1}`} onClick={() => commit(removeStep(plan, index, max))} size="icon-xs" type="button" variant="ghost">
                  <X />
                </Button>
              </div>
              {isFolded(step.id) ? null : (
              <>
              <div className={step.kind === "scroll" ? styles.fields2 : styles.fields}>
                {step.kind === "scroll" ? (
                  <>
                    <NumberField
                      makePlan={(next) => replaceStep(plan, index, { scroll: next })}
                      max={max - (index > 0 ? (segments[index - 1]?.final ?? 0) : 0)}
                      min={-(index > 0 ? (segments[index - 1]?.final ?? 0) : 0)}
                      name="Scroll At (px)"
                      onCommit={(next) => edit(index, { scroll: next })}
                      onEdit={(edited) => followStep(edited, index, "first")}
                      onFocusField={() => showStepMoment(segment, "first")}
                      step={1}
                      value={Math.round(step.scroll)}
                      whole
                    />
                    <NumberField
                      makePlan={(next) => replaceStep(plan, index, { travel: next })}
                      max={60}
                      name="Scroll time (s)"
                      onCommit={(next) => edit(index, { travel: next })}
                      onEdit={(edited) => followStep(edited, index, "first")}
                      onFocusField={() => showStepMoment(segment, "first")}
                      step={0.1}
                      value={step.travel}
                    />
                  </>
                ) : null}
              </div>
              {animatedSections.length > 0 || step.waitFor ? (
                <div className={styles.waitRow}>
                  <Select
                    name="Reveal section"
                    onValueChange={(next) => commit(replaceStep(plan, index, { waitFor: next === NO_WAIT ? null : next }))}
                    options={[
                      { label: "None", value: NO_WAIT },
                      ...[...new Set([...animatedSections, ...(step.waitFor ? [step.waitFor] : [])])].map((name) => ({ label: `${motions[name]?.label ?? name} animation`, value: name })),
                    ]}
                    value={step.waitFor ?? NO_WAIT}
                  />
                  {step.waitFor && (played.steps[index]?.pause ?? step.pause) > step.pause + 0.001 ? (
                    <span className={styles.muted}>{`Hold starts after it ends: +${seconds((played.steps[index]?.pause ?? step.pause) - step.pause)} s`}</span>
                  ) : null}
                </div>
              ) : null}
              {step.kind === "scroll" ? (
                <>
                  <div className={styles.stepEasing}>
                    <div className={styles.easingSelect}>
                      <Select
                        name="Easing"
                        onValueChange={(next) => {
                          const easing = next === "plan" ? "plan" : readEasing(next);
                          if (easing) commit(replaceStep(plan, index, { easing }));
                        }}
                        options={STEP_EASING_OPTIONS}
                        showLabel={false}
                        value={step.easing ?? "plan"}
                      />
                    </div>
                    <Curve custom={own.custom} id={own.id} />
                  </div>
                  {step.easing === "custom" ? (
                    <CurveInput onCommit={(text) => commit(replaceStep(plan, index, { customEasing: text }))} value={step.customEasing ?? plan.customEasing ?? DEFAULT_CUSTOM_EASING} />
                  ) : null}
                  {step.second ? (
                    <div className={styles.second}>
                      <div className={styles.rowHead}>
                        <span className={styles.rowName}>2nd At</span>
                        <span className={styles.muted}>follows this step</span>
                        <Button aria-label={`Remove the 2nd At of step ${index + 1}`} onClick={() => commit(replaceStep(plan, index, { second: null }))} size="icon-xs" type="button" variant="ghost">
                          <X />
                        </Button>
                      </div>
                      <div className={styles.fields}>
                        <NumberField
                          makePlan={(next) => replaceStep(plan, index, { second: { ...step.second!, offset: next } })}
                          max={max - (segment?.to ?? 0)}
                          min={-(segment?.to ?? 0)}
                          name="Scroll At (px)"
                          onCommit={(next) => editSecond(index, step, { offset: next })}
                          onEdit={(edited) => followStep(edited, index, "second")}
                          onFocusField={() => showStepMoment(segment, "second")}
                          step={1}
                          value={Math.round(step.second.offset)}
                          whole
                        />
                        <NumberField
                          makePlan={(next) => replaceStep(plan, index, { second: { ...step.second!, travel: next } })}
                          max={60}
                          name="Scroll time (s)"
                          onCommit={(next) => editSecond(index, step, { travel: next })}
                          onEdit={(edited) => followStep(edited, index, "second")}
                          onFocusField={() => showStepMoment(segment, "second")}
                          step={0.1}
                          value={step.second.travel}
                        />
                        <NumberField
                          makePlan={(next) => replaceStep(plan, index, { second: { ...step.second!, delay: next } })}
                          max={60}
                          name="Delay (s)"
                          onCommit={(next) => editSecond(index, step, { delay: next })}
                          onEdit={(edited) => followStep(edited, index, "secondStart")}
                          onFocusField={() => showStepMoment(segment, "secondStart")}
                          step={0.1}
                          value={step.second.delay}
                        />
                      </div>
                      <div className={styles.stepEasing}>
                        <div className={styles.easingSelect}>
                          <Select
                            name="Easing"
                            onValueChange={(next) => {
                              const easing = next === "plan" ? "plan" : readEasing(next);
                              if (easing) editSecond(index, step, { easing });
                            }}
                            options={SECOND_EASING_OPTIONS}
                            showLabel={false}
                            value={step.second.easing}
                          />
                        </div>
                        <Curve custom={step.second.customEasing ?? plan.secondCustomEasing} id={step.second.easing === "plan" ? plan.secondEasing : step.second.easing} />
                      </div>
                      {step.second.easing === "custom" ? (
                        <CurveInput onCommit={(text) => editSecond(index, step, { customEasing: text })} value={step.second.customEasing ?? plan.secondCustomEasing ?? DEFAULT_CUSTOM_EASING} />
                      ) : null}
                    </div>
                  ) : (
                    <Button onClick={() => commit(replaceStep(plan, index, { second: { delay: 0.3, easing: "plan", offset: 0, travel: Math.max(0.4, step.travel) } }))} className={styles.addSecond} size="sm" title="Add a second scroll nested in this step: it starts after a delay, overlapping the first, and follows this step" type="button" variant="ghost">
                      + 2nd At
                    </Button>
                  )}
                  <div className={styles.percent}>
                    {`Lands at ${Math.round(segment?.final ?? 0).toLocaleString()} px · ${max > 0 ? Math.round(((segment?.final ?? 0) / max) * 100) : 0}% step down`}
                    {segment ? ` · Total ${seconds(segment.end - segment.start - step.pause)} s` : ""}
                  </div>
                </>
              ) : null}
              </>
              )}
            </RailCard>
          );
        })}

        <RailCard
          dragging={markDrag}
          onMarkDown={startMarkDrag}
          active={now.loading === null && now.step === stepCount}
          dot="E"
          index={stepCount + 1}
          last
          looped={loopKeys.includes(END_KEY)}
          marks={endSegment ? marksFor(endSegment.start, endSegment.end) : []}
          onScrub={scrubFree}
          onSelect={pick("end", endSegment ? endSegment.start + 0.01 : total)}
          onToggle={toggle(END_KEY)}
          range={[endSegment?.start ?? total, endSegment?.end ?? total]}
          selected={selected === "end"}
        >
          <div className={styles.rowHead}>
            <span
              className={`${styles.rowName} ${styles.rowNameToggle}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleFold("__end");
              }}
              title="Click to collapse or expand"
            >
              End
            </span>
            <span className={styles.muted}>{seconds(endStart)} s</span>
            <Button
              aria-expanded={!isFolded("__end")}
              aria-label={isFolded("__end") ? "Expand End" : "Collapse End"}
              onClick={(event) => {
                event.stopPropagation();
                toggleFold("__end");
              }}
              size="icon-xs"
              title={isFolded("__end") ? "Expand this card" : "Collapse this card"}
              type="button"
              variant="ghost"
            >
              {isFolded("__end") ? <CaretRight /> : <CaretDown />}
            </Button>
          </div>
          {isFolded("__end") ? null : (
          <>
          <Select
            name="Ending"
            onValueChange={(next) => {
              const mode = END_OPTIONS.find((option) => option.value === next);
              if (mode) commit({ ...plan, end: { ...plan.end, hold: mode.value !== "hold" && plan.end.hold === 0 ? 0.5 : plan.end.hold, mode: mode.value } });
            }}
            options={END_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            value={plan.end.mode}
          />
          <div className={styles.fields2}>
            {plan.end.mode === "top" ? (
              <NumberField
                makePlan={(next) => ({ ...plan, end: { ...plan.end, travel: next } })}
                max={60}
                name="Duration (s)"
                onCommit={(next) => commit({ ...plan, end: { ...plan.end, travel: next } })}
                step={0.1}
                value={plan.end.travel}
              />
            ) : null}
            <NumberField
              makePlan={(next) => ({ ...plan, end: { ...plan.end, hold: next } })}
              max={60}
              name="Hold (s)"
              onCommit={(next) => commit({ ...plan, end: { ...plan.end, hold: next } })}
              step={0.1}
              value={plan.end.hold}
            />
          </div>
          </>
          )}
        </RailCard>
      </div>
    </div>
  );
}
