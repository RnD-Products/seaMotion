import { ArrowDown, ArrowUp, Eye, EyeSlash, Plus, X } from "@phosphor-icons/react";
import * as React from "react";
import { Button, FieldDescription, Input, Select, Slider, Tabs, TabsList, TabsTrigger } from "@/toolcraft/ui";

import {
  newPlanId,
  PLAN_EFFECTS,
  PLAN_SLIDES,
  planAnimationRange,
  planSegmentTimes,
  planTotal,
  type InteractionPlanData,
  type PlanAnimation,
  type PlanEffect,
  type PlanSlide,
  type PlanSegment,
} from "./interaction-plan";
import { useSceneOffset } from "./scene-duration";
import { addSegmentTimes, segmentLoopKey, setSegmentTimes } from "./landing-loop";
import { VideoPreviewToggle } from "./video-preview-toggle";
import { SceneCameraCard } from "./scenes-control";
import { LOOP_COLOR, playhead, useRail } from "./plan-rail";
import { RailCard } from "./scroll-plan-control";
import railStyles from "./scroll-plan-control.module.css";
import styles from "./animation-controls.module.css";

const WHOLE_FRAME = "__frame__";
const WHOLE_MOTION = "__motion__";
type Tab = "animations" | "segments";

function formatSeconds(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2).replace(/0$/, "")}s`;
}

// The Interaction plan of a project with no animation script, built by hand: Interaction Segment (the steps, played one after
// another) and Animations (what moves, on which layer and in which segment). Both lists start empty.
export function InteractionPlanEditor({
  layers,
  onChange,
  plan,
}: Readonly<{
  layers: readonly Readonly<{ id: string; name: string }>[];
  onChange: (next: InteractionPlanData) => void;
  plan: InteractionPlanData;
}>): React.ReactNode {
  const [tab, setTab] = React.useState<Tab>("segments");
  // The plan's times are the scene's own; the rail and the loops use the timeline's.
  const offset = useSceneOffset();
  const times = planSegmentTimes(plan);
  const total = planTotal(plan) + offset;
  // The ranges that can be looped from the rail.
  React.useEffect(() => {
    setSegmentTimes(Object.fromEntries(times.map((time) => [time.id, [time.start + offset, time.end + offset] as const])));
    addSegmentTimes(
      Object.fromEntries(
        plan.animations.map((animation) => {
          const range = planAnimationRange(plan, animation);
          return [`fxl:${animation.id}`, [range[0] + offset, range[1] + offset] as const];
        }),
      ),
    );
  });
  return (
    <div className={styles.root}>
      <VideoPreviewToggle />
      <Tabs onValueChange={(next) => setTab(next === "animations" ? "animations" : "segments")} value={tab}>
        <TabsList variant="control">
          <TabsTrigger value="segments">Interaction Segment</TabsTrigger>
          <TabsTrigger value="animations">Animations</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "segments" ? <SegmentList onChange={onChange} plan={plan} total={total} /> : <><SceneCameraCard /><AnimationList layers={layers} onChange={onChange} plan={plan} total={total} /></>}
    </div>
  );
}

function SegmentList({ onChange, plan, total }: Readonly<{ onChange: (next: InteractionPlanData) => void; plan: InteractionPlanData; total: number }>): React.ReactNode {
  const offset = useSceneOffset();
  const times = planSegmentTimes(plan);
  const [open, setOpen] = React.useState<string | null>(null);
  const rangeAt = (index: number): readonly [number, number] | null => {
    const time = times[index];
    return time ? [time.start + offset, time.end + offset] : null;
  };
  const { dragging, loopKeys, now, pick, scrub, startMarkDrag } = useRail(total, "section", rangeAt);
  const patch = (id: string, changes: Partial<PlanSegment>): void =>
    onChange({ ...plan, segments: plan.segments.map((segment) => (segment.id === id ? { ...segment, ...changes } : segment)) });
  const move = (index: number, by: number): void => {
    const to = index + by;
    if (to < 0 || to >= plan.segments.length) return;
    const next = [...plan.segments];
    const [item] = next.splice(index, 1);
    if (item) next.splice(to, 0, item);
    onChange({ ...plan, segments: next });
  };
  const remove = (id: string): void =>
    onChange({
      animations: plan.animations.map((animation) => (animation.segmentId === id ? { ...animation, segmentId: null } : animation)),
      segments: plan.segments.filter((segment) => segment.id !== id),
    });
  const add = (): void => {
    const id = newPlanId("seg");
    onChange({ ...plan, segments: [...plan.segments, { hold: 0.5, id, name: `Segment ${plan.segments.length + 1}`, travel: 1 }] });
    setOpen(id);
  };
  return (
    <div className={railStyles.stack} style={LOOP_COLOR}>
      {plan.segments.length === 0 ? <FieldDescription>No segments yet. Add the first step of the interaction.</FieldDescription> : null}
      {plan.segments.map((segment, index) => {
        const time = times[index];
        const range: readonly [number, number] = time ? [time.start + offset, time.end + offset] : [0, 0];
        const isOpen = open === segment.id;
        return (
          <RailCard
            active={now >= range[0] && now < range[1]}
            dot={`${index + 1}`}
            dragging={dragging}
            index={index}
            key={segment.id}
            last={index === plan.segments.length - 1}
            looped={loopKeys.includes(segmentLoopKey(segment.id))}
            marks={playhead(now, range[0], range[1])}
            onMarkDown={startMarkDrag}
            onScrub={(at) => scrub(at)}
            onSelect={(event) => {
              if ((event.target as HTMLElement).closest("[data-segment-body], input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
              setOpen(isOpen ? null : segment.id);
            }}
            onToggle={(_at, additive) => pick(segment.id, additive, range)}
            range={range}
            scope="section"
            selected={isOpen}
          >
            <div className={railStyles.rowHead}>
              <Input
                aria-label="Segment name"
                className={styles.planName}
                maxLength={60}
                onChange={(event) => patch(segment.id, { name: event.target.value })}
                value={segment.name}
              />
              <button aria-label="Move up" className={styles.segmentToggle} disabled={index === 0} onClick={() => move(index, -1)} type="button">
                <ArrowUp size={13} />
              </button>
              <button aria-label="Move down" className={styles.segmentToggle} disabled={index === plan.segments.length - 1} onClick={() => move(index, 1)} type="button">
                <ArrowDown size={13} />
              </button>
              <button aria-label="Delete segment" className={styles.segmentToggle} onClick={() => remove(segment.id)} type="button">
                <X size={13} />
              </button>
            </div>
            <div className={railStyles.muted}>
              {formatSeconds(range[0])} → {formatSeconds(range[1])} · {formatSeconds(range[1] - range[0])}
            </div>
            {isOpen ? (
              <div className={styles.planBody} data-segment-body="">
                <Slider max={20} min={0} name="Travel" onValueChange={(next) => patch(segment.id, { travel: next })} step={0.05} unit="s" value={segment.travel} />
                <Slider max={20} min={0} name="Hold" onValueChange={(next) => patch(segment.id, { hold: next })} step={0.05} unit="s" value={segment.hold} />
              </div>
            ) : null}
          </RailCard>
        );
      })}
      <Button onClick={add} size="default" type="button" variant="outline">
        <Plus aria-hidden="true" size={13} />
        <span>Add segment</span>
      </Button>
    </div>
  );
}

function AnimationList({
  layers,
  onChange,
  plan,
  total,
}: Readonly<{
  layers: readonly Readonly<{ id: string; name: string }>[];
  onChange: (next: InteractionPlanData) => void;
  plan: InteractionPlanData;
  total: number;
}>): React.ReactNode {
  const offset = useSceneOffset();
  const [open, setOpen] = React.useState<string | null>(null);
  const animationRange = (animation: PlanAnimation): readonly [number, number] => {
    const range = planAnimationRange(plan, animation);
    return [range[0] + offset, range[1] + offset];
  };
  const rangeAt = (index: number): readonly [number, number] | null => {
    const animation = plan.animations[index];
    return animation ? animationRange(animation) : null;
  };
  const { dragging, loopKeys, now, pick, scrub, startMarkDrag } = useRail(total, "layer", rangeAt);
  const patch = (id: string, changes: Partial<PlanAnimation>): void =>
    onChange({ ...plan, animations: plan.animations.map((animation) => (animation.id === id ? { ...animation, ...changes } : animation)) });
  const remove = (id: string): void => onChange({ ...plan, animations: plan.animations.filter((animation) => animation.id !== id) });
  const add = (): void => {
    const id = newPlanId("fx");
    onChange({
      ...plan,
      animations: [
        ...plan.animations,
        { delay: 0, duration: 0.6, effect: "fade", enabled: true, id, layer: "", name: `Animation ${plan.animations.length + 1}`, segmentId: plan.segments[0]?.id ?? null },
      ],
    });
    setOpen(id);
  };
  // The animations, a layer's effects together (in the order the layers first appear).
  const layerOrder = [...new Set(plan.animations.map((animation) => animation.layer))];
  const grouped = plan.animations.map((animation, index) => ({ animation, index })).sort((a, b) => layerOrder.indexOf(a.animation.layer) - layerOrder.indexOf(b.animation.layer));
  const effectLabel = (value: string): string => PLAN_EFFECTS.find((effect) => effect.value === value)?.label ?? value;
  const segmentName = (id: string | null): string => (id === null ? "Whole motion" : (plan.segments.find((segment) => segment.id === id)?.name ?? "Whole motion"));
  const layerOptions = [{ label: "Whole frame", value: WHOLE_FRAME }, ...layers.filter((layer) => layer.name).map((layer) => ({ label: layer.name, value: layer.name }))];
  const segmentOptions = [{ label: "Whole motion", value: WHOLE_MOTION }, ...plan.segments.map((segment) => ({ label: segment.name, value: segment.id }))];
  const playheadId = plan.animations.find((animation) => {
    const range = animationRange(animation);
    return animation.enabled && now >= range[0] && now < range[1];
  })?.id;
  return (
    <div className={railStyles.stack} style={LOOP_COLOR}>
      {plan.animations.length === 0 ? <FieldDescription>No animations yet. Add one, then choose its layer, segment and effect.</FieldDescription> : null}
      {grouped.map(({ animation, index }) => {
        const range = animationRange(animation);
        const isOpen = open === animation.id;
        const layerKey = animation.layer === "" ? WHOLE_FRAME : animation.layer;
        const firstOfLayer = plan.animations.findIndex((other) => (other.layer === "" ? WHOLE_FRAME : other.layer) === layerKey) === index;
        const layerValue = animation.layer === "" ? WHOLE_FRAME : animation.layer;
        return (
          <React.Fragment key={animation.id}>
          {firstOfLayer ? <div style={{ fontSize: 11, fontWeight: 600, margin: "6px 2px 0", opacity: 0.8 }}>{layerKey === WHOLE_FRAME ? "Whole frame" : layerKey}</div> : null}
          <RailCard
            active={animation.enabled && now >= range[0] && now < range[1]}
            dot={`${index + 1}`}
            dragging={dragging}
            index={index}
            last={index === plan.animations.length - 1}
            looped={loopKeys.includes(segmentLoopKey(`fxl:${animation.id}`))}
            marks={animation.id === playheadId ? playhead(now, range[0], range[1]) : []}
            onMarkDown={startMarkDrag}
            onScrub={(at) => scrub(at)}
            onSelect={(event) => {
              if ((event.target as HTMLElement).closest("[data-segment-body], input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
              setOpen(isOpen ? null : animation.id);
            }}
            onToggle={(_at, additive) => pick(`fxl:${animation.id}`, additive, range)}
            range={range}
            scope="layer"
            selected={isOpen}
          >
            <div className={railStyles.rowHead} data-off={!animation.enabled || undefined}>
              <Input
                aria-label="Animation name"
                className={styles.planName}
                maxLength={60}
                onChange={(event) => patch(animation.id, { name: event.target.value })}
                style={animation.enabled ? undefined : { opacity: 0.45 }}
                value={animation.name}
              />
              <button
                aria-label={animation.enabled ? "Turn animation off" : "Turn animation on"}
                aria-pressed={animation.enabled}
                className={styles.segmentToggle}
                onClick={() => patch(animation.id, { enabled: !animation.enabled })}
                type="button"
              >
                {animation.enabled ? <Eye size={15} /> : <EyeSlash size={15} />}
              </button>
              <button aria-label="Delete animation" className={styles.segmentToggle} onClick={() => remove(animation.id)} type="button">
                <X size={13} />
              </button>
            </div>
            <div className={railStyles.muted} style={animation.enabled ? undefined : { opacity: 0.45 }}>
              {effectLabel(animation.effect)} · {segmentName(animation.segmentId)}
            </div>
            {isOpen ? (
              <div className={styles.planBody} data-segment-body="">
                <Select name="Layer" onValueChange={(next) => patch(animation.id, { layer: next === WHOLE_FRAME ? "" : next })} options={layerOptions} value={layerValue} />
                <Select
                  name="Segment"
                  onValueChange={(next) => patch(animation.id, { segmentId: next === WHOLE_MOTION ? null : next })}
                  options={segmentOptions}
                  value={animation.segmentId ?? WHOLE_MOTION}
                />
                <Select
                  name="Effect"
                  onValueChange={(next) => patch(animation.id, { effect: next as PlanEffect })}
                  options={PLAN_EFFECTS.map((effect) => ({ label: effect.label, value: effect.value }))}
                  value={animation.effect}
                />
                <Slider max={20} min={0} name="Start" onValueChange={(next) => patch(animation.id, { delay: next })} step={0.05} unit="s" value={animation.delay} />
                <Slider max={20} min={0.05} name="Duration" onValueChange={(next) => patch(animation.id, { duration: next })} step={0.05} unit="s" value={animation.duration} />
                {animation.effect === "in" || animation.effect === "out" || animation.effect === "letters" || animation.effect === "lettersOut" ? (
                  <>
                    <Slider max={100} min={0} name="Blur" onValueChange={(next) => patch(animation.id, { blur: next })} step={1} unit="px" value={animation.blur ?? 0} />
                    <Select
                      name="Slide from"
                      onValueChange={(next) => patch(animation.id, { slide: next as PlanSlide })}
                      options={PLAN_SLIDES.map((slide) => ({ label: slide.label, value: slide.value }))}
                      value={animation.slide ?? "none"}
                    />
                    <Slider max={500} min={0} name="Slide distance" onValueChange={(next) => patch(animation.id, { distance: next })} step={5} unit="px" value={animation.distance ?? 0} />
                  </>
                ) : null}
                {animation.effect === "in" || animation.effect === "out" ? (
                  <Slider max={400} min={0} name="Scale" onValueChange={(next) => patch(animation.id, { scale: next })} step={5} unit="%" value={animation.scale ?? 100} />
                ) : null}
                {animation.effect === "letters" || animation.effect === "lettersOut" ? (
                  <Slider max={1} min={0} name="Letter stagger" onValueChange={(next) => patch(animation.id, { stagger: next })} step={0.01} unit="s" value={animation.stagger ?? 0.05} />
                ) : null}
                {animation.effect === "rotate" || animation.effect === "sweep" || animation.effect === "spin" ? (
                  <>
                    <Slider max={1600} min={0} name="Pivot X" onValueChange={(next) => patch(animation.id, { px: next })} step={1} unit="px" value={animation.px ?? 0} />
                    <Slider max={1200} min={0} name="Pivot Y" onValueChange={(next) => patch(animation.id, { py: next })} step={1} unit="px" value={animation.py ?? 0} />
                  </>
                ) : null}
                {animation.effect === "sweep" ? (
                  <>
                    <Slider max={1600} min={0} name="Needle base X" onValueChange={(next) => patch(animation.id, { bx: next })} step={1} unit="px" value={animation.bx ?? 0} />
                    <Slider max={1200} min={0} name="Needle base Y" onValueChange={(next) => patch(animation.id, { by: next })} step={1} unit="px" value={animation.by ?? 0} />
                    <Slider max={600} min={0} name="Needle length (0: reveal along the pivot)" onValueChange={(next) => patch(animation.id, { reach: next > 0 ? next : undefined })} step={0.5} unit="px" value={animation.reach ?? 0} />
                  </>
                ) : null}
                {animation.effect === "spin" || animation.effect === "wave" || animation.effect === "float" ? (
                  <>
                    <Slider max={60} min={0.1} name="Period" onValueChange={(next) => patch(animation.id, { period: next })} step={0.05} unit="s" value={animation.period ?? 1} />
                    <Slider max={3600} min={0} name="Phase" onValueChange={(next) => patch(animation.id, { phase: next })} step={0.05} unit="s" value={animation.phase ?? 0} />
                  </>
                ) : null}
                {animation.effect === "wave" ? (
                  <Slider max={1000} min={1} name="Wave length" onValueChange={(next) => patch(animation.id, { distance: next })} step={1} unit="px" value={animation.distance ?? 90} />
                ) : null}
                {animation.effect === "float" ? (
                  <Slider max={60} min={0} name="Float distance" onValueChange={(next) => patch(animation.id, { distance: next })} step={0.5} unit="px" value={animation.distance ?? 6} />
                ) : null}
                {animation.effect === "count" ? (
                  <>
                    <Slider max={10000} min={0} name="Count from" onValueChange={(next) => patch(animation.id, { from: next })} step={1} value={animation.from ?? 0} />
                    <Slider max={10000} min={0} name="Count to (0: the layer's own number)" onValueChange={(next) => patch(animation.id, { to: next > 0 ? next : undefined })} step={1} value={animation.to ?? 0} />
                  </>
                ) : null}
                {animation.effect === "swap" ? (
                  <Input aria-label="Words to show" maxLength={200} onChange={(event) => patch(animation.id, { text: event.target.value })} placeholder="The words the text shows" value={animation.text ?? ""} />
                ) : null}
                {animation.effect === "flip" || animation.effect === "rotate" || animation.effect === "sweep" ? (
                  <Slider max={720} min={-360} name="Angle" onValueChange={(next) => patch(animation.id, { angle: next })} step={5} unit="°" value={animation.angle ?? 90} />
                ) : null}
              </div>
            ) : null}
          </RailCard>
          </React.Fragment>
        );
      })}
      <Button onClick={add} size="default" type="button" variant="outline">
        <Plus aria-hidden="true" size={13} />
        <span>Add animation</span>
      </Button>
    </div>
  );
}
