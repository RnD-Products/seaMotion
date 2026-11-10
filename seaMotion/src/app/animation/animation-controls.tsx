import { Eye, EyeSlash } from "@phosphor-icons/react";
import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector, type ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { FieldDescription, Tabs, TabsList, TabsTrigger } from "@/toolcraft/ui";

import type { ControlSpec } from "./animation-spec";
import styles from "./animation-controls.module.css";
import { getActiveAnimation, getControlLayerId, resolveParams } from "./animation-spec";
import { ControlList } from "./control-list";
import { readInteractionPlan } from "./interaction-plan";
import { VideoPreviewToggle } from "./video-preview-toggle";
import { InteractionPlanEditor } from "./interaction-plan-editor";
import { isSceneMotionType, MOTION_TYPE_TARGET, readMotionType } from "./motion-type";
import { resolveProjectScenes } from "./scenes";
import { LOOP_COLOR, playhead, useRail } from "./plan-rail";
import { RailCard } from "./scroll-plan-control";
import railStyles from "./scroll-plan-control.module.css";
import { addSegmentTimes, clearLoopSegments, setSegmentTimes, nextLoopTime, pickLoopSegment, segmentLoopKey, segmentLoopRanges, useLoopSelection } from "./landing-loop";
import type { SandboxSegment, SandboxSegmentItem } from "./animation-sandbox";
import { formatSeconds, segmentNumber, useSegmentSchedule } from "./segment-schedule";
import { effectsForRole } from "./animation-cards";
import { SceneCameraCard } from "./scenes-control";
import { usePickedCard, useSceneFilter, useTimelineView } from "./timeline-view";

// A group named like "001 · Focus" is one interaction segment of the motion; every other group
// (Focus blur, Hover glow, Counter...) is an animation applied across it.
const SEGMENT_GROUP = /^\d+\s*·/;
type PlanTab = "animations" | "segments";

// The motion controls of the open animation, drawn from the spec inside the project file. The
// design's own properties are not here: layer properties are in the Modifier layer editor and the rest under Frame Settings.
export function AnimationControls({ setValue, state, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  // With All chosen in the scenes strip the plan shows every segment of the motion, not just the part the scene on show plays.
  const timelineView = useTimelineView();
  const sceneFilter = useSceneFilter();
  const isInteraction = isSceneMotionType(readMotionType(state.values[MOTION_TYPE_TARGET]));
  // A scene that does not run the design's motion (a new scene) builds its Interaction plan by hand, like a project with no motion.
  const scenes = resolveProjectScenes(state.values, state.timeline.durationSeconds);
  const byHand = isInteraction && scenes.items[scenes.activeIndex]?.scene.motion === false;
  if (!spec || byHand) {
    // A project with no animation that chose Interaction Animation builds its Interaction plan by hand; both lists start empty.
    if (!isInteraction) return null;
    const params = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return <InteractionPlanEditor layers={state.layers} onChange={(next) => setValue({ ...params, plan: next })} plan={readInteractionPlan(value)} />;
  }
  // A scene that plays one part of the motion (its role) shows only that part's settings, and the shared ones.
  const role = isInteraction && !(scenes.many && timelineView === "all" && !sceneFilter) ? scenes.items[scenes.activeIndex]?.scene.role : undefined;
  const forScene = new Set(effectsForRole(spec.controls, role));
  const controls = spec.controls.filter(
    (control) =>
      forScene.has(control) &&
      control.section !== "frame" &&
      getControlLayerId(spec, control) === null &&
      (!role || !SEGMENT_GROUP.test(control.group ?? "") || segmentNumber(control.group ?? "") === role),
  );
  if (controls.length === 0) {
    // A scene with no script controls of its own builds its Motion Plan by hand (the Preset section writes into it too).
    if (isInteraction) {
      const own = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      return <InteractionPlanEditor layers={state.layers} onChange={(next) => setValue({ ...own, plan: next })} plan={readInteractionPlan(value)} />;
    }
    if (spec.lottie) return <FieldDescription>The motion is inside the Lottie file. Show or hide its layers in the Layers panel.</FieldDescription>;
    return <FieldDescription>This project is a design only. It has no animation yet.</FieldDescription>;
  }
  const params = resolveParams(spec, value);
  const onChange: React.ComponentProps<typeof ControlList>["onChange"] = (id, next, meta) => setValue({ ...params, [id]: next }, meta);
  // Interaction Animation shows the Interaction plan (segments and animations on a timeline); the other types list the controls by category.
  if (!isInteraction) return <ControlList controls={controls} onChange={onChange} params={params} />;
  return <InteractionPlan controls={controls} onChange={onChange} params={params} stage={role} />;
}

// The Interaction plan: Interaction Segment (one dropdown entry per segment, with its timing) and
// Animations (the effects), the same two-tab layout as the Landing Page Scroll plan.
function InteractionPlan({
  controls,
  onChange,
  params,
  schedule,
  stage,
}: Readonly<{
  controls: readonly ControlSpec[];
  onChange: React.ComponentProps<typeof ControlList>["onChange"];
  params: Readonly<Record<string, unknown>>;
  // The segments' times when they are worked out here (the template); otherwise the animation's own script reports them.
  schedule?: readonly SandboxSegment[];
  // The part of the motion the scene on show plays (the scene's role), when it plays one.
  stage?: string;
}>): React.ReactNode {
  const [tab, setTab] = React.useState<PlanTab>("segments");
  const timelineView = useTimelineView();
  const sceneFilterOn = useSceneFilter();
  const pickedCard = usePickedCard();
  // A bar picked in the timeline shows its card in the Animations tab.
  React.useEffect(() => {
    if (pickedCard) setTab(SEGMENT_GROUP.test(pickedCard) ? "segments" : "animations");
  }, [pickedCard]);
  React.useEffect(() => {
    if (schedule) setSegmentTimes(Object.fromEntries(schedule.map((segment) => [segment.id, [segment.start, segment.end] as const])));
  });
  // Interaction Segment lists the cursor's moves (the Reactor's cursor): only the segments whose cursor goes somewhere get a card.
  const movingGroups = new Set(controls.filter((control) => control.id.startsWith("cur.")).map((control) => control.group ?? ""));
  const segments = controls.filter((control) => SEGMENT_GROUP.test(control.group ?? "") && movingGroups.has(control.group ?? ""));
  const animations = controls.filter((control) => !SEGMENT_GROUP.test(control.group ?? ""));
  return (
    <div className={styles.root}>
      <VideoPreviewToggle />
      <Tabs onValueChange={(next) => setTab(next === "animations" ? "animations" : "segments")} value={tab}>
        <TabsList variant="control">
          <TabsTrigger value="segments">Interaction Segment</TabsTrigger>
          <TabsTrigger value="animations">Animations</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "segments" && segments.length === 0 ? (
        <FieldDescription>The cursor does not move in this scene.</FieldDescription>
      ) : tab === "animations" && animations.length === 0 && !(timelineView === "scene" || sceneFilterOn) ? (
        <FieldDescription>This scene has no animations.</FieldDescription>
      ) : tab === "segments" ? (
        <SegmentCards controls={segments} onChange={onChange} params={params} schedule={schedule} stage={stage} />
      ) : (
        <>
          {timelineView === "scene" || sceneFilterOn ? <SceneCameraCard /> : null}
          <AnimationCards controls={animations} onChange={onChange} params={params} schedule={schedule} stage={stage} />
        </>
      )}
    </div>
  );
}

// One card per segment, in the order they play, on a vertical timeline like the steps of a Scroll plan: its number
// and name, when it starts and ends, and how long it lasts. Opening a card shows its settings.
function SegmentCards({
  controls,
  onChange,
  params,
  schedule: given,
  stage,
}: Readonly<{
  controls: readonly ControlSpec[];
  onChange: React.ComponentProps<typeof ControlList>["onChange"];
  params: Readonly<Record<string, unknown>>;
  schedule?: readonly SandboxSegment[];
  stage?: string;
}>): React.ReactNode {
  const measured = useSegmentSchedule(params, stage);
  const schedule = given ?? measured;
  const [open, setOpen] = React.useState<string | null>(null);
  const groups = [...new Set(controls.map((control) => control.group ?? ""))];
  // The segment of the layer picked in the Layers panel opens; with nothing picked the cards are folded.
  const pickedSegment = usePickedCard();
  React.useEffect(() => {
    setOpen(pickedSegment && groups.includes(pickedSegment) ? pickedSegment : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedSegment]);
  const total = Math.max(0, ...schedule.filter((segment) => /^\d+$/.test(segment.id)).map((segment) => segment.end));
  const timingAt = (index: number): readonly [number, number] | null => {
    const timing = schedule.find((segment) => segment.id === segmentNumber(groups[index] ?? ""));
    return timing ? [timing.start, timing.end] : null;
  };
  const { dragging, loopKeys, now, pick, scrub, startMarkDrag } = useRail(total, "section", timingAt);
  return (
    <div className={railStyles.stack} style={LOOP_COLOR}>
      {groups.map((group, index) => {
        const timing = schedule.find((segment) => segment.id === segmentNumber(group));
        const range: readonly [number, number] = timing ? [timing.start, timing.end] : [0, 0];
        const isOpen = open === group;
        return (
          <RailCard
            active={timing !== undefined && now >= range[0] && now < range[1]}
            dot={`${index + 1}`}
            dragging={dragging}
            index={index}
            key={group}
            last={index === groups.length - 1}
            looped={timing !== undefined && loopKeys.includes(segmentLoopKey(timing.id))}
            marks={playhead(now, range[0], range[1])}
            onMarkDown={startMarkDrag}
            onScrub={(at) => timing && scrub(at)}
            onSelect={(event) => {
              if ((event.target as HTMLElement).closest("[data-segment-body], input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
              setOpen(isOpen ? null : group);
            }}
            onToggle={(_at, additive) => timing && pick(timing.id, additive, range)}
            range={range}
            scope="section"
            selected={isOpen}
          >
            <div className={railStyles.rowHead}>
              <span className={railStyles.rowName}>{group.replace(/^\d+\s*·\s*/, "")}</span>
            </div>
            {timing ? (
              <div className={railStyles.muted}>
                {formatSeconds(timing.start)} → {formatSeconds(timing.end)} · {formatSeconds(timing.end - timing.start)}
              </div>
            ) : null}
            <AnimatedItems items={timing?.items} />
            {isOpen ? (
              <div data-segment-body="">
                {/* The times (seconds) are set on the timeline's bars, so the seconds sliders are not listed here. */}
                <LayerSections controls={controls.filter((control) => (control.group ?? "") === group && !(control.type === "slider" && control.unit === "s"))} onChange={onChange} params={params} />
              </div>
            ) : null}
          </RailCard>
        );
      })}
    </div>
  );
}

// Controls split under the layer of the design they change, one heading per layer, in the order they first appear. Controls
// without a layer are shown as they are.
function LayerSections({
  controls,
  onChange,
  params,
}: Readonly<{
  controls: readonly ControlSpec[];
  onChange: React.ComponentProps<typeof ControlList>["onChange"];
  params: Readonly<Record<string, unknown>>;
}>): React.ReactNode {
  const layers = [...new Set(controls.map((control) => control.layer ?? ""))];
  if (layers.length === 1 && layers[0] === "") return <ControlList controls={controls} onChange={onChange} params={params} />;
  return (
    <div className={styles.layers}>
      {layers.map((layer) => (
        <div className={styles.layer} key={layer}>
          <div className={styles.layerHeading}>{layer || "Other"}</div>
          <ControlList controls={controls.filter((control) => (control.layer ?? "") === layer)} onChange={onChange} params={params} />
        </div>
      ))}
    </div>
  );
}

// The Animations tab: one card per layer of the design (Main card, All sliders...), holding the effects that work on it, each
// with an eye that turns it on and off. A card's line covers the time its effects work; a project whose controls name no
// layer gets one card per effect instead. A turned-off effect keeps its settings and stays editable, dimmed.
function AnimationCards({
  controls: allControls,
  onChange,
  params,
  schedule: given,
  stage,
}: Readonly<{
  controls: readonly ControlSpec[];
  onChange: React.ComponentProps<typeof ControlList>["onChange"];
  params: Readonly<Record<string, unknown>>;
  schedule?: readonly SandboxSegment[];
  stage?: string;
}>): React.ReactNode {
  const measured = useSegmentSchedule(params, stage);
  const schedule = given ?? measured;
  const total = Math.max(0, ...schedule.filter((segment) => /^\d+$/.test(segment.id)).map((segment) => segment.end));
  // The slide-in steps (Step 1, 2, 3 …) each have a card of their own, only for the steps this scene's part has.
  const part = stage ? schedule.find((segment) => segment.id === stage) : undefined;
  const controls = allControls.filter((control) => {
    const step = /^enter\.(\d+)\./.exec(control.id)?.[1];
    return !step || !part || (part.slides ?? []).some((slide) => slide.step === Number(step) - 1);
  });
  const [open, setOpen] = React.useState<string | null>(null);
  // One card per layer and effect: "Portfolio slider · Hover glow", "Portfolio slider · Drag"... A control without a layer
  // gets a card of its effect alone.
  const cardOf = (control: ControlSpec): string => (control.layer ? `${control.layer} · ${control.group ?? ""}` : (control.group ?? ""));
  const cards = [...new Set(controls.map(cardOf))];
  // The card of the bar picked in the timeline opens (and comes into view); with no bar picked the cards are folded.
  const pickedCard = usePickedCard();
  React.useEffect(() => {
    const at = pickedCard ? cards.indexOf(pickedCard) : -1;
    setOpen(at >= 0 ? (pickedCard as string) : null);
    if (at >= 0) window.setTimeout(() => document.querySelector(`[data-layer-index="${at}"]`)?.scrollIntoView({ block: "nearest" }), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedCard]);
  const groupsOf = (card: string): string[] => [...new Set(controls.filter((control) => cardOf(control) === card).map((control) => control.group ?? ""))];
  // The time the card's effects work, as the script reports it (an effect without a report plays across the whole motion).
  const rangeOf = (card: string): readonly [number, number] | null => {
    const spans = groupsOf(card).map((group) => schedule.find((segment) => segment.id === `fx:${group}`)).filter((segment) => segment !== undefined);
    if (spans.length > 0) return [Math.min(...spans.map((segment) => segment.start)), Math.max(...spans.map((segment) => segment.end))];
    return total > 0 ? [0, total] : null;
  };
  const loopId = (card: string): string => `fxl:${card}`;
  React.useEffect(() => {
    const extra: Record<string, readonly [number, number]> = {};
    for (const card of cards) {
      const range = rangeOf(card);
      if (range) extra[loopId(card)] = range;
    }
    addSegmentTimes(extra);
  });
  const { dragging, loopKeys, now, pick, scrub, startMarkDrag } = useRail(total, "layer", (index) => rangeOf(cards[index] ?? "") ?? null);
  // One playhead only: on the first card that is working now.
  const playheadCard = cards.find((card) => {
    const range = rangeOf(card);
    return range !== null && now >= range[0] && now < range[1];
  });
  return (
    <div className={railStyles.stack} style={LOOP_COLOR}>
      {cards.map((card, index) => {
        const range = rangeOf(card);
        const span: readonly [number, number] = range ?? [0, 0];
        const groups = groupsOf(card);
        const toggleOf = (group: string): ControlSpec | undefined =>
          controls.find((control) => cardOf(control) === card && (control.group ?? "") === group && control.type === "switch" && /\.on(\.\w+)?$/.test(control.id));
        const isOn = (group: string): boolean => {
          const toggle = toggleOf(group);
          return toggle ? params[toggle.id] === true : true;
        };
        const anyOn = groups.some(isOn);
        const isOpen = open === card;
        return (
          <RailCard
            active={anyOn && range !== null && now >= span[0] && now < span[1]}
            dot={`${index + 1}`}
            dragging={dragging}
            index={index}
            key={card}
            last={index === cards.length - 1}
            looped={range !== null && loopKeys.includes(segmentLoopKey(loopId(card)))}
            marks={card === playheadCard ? playhead(now, span[0], span[1]) : []}
            onMarkDown={startMarkDrag}
            onScrub={(at) => range && scrub(at)}
            onSelect={(event) => {
              if ((event.target as HTMLElement).closest("[data-segment-body], input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
              setOpen(isOpen ? null : card);
            }}
            onToggle={(_at, additive) => range && pick(loopId(card), additive, span)}
            range={span}
            scope="layer"
            selected={isOpen}
          >
            <div className={railStyles.rowHead} data-off={!anyOn || undefined}>
              <span className={railStyles.rowName} style={anyOn ? undefined : { opacity: 0.45 }}>{card}</span>
              {groups.length === 1 && toggleOf(groups[0] ?? "") ? (
                <button
                  aria-label={anyOn ? `Turn ${card} off` : `Turn ${card} on`}
                  aria-pressed={anyOn}
                  className={styles.segmentToggle}
                  onClick={() => onChange(toggleOf(groups[0] ?? "")!.id, !anyOn)}
                  type="button"
                >
                  {anyOn ? <Eye size={15} /> : <EyeSlash size={15} />}
                </button>
              ) : null}
            </div>
            {groups.map((group) => {
              const toggle = toggleOf(group);
              const on = isOn(group);
              return (
                <div className={styles.effect} key={group}>
                  {groups.length > 1 ? (
                    <div className={railStyles.rowHead} data-off={!on || undefined}>
                      <span className={styles.effectName} style={on ? undefined : { opacity: 0.45 }}>{group}</span>
                      {toggle ? (
                        <button
                          aria-label={on ? `Turn ${group} off` : `Turn ${group} on`}
                          aria-pressed={on}
                          className={styles.segmentToggle}
                          onClick={() => onChange(toggle.id, !on)}
                          type="button"
                        >
                          {on ? <Eye size={15} /> : <EyeSlash size={15} />}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <AnimatedItems dimmed={!on} items={schedule.find((segment) => segment.id === `fx:${group}`)?.items} layer={card.includes(" · ") ? card.split(" · ")[0] : undefined} />
                  {isOpen ? (
                    <div data-segment-body="" style={on ? undefined : { opacity: 0.45 }}>
                      <ControlList controls={controls.filter((control) => cardOf(control) === card && (control.group ?? "") === group && control !== toggle)} onChange={onChange} params={params} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </RailCard>
        );
      })}
    </div>
  );
}

// What a card animates: each item with where it is in the design, one line per item.
function AnimatedItems({ dimmed = false, items, layer }: Readonly<{ dimmed?: boolean; items: readonly SandboxSegmentItem[] | undefined; layer?: string }>): React.ReactNode {
  if (!items || items.length === 0) return null;
  // In a layer's card only what belongs to that layer is listed (all of it when nothing is named after the layer).
  const own = layer ? items.filter((entry) => entry.item === layer || entry.where === layer) : [];
  if (own.length > 0) items = own;
  return (
    <ul className={styles.animated} style={dimmed ? { opacity: 0.45 } : undefined}>
      {items.map((entry) => (
        <li className={styles.animatedRow} key={`${entry.item}|${entry.where}`}>
          <span className={styles.animatedItem}>{entry.item}</span>
          <span className={styles.animatedWhere}>{entry.where}</span>
        </li>
      ))}
    </ul>
  );
}
