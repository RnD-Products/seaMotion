import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector, type ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, FieldDescription, Select } from "@/toolcraft/ui";

import { ANIMATION_LIBRARY_TARGET, getActiveAnimation, readAnimationLibrary, type AnimationSpec } from "./animation-spec";
import { lottieLayerId, type LottieData } from "../lottie/lottie-data";
import { newPlanId, readInteractionPlan, type InteractionPlanData, type PlanAnimation } from "./interaction-plan";
import { useActiveLayerId } from "../mo/mo-layer-selection";
import { layersWithTag, tagLabel, tagsInUse } from "../mo/mo-layer-tags";
import { floatRoom } from "./float-room";
import { resolveProjectScenes } from "./scenes";
import styles from "./motion-presets.module.css";

// Motion tab > Preset: ready-made motion for the layer selected in the Layers panel. A preset is written into the open scene's Motion Plan
// (Animations tab) as an ordinary animation on that layer, so it can be changed there afterwards.
export const FLOAT_PREFIX = "preset-float";
const FLOAT_CYCLE_SECONDS = 8;

type Preset = Readonly<{
  id: string;
  name: string;
  note: string;
  // The animation this preset adds for a layer, for a scene of this many seconds on an artboard of this size.
  // `room`: the most the layer may move, when it is on the artboard's edge (null: no limit).
  make: (layer: Readonly<{ id: string; name: string }>, scene: number, size: number, room?: number | null) => PlanAnimation;
}>;

// Floating: a slow bob and sway that never leaves the artboard. Whole cycles fit the scene exactly, so when it loops the end meets the start.
export function floatAnimation(layer: Readonly<{ id: string; name: string }>, scene: number, size: number, room: number | null = null): PlanAnimation {
  const cycles = Math.max(1, Math.round(scene / FLOAT_CYCLE_SECONDS));
  return {
    delay: 0,
    // A layer on an edge keeps to the room it has: it never floats off the artboard.
    distance: room === null ? Math.max(3, Math.round(size * 0.018 * 2) / 2) : Math.max(0, Math.min(Math.max(3, Math.round(size * 0.018 * 2) / 2), room)),
    duration: scene,
    effect: "float",
    enabled: true,
    id: newPlanId(`${FLOAT_PREFIX}-${layer.id}`),
    layer: layer.id,
    name: `Floating · ${layer.name}`,
    period: Math.round((scene / cycles) * 1000) / 1000,
    phase: 0,
    segmentId: null,
  };
}

const PRESETS: readonly Preset[] = [
  { id: FLOAT_PREFIX, make: floatAnimation, name: "Floating", note: "The layer floats: a slow bob and sway, smooth, never leaving the screen. It loops with no jump between the end and the start." },
];

// A Lottie Animation project keeps its motion inside the Lottie file, so Floating is written as position keyframes on the layer: two bobs and a
// sway per cycle, a key every 4 frames at 60 fps with straight lines between (the same float the vyron project has). A layer whose position is still gets it; a layer that already
// moves keeps its own motion.
type LottieProp = Readonly<{ a?: number; k?: unknown; s?: boolean; x?: LottieProp; y?: LottieProp }>;
const isRec = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function floatKeys(base: number, amount: (frame: number) => number, frames: number, step: number): LottieProp {
  const keys: Record<string, unknown>[] = [];
  for (let frame = 0; frame <= frames; frame += step) {
    const key: Record<string, unknown> = { s: [Math.round((base + amount(frame)) * 1000) / 1000], t: frame };
    if (frame < frames) Object.assign(key, { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } });
    keys.push(key);
  }
  return { a: 1, k: keys };
}

function lottieTarget(spec: AnimationSpec | null, layerId: string): Record<string, unknown> | null {
  const data = spec?.lottie as LottieData | undefined;
  if (!data) return null;
  const layers = data.layers as unknown[];
  const found = layers.find((layer, index) => lottieLayerId(layer, index) === layerId);
  return isRec(found) ? found : null;
}

function lottieFloating(layer: Record<string, unknown> | null): boolean {
  const position = isRec(layer?.ks) ? (layer.ks as Record<string, unknown>).p : undefined;
  return isRec(position) && position.s === true && isRec(position.x) && position.x.a === 1;
}

// The mean of whole cycles of keys is the position the layer had before it floated.
function keyMean(prop: LottieProp): number {
  const keys = (Array.isArray(prop.k) ? prop.k : []).slice(0, -1) as { s?: number[] }[];
  return keys.reduce((sum, key) => sum + (key.s?.[0] ?? 0), 0) / Math.max(1, keys.length);
}

function floatLottie(spec: AnimationSpec, layerId: string, remove: boolean): AnimationSpec | null {
  const data = JSON.parse(JSON.stringify(spec.lottie)) as LottieData;
  const layer = lottieTarget({ ...spec, lottie: data } as AnimationSpec, layerId);
  const ks = layer && isRec(layer.ks) ? (layer.ks as Record<string, unknown>) : null;
  const position = ks && isRec(ks.p) ? (ks.p as LottieProp) : null;
  if (!layer || !ks || !position) return null;
  const fps = Number(data.fr);
  const frames = Math.round(Number(data.op) - Number(data.ip));
  if (remove) {
    if (!lottieFloating(layer) || !position.x || !position.y) return null;
    ks.p = { a: 0, k: [Math.round(keyMean(position.x) * 1000) / 1000, Math.round(keyMean(position.y) * 1000) / 1000, 0] };
  } else {
    // Applying again on a layer that floats rebuilds the keys around the position it had before.
    const floating = lottieFloating(layer) && position.x && position.y;
    if (!floating && (position.a === 1 || !Array.isArray(position.k))) return null;
    const [x, y] = floating ? [keyMean(position.x as LottieProp), keyMean(position.y as LottieProp)] : (position.k as number[]);
    const seconds = frames / fps;
    const cycles = Math.max(1, Math.round(seconds / FLOAT_CYCLE_SECONDS));
    const turn = (2 * Math.PI * cycles) / frames;
    const bob = Math.max(3, Math.round(Math.min(Number(data.w), Number(data.h)) * 0.018 * 2) / 2);
    const step = Math.max(1, Math.round(fps / 15));
    // Whole cycles need the last key on the last frame: pick the step that divides the length.
    let each = step;
    while (frames % each !== 0 && each < frames) each += 1;
    ks.p = { s: true, x: floatKeys(x ?? 0, (frame) => bob * 0.58 * Math.sin(turn * frame + 1.2), frames, each), y: floatKeys(y ?? 0, (frame) => bob * Math.sin(2 * turn * frame), frames, each) };
  }
  return { ...spec, lottie: data, version: spec.version + 1 } as AnimationSpec;
}

const isPreset = (animation: PlanAnimation, preset: Preset, layerId: string): boolean => animation.layer === layerId && animation.id.startsWith(`${preset.id}-`);

export function MotionPresets({ setValue, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const selectedLayerId = useToolcraftSelector((state) => state.selectedLayerId);
  const layers = useToolcraftSelector((state) => state.layers);
  const values = useToolcraftSelector((state) => state.values);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const dispatch = useToolcraftDispatch();
  const layerId = useActiveLayerId(selectedLayerId);
  const layer = layers.find((item) => item.id === layerId);
  const params = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const plan = readInteractionPlan(params);
  const scenes = resolveProjectScenes(values, durationSeconds);
  const shown = scenes.items[scenes.activeIndex];
  const scene = shown ? Math.max(0.1, shown.end - shown.start) : durationSeconds;
  const frame = getActiveAnimation(values)?.size;
  const size = frame ? Math.min(frame.width, frame.height) : 330;

  const spec = getActiveAnimation(values);
  const isLottie = Boolean(spec?.lottie);
  const lottieLayer = isLottie && layer ? lottieTarget(spec, layer.id) : null;
  const lottieMoves = lottieLayer !== null && !lottieFloating(lottieLayer) && isRec(lottieLayer.ks) && isRec((lottieLayer.ks as Record<string, unknown>).p) && ((lottieLayer.ks as Record<string, unknown>).p as LottieProp).a === 1;
  const writeLottie = (remove: boolean): void => {
    if (!spec || !layer) return;
    const next = floatLottie(spec, layer.id, remove);
    if (!next) return;
    const library = readAnimationLibrary(values[ANIMATION_LIBRARY_TARGET]);
    dispatch({ label: remove ? "Remove floating" : "Floating preset", target: ANIMATION_LIBRARY_TARGET, type: "controls.setValue", value: { items: { ...library.items, [next.id]: next } } });
  };

  // Apply to: the selected layer, or every layer carrying a tag (Modifier > Layer > Tag). A Lottie project keeps its motion in its file, so it is per layer.
  const [target, setTarget] = React.useState<string>("selected");
  const tagged = React.useMemo(
    () => tagsInUse(spec, layers, params).map((tag) => ({ layers: layersWithTag(spec, layers, params, tag), tag })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, layers, value],
  );
  const group = !isLottie && target !== "selected" ? (tagged.find((entry) => entry.tag === target)?.layers ?? null) : null;
  const targets = group ?? (layer ? [layer] : []);

  const write = (animations: readonly PlanAnimation[]): void => setValue({ ...params, plan: { ...plan, animations } satisfies InteractionPlanData });
  const apply = (preset: Preset): void => {
    if (isLottie) return layer ? writeLottie(false) : undefined;
    if (targets.length === 0) return;
    const ids = new Set(targets.map((item) => item.id));
    write([
      ...plan.animations.filter((animation) => !(ids.has(animation.layer) && animation.id.startsWith(`${preset.id}-`))),
      ...targets.map((item) => preset.make({ id: item.id, name: item.displayName ?? item.name }, scene, size, spec && frame ? floatRoom(spec, layers, params, item.id, frame) : null)),
    ]);
  };
  const remove = (preset: Preset): void => {
    if (isLottie) return writeLottie(true);
    const ids = new Set(targets.map((item) => item.id));
    if (ids.size > 0) write(plan.animations.filter((animation) => !(ids.has(animation.layer) && animation.id.startsWith(`${preset.id}-`))));
  };

  return (
    <div className={styles.root}>
      {!isLottie && tagged.length > 0 ? (
        <Select
          name="Apply to"
          onValueChange={(next) => setTarget(next)}
          options={[{ label: "Selected layer", value: "selected" }, ...tagged.map((entry) => ({ label: `Tag: ${tagLabel(entry.tag)} (${entry.layers.length})`, value: entry.tag }))]}
          value={group ? target : "selected"}
        />
      ) : null}
      <FieldDescription>
        {group ? `${group.length} ${tagLabel(target).toLowerCase()}-tagged layer${group.length === 1 ? "" : "s"}` : layer ? `Selected layer: ${layer.displayName ?? layer.name}` : "Select a layer in the Layers panel, then apply a preset to it."}
      </FieldDescription>
      {isLottie && layer && (lottieLayer === null || lottieMoves) ? <FieldDescription>{lottieLayer === null ? "Pick a layer of the Lottie animation (not the group)." : "This layer already moves in the Lottie file."}</FieldDescription> : null}
      {PRESETS.map((preset) => {
        const on = isLottie
          ? layer
            ? lottieFloating(lottieLayer)
            : false
          : targets.length > 0 && targets.every((item) => plan.animations.some((animation) => isPreset(animation, preset, item.id)));
        const blocked = isLottie && (lottieLayer === null || lottieMoves);
        return (
          <div className={on ? `${styles.card} ${styles.on}` : styles.card} key={preset.id}>
            <span className={styles.name}>{preset.name}</span>
            <span className={styles.note}>{preset.note}</span>
            <div className={styles.actions}>
              <Button disabled={targets.length === 0 || blocked} onClick={() => apply(preset)} size="default" type="button" variant="outline">
                {on ? "Apply again" : group ? `Apply to ${group.length} layer${group.length === 1 ? "" : "s"}` : "Apply to selected layer"}
              </Button>
              {on ? (
                <Button onClick={() => remove(preset)} size="default" type="button" variant="ghost">
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
