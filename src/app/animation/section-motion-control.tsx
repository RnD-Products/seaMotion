import { CaretDown, Copy, DotsSixVertical, Eye, EyeSlash, Plus, X } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FieldDescription, Select, Switch, TextInput } from "@/toolcraft/ui";

import { getActiveAnimation } from "./animation-spec";
import {
  DEFAULT_STAGGER,
  EMPTY_MOTION,
  itemOffsets,
  LANDING_SECTIONS_TARGET,
  MOTION_EASINGS,
  motionRange,
  moveMotionItem,
  newMotionItem,
  readSectionMotions,
  withWaits,
  type MotionItem,
  type MotionLoop,
  type MotionSlide,
  type SectionMotion,
} from "./landing-motion";
import { buildSegments, duplicateSectionPresetStep, effectivePlan, evaluateExpression, LANDING_PLAN_TARGET, maxScroll, readLandingPlan, removeStep, replaceStep } from "./landing-plan";
import { clearLoopSegments, layerMotionLoopKey, loopRanges, nextLoopTime, pickLoopSegment, sectionWorkRange, setEditingSectionLoop, useEditingSectionLoop, useLoopSelection } from "./landing-loop";
import { RailCard } from "./scroll-plan-control";
import railStyles from "./scroll-plan-control.module.css";
import styles from "./section-motion-control.module.css";

const SLIDE_OPTIONS: readonly { label: string; value: MotionSlide }[] = [
  { label: "No slide", value: "none" },
  { label: "From bottom", value: "bottom" },
  { label: "From top", value: "top" },
  { label: "From left", value: "left" },
  { label: "From right", value: "right" },
];
const LOOP_OPTIONS: readonly { label: string; value: MotionLoop }[] = [
  { label: "No loop", value: "none" },
  { label: "Float", value: "float" },
  { label: "Rotate", value: "rotate" },
  { label: "Float + rotate", value: "floatRotate" },
  { label: "Pulse", value: "pulse" },
];
const TRIGGER_OPTIONS = [
  { label: "After the Start", value: "start" },
  { label: "When it comes into view", value: "view" },
];

const round = (value: number): number => Math.round(value * 100) / 100;

// A number that takes sums on Enter or blur.
function Num({ min = 0, max = 1000, name, onCommit, value }: { max?: number; min?: number; name: string; onCommit: (next: number) => void; value: number }): React.ReactNode {
  return (
    <TextInput
      commitOnBlur
      name={name}
      onValueChange={(text) => {
        const next = evaluateExpression(text, value);
        if (next !== null) onCommit(round(Math.min(max, Math.max(min, next))));
      }}
      value={`${round(value)}`}
    />
  );
}

// A card's name: double-click to rename. Clearing it (or typing the layer's own name) goes back to the layer's name.
function CardName({ fallback, onCommit, value }: { fallback: string; onCommit: (name: string) => void; value: string }): React.ReactNode {
  const [editing, setEditing] = React.useState(false);
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
          name="Name"
          onValueChange={(next) => {
            const text = next.trim().slice(0, 60);
            onCommit(text === fallback ? "" : text);
            setEditing(false);
          }}
          showLabel={false}
          value={value || fallback}
        />
      </div>
    );
  }
  return (
    <span className={styles.cardName} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      {value || fallback}
    </span>
  );
}

type Leaf = Readonly<{ id: string; name: string }>;

// The layers of the Hero as the design names them, in the order they move in (see the preset below).
const HERO_PRESET: readonly { name: string; patch: Partial<MotionItem> }[] = [
  { name: "image 4", patch: { duration: 1.2 } },
  { name: "Shape", patch: { blur: 14, distance: 60, duration: 1, scale: 85, slide: "bottom" } },
  { name: "Nav", patch: { distance: 60, slide: "top" } },
  { name: "A financial modeling agency", patch: { blur: 10, distance: 40, slide: "bottom" } },
  { name: "with a", patch: { blur: 10, distance: 40, slide: "bottom" } },
  { name: "twist", patch: { blur: 10, distance: 40, slide: "bottom", withPrevious: true } },
  { name: "Frame 1000003862", patch: { loop: "floatRotate", scale: 70 } },
  { name: "Financial Modeling Plans", patch: { blur: 8, distance: 30, slide: "bottom" } },
  { name: "Frame 1686557592", patch: { blur: 8, distance: 30, slide: "bottom" } },
  { name: "Ellipse 172", patch: { blur: 8, distance: 30, loop: "pulse", slide: "bottom", withPrevious: true } },
  { name: "Ellipse 173", patch: { blur: 8, distance: 30, loop: "pulse", slide: "bottom", withPrevious: true } },
  { name: "Ellipse 174", patch: { blur: 8, distance: 30, loop: "pulse", slide: "bottom", withPrevious: true } },
  { name: "Available Now", patch: { blur: 8, distance: 30, slide: "bottom", withPrevious: true } },
];

function heroPreset(leaves: readonly Leaf[]): MotionItem[] {
  const items: MotionItem[] = [];
  for (const entry of HERO_PRESET) {
    const leaf = leaves.find((item) => item.name.startsWith(entry.name));
    if (leaf) items.push(newMotionItem(leaf.id, entry.patch));
  }
  return items;
}

// Saved values are plain data: a key set to undefined (a cleared name or label) is left out, not stored.
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function SectionMotionControl({ dispatch, setValue, state, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  const page = spec?.page;
  const motions = React.useMemo(() => readSectionMotions(value), [value]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [pickedOtherHold, setPickedOtherHold] = React.useState<string | null>(null);
  const [pickedLayer, setPickedLayer] = React.useState<string | null>(null);
  const [markDrag, setMarkDrag] = React.useState(false);
  const loopKeys = useLoopSelection();
  const editingSectionLoop = useEditingSectionLoop();
  const [renaming, setRenaming] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const renameBox = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!renaming) return;
    const input = renameBox.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [renaming]);
  if (!page || page.sections.length === 0) return <FieldDescription>Import a page to animate its sections.</FieldDescription>;
  // A section's own animation, then the copies made of it (each saved under its own key, pointing at the section).
  const slots: { copy: boolean; host: (typeof page.sections)[number]; key: string }[] = [];
  for (const host of page.sections) {
    slots.push({ copy: false, host, key: host.name });
    for (const [key, other] of Object.entries(motions)) if (other.section === host.name && key !== host.name) slots.push({ copy: true, host, key });
  }
  const plan = effectivePlan(readLandingPlan(state.values[LANDING_PLAN_TARGET]), page);
  const played = withWaits(plan, page, motions);
  const { segments, total: planTotal } = buildSegments(played, maxScroll(page));
  const time = state.timeline.currentTimeSeconds;
  const slot = slots.find((item) => item.key === picked) ?? slots[0]!;
  const section = slot.host;
  const motion = motions[slot.key] ?? EMPTY_MOTION;
  const linkedHolds = plan.steps.map((step, index) => ({ index, step })).filter(({ step }) => step.waitFor === slot.key);
  const otherHolds = plan.steps.map((step, index) => ({ index, step })).filter(({ step }) => !step.waitFor || !slots.some((item) => item.key === step.waitFor));
  const otherHold = otherHolds.find(({ step }) => step.id === pickedOtherHold) ?? otherHolds[0];
  const stepDuration = (index: number): number => round(Math.max(0, (segments[index]?.end ?? 0) - (segments[index]?.start ?? 0)));
  const changeHold = (index: number, pause: number): void => {
    dispatch({ label: "Change section hold", target: LANDING_PLAN_TARGET, type: "controls.setValue", value: replaceStep(plan, index, { pause }) });
  };

  // The layers inside this section's group, found through the Layers panel's tree.
  const byParent = new Map<string, typeof state.layers>();
  const layerById = new Map<string, typeof state.layers[number]>();
  for (const layer of state.layers) {
    layerById.set(layer.id, layer);
    if (!layer.parentGroupId) continue;
    byParent.set(layer.parentGroupId, [...(byParent.get(layer.parentGroupId) ?? []), layer]);
  }
  const leaves: Leaf[] = [];
  // Groups inside the section (like a renamed "button"), each with the layers under it, in tree order.
  const groups: { id: string; leafIds: string[]; name: string }[] = [];
  const entries: { id: string; name: string; group: boolean }[] = [];
  const walk = (id: string, into: string[][]): void => {
    for (const child of byParent.get(id) ?? []) {
      const name = child.displayName ?? child.name;
      if (child.kind === "group") {
        const own: string[] = [];
        const group = { id: child.id, leafIds: own, name };
        groups.push(group);
        entries.push({ group: true, id: child.id, name });
        walk(child.id, [...into, own]);
      } else {
        leaves.push({ id: child.id, name });
        entries.push({ group: false, id: child.id, name });
        for (const list of into) list.push(child.id);
      }
    }
  };
  walk(section.id, []);
  const nameOf = (id: string): string => leaves.find((leaf) => leaf.id === id)?.name ?? id;

  // A section renamed in the Layers panel shows its new name; the motion stays saved under the original one.
  const sectionLabel = (item: { id: string; name: string }): string => motions[item.name]?.label ?? state.layers.find((layer) => layer.id === item.id)?.displayName ?? item.name;
  const slotLabel = (item: (typeof slots)[number]): string => motions[item.key]?.label ?? (item.copy ? item.key : sectionLabel(item.host));
  // The layers (not groups) under a section, in the Layers panel's order.
  const leavesUnder = (sectionId: string): string[] => {
    const found: string[] = [];
    const visit = (id: string): void => {
      for (const child of byParent.get(id) ?? []) {
        if (child.kind === "group") visit(child.id);
        else found.push(child.id);
      }
    };
    visit(sectionId);
    return found;
  };
  // A copy of an animation: its own entry for the same section, with the same cards (new ids), to edit on its own.
  const duplicate = (item: (typeof slots)[number]): void => {
    const source = motions[item.key];
    if (!source) return;
    const base = `${slotLabel(item)} copy`;
    let key = base;
    for (let n = 2; Object.hasOwn(motions, key); n += 1) key = `${base} ${n}`;
    const items = source.items.map((card) => newMotionItem(card.layer, { blur: card.blur, delay: card.delay, distance: card.distance, duration: card.duration, easing: card.easing, fade: card.fade, loop: card.loop, scale: card.scale, slide: card.slide, withPrevious: card.withPrevious, ...(card.name ? { name: card.name } : {}) }));
    dispatch({ label: "Duplicate animation preset step", target: LANDING_PLAN_TARGET, type: "controls.setValue", value: duplicateSectionPresetStep(plan, page, item.key, key, item.host.name) });
    dispatch({ label: "Duplicate animation", target: LANDING_SECTIONS_TARGET, type: "controls.setValue", value: plain({ ...motions, [key]: { ...source, items, label: undefined, section: item.host.name } }) });
    setPicked(key);
    setPickedLayer(null);
    if (editingSectionLoop !== null) setEditingSectionLoop(key);
  };
  const deleteAnimation = (item: (typeof slots)[number]): void => {
    const { [item.key]: _gone, ...rest } = motions;
    setValue(rest);
    const stepIndex = plan.steps.findIndex((step) => step.waitFor === item.key);
    if (stepIndex >= 0) {
      const next = item.copy
        ? removeStep(plan, stepIndex, maxScroll(page))
        : { ...plan, steps: plan.steps.map((step, index) => index === stepIndex ? { ...step, waitFor: null } : step) };
      dispatch({ label: "Remove animation preset step", target: LANDING_PLAN_TARGET, type: "controls.setValue", value: next });
    }
    if (picked === item.key) setPicked(item.host.name);
    if (editingSectionLoop === item.key) setEditingSectionLoop(null);
  };
  // A new, empty animation entry for the section now open; its section can be changed, then layers added.
  const createAnimation = (): void => {
    let key = "New animation";
    for (let n = 2; Object.hasOwn(motions, key); n += 1) key = `New animation ${n}`;
    setValue({ ...motions, [key]: { delay: 0, enabled: true, items: [], section: section.name, stagger: DEFAULT_STAGGER, trigger: "view" } });
    setPicked(key);
    setPickedLayer(null);
    if (editingSectionLoop !== null) setEditingSectionLoop(null);
  };
  const commit = (next: SectionMotion): void => setValue(plain({ ...motions, [slot.key]: next }));
  const edit = (index: number, patch: Partial<MotionItem>): void => commit({ ...motion, items: motion.items.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
  const unused = leaves.find((leaf) => !motion.items.some((item) => item.layer === leaf.id));
  const selectedLayer = motion.items.some((item) => item.id === pickedLayer) ? pickedLayer : null;

  const rangeFor = (key: string): readonly [number, number] | null => {
    const candidate = motions[key];
    return candidate ? motionRange(key, candidate, played, page, planTotal, segments) : null;
  };
  const sectionRange = sectionWorkRange(slot.key, played, motions, page, planTotal, segments);
  const animationRange = rangeFor(slot.key);
  const offsets = itemOffsets(motion);
  const layerRanges = motion.items.map((item, index): readonly [number, number] | null => {
    if (!animationRange) return null;
    const start = animationRange[0] + (offsets[index] ?? 0);
    return [start, start + item.duration];
  });
  const layerRangeFor = (itemId: string): readonly [number, number] | null => layerRanges[motion.items.findIndex((item) => item.id === itemId)] ?? null;
  // Overlapping entries share one playhead. It advances to the most recently
  // started card and stays there until the preset animation ends.
  const playheadLayerIndex = animationRange && time >= animationRange[0] && time < animationRange[1]
    ? layerRanges.reduce((best, range, index) => range && time >= range[0] && (best < 0 || range[0] >= (layerRanges[best]?.[0] ?? 0)) ? index : best, -1)
    : -1;
  const scrub = (at: number): void => dispatch({ currentTimeSeconds: Math.min(planTotal, Math.max(0, at)), type: "timeline.setCurrentTime" });
  const toggleLayer = (itemId: string): void => {
    if (selectedLayer === itemId) {
      setPickedLayer(null);
      return;
    }
    setPickedLayer(itemId);
    scrub(layerRangeFor(itemId)?.[0] ?? rangeFor(slot.key)?.[0] ?? 0);
  };
  const chooseSection = (key: string): void => {
    setPicked(key);
    setPickedLayer(null);
    if (editingSectionLoop === null) return;
    const range = sectionWorkRange(key, played, motions, page, planTotal, segments);
    setEditingSectionLoop(range ? key : null);
    if (range) scrub(range[0]);
  };
  const scrubFree = (at: number): void => {
    scrub(at);
    if (loopKeys.length > 0 && nextLoopTime(loopRanges(played, loopKeys, motions, page, planTotal), at) !== null) clearLoopSegments();
  };
  const reorderLayer = (from: number, to: number): void => {
    const next = moveMotionItem(motion, from, to);
    if (next === motion) return;
    commit(next);
  };
  const startLayerDrag = (event: React.PointerEvent<HTMLElement>, from: number): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.parentElement;
    if (!header) return;
    const original = header.getBoundingClientRect();
    const ghost = header.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, { left: `${original.left}px`, opacity: "0.85", pointerEvents: "none", position: "fixed", top: `${original.top}px`, transform: "scale(0.7)", transformOrigin: "top left", width: `${original.width}px`, zIndex: "1000" });
    const guide = document.createElement("div");
    Object.assign(guide.style, { background: "var(--accent)", display: "none", height: "3px", pointerEvents: "none", position: "fixed", zIndex: "999" });
    document.body.append(ghost, guide);
    header.style.opacity = "0.35";
    let destination: number | null = null;
    const onMove = (move: PointerEvent): void => {
      ghost.style.transform = `translate(${move.clientX - event.clientX}px, ${move.clientY - event.clientY}px) scale(0.7)`;
      const under = document.elementFromPoint(move.clientX, move.clientY)?.closest<HTMLElement>("[data-layer-card]");
      destination = under ? Number(under.dataset.layerIndex) : null;
      if (under && destination !== null && Number.isInteger(destination) && destination !== from) {
        const rect = under.getBoundingClientRect();
        Object.assign(guide.style, { display: "block", left: `${rect.left}px`, top: `${(destination < from ? rect.top : rect.bottom) - 1.5}px`, width: `${rect.width}px` });
      } else guide.style.display = "none";
    };
    const onEnd = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
      ghost.remove();
      guide.remove();
      header.style.opacity = "";
      if (destination !== null && Number.isInteger(destination)) reorderLayer(from, destination);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  };
  const startLayerMarkDrag = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setMarkDrag(true);
    const move = (pointer: PointerEvent): void => {
      for (const card of document.querySelectorAll<HTMLElement>("[data-layer-card]")) {
        const item = motion.items[Number(card.dataset.layerIndex)];
        const range = item ? layerRangeFor(item.id) : null;
        const rail = card.firstElementChild?.getBoundingClientRect();
        if (!range || !rail || pointer.clientY < rail.top || pointer.clientY > rail.bottom) continue;
        const fraction = Math.min(1, Math.max(0, (pointer.clientY - rail.top - 14) / Math.max(1, rail.height - 14)));
        scrubFree(range[0] + fraction * (range[1] - range[0]));
        break;
      }
    };
    const end = (pointer: PointerEvent): void => {
      if (pointer.type === "pointerup") move(pointer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setMarkDrag(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const selectedEditor = (
    <div className={styles.selectedEditor}>
      {slot.copy ? (
        <Select
          name="Section"
          onValueChange={(next) => commit({ ...motion, items: next === section.name ? motion.items : [], section: next })}
          options={page.sections.map((item) => ({ label: sectionLabel(item), value: item.name }))}
          value={section.name}
        />
      ) : null}
      <section aria-label="Animation settings" className={railStyles.settingsGroup}>
        <Button
          aria-expanded={settingsOpen}
          className={railStyles.settingsToggle}
          onClick={() => setSettingsOpen((open) => !open)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span>Animation settings</span>
          <CaretDown aria-hidden="true" className={settingsOpen ? "" : railStyles.settingsCaretClosed} size={14} />
        </Button>
        {settingsOpen ? (
          <div className={railStyles.settingsBody}>
      <div className={styles.row}>
        <Switch checked={motion.enabled} name="Entry motion" onCheckedChange={(next) => commit({ ...motion, enabled: next })} />
        <Select name="Starts" onValueChange={(next) => commit({ ...motion, trigger: next === "view" ? "view" : "start" })} options={TRIGGER_OPTIONS} value={motion.trigger} />
      </div>
      <div className={styles.row}>
        <Num max={5} name="Stagger (s)" onCommit={(next) => commit({ ...motion, stagger: next })} value={motion.stagger} />
        <Num max={60} name="Master delay (s)" onCommit={(next) => commit({ ...motion, delay: next })} value={motion.delay} />
      </div>
      {linkedHolds.map(({ index, step }) => (
        <div className={styles.holdGroup} key={step.id}>
          <div className={styles.row}>
            <Num max={60} name={linkedHolds.length === 1 ? "Hold (s)" : `Hold step ${index + 1} (s)`} onCommit={(next) => changeHold(index, next)} value={step.pause} />
            <TextInput disabled name="Total duration (s)" value={`${stepDuration(index)}`} />
          </div>
          <FieldDescription>{step.name || `Scroll step ${index + 1}`} · Hold starts at {round((segments[index]?.end ?? 0) - step.pause)} s, after animation and scroll</FieldDescription>
        </div>
      ))}
      {linkedHolds.length === 0 ? <FieldDescription>Link a step to this animation with “Reveal section” in Scroll Plan to set its Hold here.</FieldDescription> : null}
      {otherHold ? (
        <div className={styles.holdGroup}>
          <Select
            name="Other scroll step"
            onValueChange={setPickedOtherHold}
            options={otherHolds.map(({ index, step }) => ({ label: step.name || `${step.kind === "reload" ? "Reload" : "Scroll"} step ${index + 1}`, value: step.id }))}
            value={otherHold.step.id}
          />
          <div className={styles.row}>
            <Num max={60} name="Other step hold (s)" onCommit={(next) => changeHold(otherHold.index, next)} value={otherHold.step.pause} />
            <TextInput disabled name="Total duration (s)" value={`${stepDuration(otherHold.index)}`} />
          </div>
        </div>
      ) : null}
      {section.name === "Hero" ? (
        <Button
          onClick={() => commit({ ...motion, enabled: true, items: heroPreset(leaves), stagger: 0.05, trigger: "start" })}
          size="default"
          title="Sets the Hero's entry: background fades in, shape, heading lines, cycle, sub text, button and Available Now move in, with loops"
          type="button"
          variant="ghost"
        >
          Hero preset
        </Button>
      ) : null}
          </div>
        ) : null}
      </section>
      <div className={railStyles.stack} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if ((event.target as HTMLElement).closest("input, textarea, select, [role=combobox], [role=listbox], [contenteditable=true]")) return;
        const from = motion.items.findIndex((item) => item.id === selectedLayer);
        const to = from + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= motion.items.length) return;
        event.preventDefault();
        event.stopPropagation();
        reorderLayer(from, to);
      }}>
        {motion.items.map((item, index) => {
          const range = layerRanges[index];
          const loopKey = layerMotionLoopKey(slot.key, item.id);
          const chosen = item.id === selectedLayer;
          const targetLayer = layerById.get(item.layer);
          const targetName = nameOf(item.layer);
          return (
          <RailCard
            active={range !== null && time >= range[0] && time < range[1]}
            dot={`${index + 1}`}
            dragging={markDrag}
            index={index}
            key={item.id}
            last={index === motion.items.length - 1}
            looped={loopKeys.includes(loopKey)}
            marks={index === playheadLayerIndex && range ? [{ at: (time - range[0]) / Math.max(0.001, range[1] - range[0]), kind: "now", title: `${time.toFixed(2)} s` }] : []}
            onMarkDown={startLayerMarkDrag}
            onScrub={(at) => range && scrubFree(at)}
            onSelect={(event) => {
              if ((event.target as HTMLElement).closest("[data-layer-body], input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
              toggleLayer(item.id);
            }}
            onToggle={(_at, additive) => {
              if (!range) return;
              pickLoopSegment(loopKey, additive);
              scrub(Math.max(range[0], range[1] - 0.02));
            }}
            range={range ?? [0, 0]}
            scope="layer"
            selected={chosen}
          >
          <div className={styles.layerHead}>
            <Button aria-expanded={chosen} className={styles.presetNameButton} onClick={() => toggleLayer(item.id)} size="sm" title={chosen ? "Collapse layer settings" : "Expand layer settings"} type="button" variant="ghost"><span className={styles.cardName}>{item.name || nameOf(item.layer)}</span></Button>
            <Button aria-label={`Drag or use arrow keys to reorder layer ${index + 1}`} className={styles.grip} onPointerDown={(event) => startLayerDrag(event, index)} size="icon-xs" title="Drag to change layer playback order; use arrow keys when focused" type="button" variant="ghost"><DotsSixVertical size={14} /></Button>
            <div className={styles.actions}>
              <Button
                aria-label={targetLayer?.visible ? `Hide ${targetName}` : `Show ${targetName}`}
                aria-pressed={targetLayer?.visible === true}
                disabled={!targetLayer}
                onClick={() => targetLayer && dispatch({ layerId: targetLayer.id, type: "layers.toggleVisibility" })}
                size="icon-xs"
                title={targetLayer?.visible ? `Hide ${targetName} on canvas` : `Show ${targetName} on canvas`}
                type="button"
                variant="ghost"
              >
                {targetLayer?.visible ? <Eye size={15} /> : <EyeSlash size={15} />}
              </Button>
              <Button
                aria-label={`Duplicate item ${index + 1}`}
                onClick={() => {
                  const copy = newMotionItem(item.layer, { ...item, id: `motion-copy-${Date.now().toString(36)}-${index}`, name: item.name ? `${item.name} copy` : undefined });
                  commit({ ...motion, items: [...motion.items.slice(0, index + 1), copy, ...motion.items.slice(index + 1)] });
                  setPickedLayer(null);
                }}
                size="icon-xs"
                title="Duplicate this card"
                type="button"
                variant="ghost"
              >
                <Copy />
              </Button>
              <Button aria-label={`Remove item ${index + 1}`} onClick={() => { commit({ ...motion, items: motion.items.filter((_, at) => at !== index) }); if (pickedLayer === item.id) setPickedLayer(null); }} size="icon-xs" title="Delete this card" type="button" variant="ghost">
                <X />
              </Button>
            </div>
            <span className={styles.muted}>{range ? `${range[0].toFixed(2)} s · ${item.duration.toFixed(2)} s` : "Off"}</span>
          </div>
          {chosen ? <div className={styles.layerBody} data-layer-body="">
          <CardName fallback={nameOf(item.layer)} onCommit={(name) => edit(index, { name: name || undefined })} value={item.name ?? ""} />
          <Select
            name="Layer"
            onValueChange={(next) => edit(index, { layer: next })}
            options={[
              ...(entries.some((entry) => entry.id === item.layer) ? [] : [{ label: nameOf(item.layer).slice(0, 40), value: item.layer }]),
              ...entries.map((entry) => ({ label: `${entry.group ? "▸ " : ""}${entry.name}`.slice(0, 40), value: entry.id })),
            ]}
            showLabel={false}
            value={item.layer}
          />
          <div className={styles.row}>
            <Switch checked={item.fade} name="Fade in" onCheckedChange={(next) => edit(index, { fade: next })} />
            <Switch checked={item.withPrevious} name="Same time" onCheckedChange={(next) => edit(index, { withPrevious: next })} />
          </div>
          <div className={styles.row}>
            <Num max={100} name="Blur (px)" onCommit={(next) => edit(index, { blur: next })} value={item.blur} />
            <Num max={300} min={10} name="Scale from (%)" onCommit={(next) => edit(index, { scale: next })} value={item.scale} />
          </div>
          <div className={styles.row}>
            <Select name="Slide" onValueChange={(next) => edit(index, { slide: SLIDE_OPTIONS.find((option) => option.value === next)?.value ?? "none" })} options={SLIDE_OPTIONS} value={item.slide} />
            <Num name="Slide by (px)" onCommit={(next) => edit(index, { distance: next })} value={item.distance} />
          </div>
          <div className={styles.row}>
            <Select name="Loop" onValueChange={(next) => edit(index, { loop: LOOP_OPTIONS.find((option) => option.value === next)?.value ?? "none" })} options={LOOP_OPTIONS} value={item.loop} />
            <div className={styles.row}>
              <Num max={20} min={0.05} name="Time (s)" onCommit={(next) => edit(index, { duration: next })} value={item.duration} />
              <Num max={20} name="Delay (s)" onCommit={(next) => edit(index, { delay: next })} value={item.delay} />
            </div>
          </div>
          <Select name="Easing preset" onValueChange={(next) => edit(index, { easing: MOTION_EASINGS.find((entry) => entry.id === next)?.id ?? "out" })} options={MOTION_EASINGS.map((entry) => ({ label: entry.label, value: entry.id }))} value={item.easing} />
          </div> : null}
          </RailCard>
          );
        })}
      </div>
      <Button
        disabled={!unused}
        onClick={() => unused && commit({ ...motion, enabled: motion.items.length === 0 ? true : motion.enabled, items: [...motion.items, newMotionItem(unused.id, { slide: "bottom" })] })}
        size="default"
        type="button"
        variant="ghost"
      >
        + Add a layer
      </Button>
      {motion.items.length === 0 ? <div className={styles.muted}>Add the layers of {slotLabel(slot)} that should move in, top to bottom in the order they start.</div> : null}
    </div>
  );

  return (
    <div className={styles.root}>
      <div className={styles.pickerRow}>
        {renaming ? (
          <div className={styles.nameEdit} onBlur={() => setRenaming(false)} ref={renameBox}>
            <TextInput
              commitOnBlur
              name="Section name"
              onValueChange={(next) => {
                const text = next.trim().slice(0, 60);
                commit({ ...motion, label: text === (slot.copy ? slot.key : section.name) ? undefined : text || undefined });
                setRenaming(false);
              }}
              showLabel={false}
              value={slotLabel(slot)}
            />
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button className={styles.pickerButton} onDoubleClick={() => setRenaming(true)} size="default" title="Select a section; double-click to rename" type="button" variant="outline">
                  <span className={styles.pickerName}>{`${slotLabel(slot)}${motion.enabled ? " · animated" : ""}`}</span>
                  <CaretDown aria-hidden="true" size={12} weight="bold" />
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              {slots.map((entry) => {
                const own = motions[entry.key];
                return (
                  <DropdownMenuItem className={styles.pickerItem} key={entry.key} onClick={() => chooseSection(entry.key)}>
                    <span className={styles.pickerName}>{`${entry.copy ? "↳ " : ""}${slotLabel(entry)}${own?.enabled ? " · animated" : ""}`}</span>
                    <span className={styles.actions}>
                      <Button aria-label={`Duplicate the animation of ${slotLabel(entry)}`} disabled={!own?.items.length} onClick={(event) => { event.stopPropagation(); duplicate(entry); }} size="icon-xs" title="Duplicate this animation" type="button" variant="ghost"><Copy /></Button>
                      <Button aria-label={`Delete the animation of ${slotLabel(entry)}`} disabled={!own} onClick={(event) => { event.stopPropagation(); deleteAnimation(entry); }} size="icon-xs" title={entry.copy ? "Delete this copy" : "Delete this section's animation"} type="button" variant="ghost"><X /></Button>
                    </span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem className={styles.pickerItem} onClick={createAnimation}>
                <span className={styles.pickerName}>New animation</span>
                <Plus aria-hidden="true" size={14} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Switch
        checked={editingSectionLoop === slot.key}
        disabled={!sectionRange && editingSectionLoop !== slot.key}
        name="Loop selected section while editing"
        onCheckedChange={(next) => {
          if (!next || !sectionRange) {
            setEditingSectionLoop(null);
            return;
          }
          clearLoopSegments();
          setEditingSectionLoop(slot.key);
          scrub(sectionRange[0]);
          dispatch({ isPlaying: true, type: "timeline.setPlaying" });
        }}
      />
      {selectedEditor}
    </div>
  );
}
