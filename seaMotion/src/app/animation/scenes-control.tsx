import { Eye, EyeSlash } from "@phosphor-icons/react";
import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector, type ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, FieldDescription, Input, Slider, Switch, Tabs, TabsList, TabsTrigger } from "@/toolcraft/ui";

import { getActiveAnimation } from "./animation-spec";
import { NO_POSE, type CameraPose, type SceneCamera } from "./camera";
import { findCameraGroup } from "./camera-group";

import {
  changeScene,
  resolveProjectScenes,
  resolveScenes,
  setScenePreview,
  type SceneEdit,
  type SceneStart,
} from "./scenes";
import { CAMERA_CARD, usePickedCard } from "./timeline-view";
import { RailCard } from "./scroll-plan-control";
import railStyles from "./scroll-plan-control.module.css";
import cardStyles from "./animation-controls.module.css";
import styles from "./scenes-control.module.css";

// A camera made when the switch is turned on: a push in towards the pager and arrows with a small angle, over the whole scene.
function newCamera(duration: number): SceneCamera {
  return { delay: 0, duration: Math.max(0.1, duration), focusX: 88.4, focusY: 59.8, from: NO_POSE, to: { pitch: 4, yaw: -10, zoom: 2.2 } };
}

// Scenes Segment: the scenes of the motion, played one after another. Each scene has its own Interaction plan, animations,
// Reactor and sound; choosing one shows its settings in the sections below.
export function ScenesControl({ dispatch, state, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const timelineSeconds = state.timeline.durationSeconds;
  const scenes = resolveScenes(value, timelineSeconds);
  const active = scenes.items[scenes.activeIndex];
  const [lengthDraft, setLengthDraft] = React.useState<string | null>(null);
  const context = { defaults: state.defaults, timelineSeconds, values: state.values };

  const apply = (edit: SceneEdit | null, label: string): void => {
    if (!edit) return;
    dispatch({ label, type: "controls.apply", values: edit.values });
    if (edit.durationSeconds !== null && Math.abs(edit.durationSeconds - timelineSeconds) > 0.001) dispatch({ durationSeconds: edit.durationSeconds, type: "timeline.setDuration" });
  };
  const commitLength = (): void => {
    const draft = lengthDraft;
    setLengthDraft(null);
    if (draft === null || !active) return;
    const next = Number.parseFloat(draft);
    if (Number.isFinite(next) && Math.abs(next - active.duration) > 0.004) apply(changeScene(context, active.scene.id, { duration: next }), "Scene length");
  };

  return (
    <div className={styles.root}>
      <Switch
        checked={scenes.preview}
        name="Segment wise preview"
        onCheckedChange={(next) => {
          apply(setScenePreview(context, next), "Segment wise preview");
          // Turning it on takes the playhead into the scene on show.
          if (next && active && (state.timeline.currentTimeSeconds < active.start || state.timeline.currentTimeSeconds >= active.end)) {
            dispatch({ currentTimeSeconds: active.start, type: "timeline.setCurrentTime" });
          }
        }}
      />
      {active ? (
        <div className={styles.settings}>
          <span className={styles.label}>Length (s)</span>
          <Input
            aria-label={`${active.scene.name} length in seconds`}
            inputMode="decimal"
            onBlur={commitLength}
            onChange={(event) => setLengthDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setLengthDraft(null);
                event.currentTarget.blur();
              }
            }}
            value={lengthDraft ?? String(Math.round(active.duration * 100) / 100)}
          />
          {active.index > 0 ? (
            <>
              <span className={`${styles.label} ${styles.wide}`}>Starts from</span>
              <Tabs className={styles.wide} onValueChange={(next) => apply(changeScene(context, active.scene.id, { start: (next === "previous" ? "previous" : "design") satisfies SceneStart }), "Scene start")} value={active.scene.start}>
                <TabsList variant="control">
                  <TabsTrigger value="design">Design</TabsTrigger>
                  <TabsTrigger value="previous">Previous end</TabsTrigger>
                </TabsList>
              </Tabs>
            </>
          ) : null}
        </div>
      ) : null}
      <FieldDescription>
        Scenes play one after another. Each has its own Motion Plan, animations, Reactor and sound; the design and layers are shared. A new scene starts with no motion until you build its plan.
      </FieldDescription>
    </div>
  );
}

// The camera as an effect of the scene on show, a card of the Animations tab: a move from one pose to another (zoom onto a point,
// turned a little). Its time (start, length) is the bar in the timeline.
export function SceneCameraCard(): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const picked = usePickedCard();
  // Picking the camera's bar in the timeline opens this card; letting it go folds it.
  React.useEffect(() => {
    setOpen(picked === CAMERA_CARD);
  }, [picked]);
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const defaults = useToolcraftSelector((state) => state.defaults);
  const duration = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const scenes = resolveProjectScenes(values, duration);
  const active = scenes.items[scenes.activeIndex];
  const layers = useToolcraftSelector((state) => state.layers);
  // The camera works on the design's "Camera" group when it has one.
  const onGroup = Boolean(getActiveAnimation(values)?.design) && findCameraGroup(layers) !== null;
  if (!active) return null;
  const change = (camera: SceneCamera | null): void => {
    const edit = changeScene({ defaults, timelineSeconds: duration, values }, active.scene.id, { camera });
    if (edit) dispatch({ label: "Scene camera", type: "controls.apply", values: edit.values });
  };
  const camera = active.scene.camera ?? null;
  const on = camera !== null;
  return (
    <RailCard
      active={false}
      dot="◎"
      index={0}
      last={false}
      looped={false}
      marks={[]}
      onScrub={() => undefined}
      onSelect={(event) => {
        if ((event.target as HTMLElement).closest("[data-segment-body], input, button, textarea, [role=combobox], [role=switch], [role=option], label")) return;
        setOpen(!open);
      }}
      onToggle={() => undefined}
      range={[0, 0]}
      scope="layer"
      selected={open}
    >
      <div className={railStyles.rowHead} data-off={!on || undefined}>
        <span className={railStyles.rowName} style={on ? undefined : { opacity: 0.45 }}>Camera · Zoom, angle, tilt</span>
        <button aria-label={on ? "Turn the camera off" : "Turn the camera on"} aria-pressed={on} className={cardStyles.segmentToggle} onClick={() => change(on ? null : newCamera(active.duration))} type="button">
          {on ? <Eye size={15} /> : <EyeSlash size={15} />}
        </button>
      </div>
      {open && camera ? (
        <div data-segment-body="">
          <CameraEditor camera={camera} duration={active.duration} onChange={change} onGroup={onGroup} />
        </div>
      ) : null}
    </RailCard>
  );
}

// The camera of the scene on show: a move from one pose to another (zoom onto a point, turned a little), over the scene or part of it.
function CameraEditor({
  camera,
  duration,
  onChange,
  onGroup,
}: Readonly<{ camera: SceneCamera | null; duration: number; onChange: (camera: SceneCamera | null) => void; onGroup: boolean }>): React.ReactNode {
  // The frame the camera zooms inside: the whole picture until it is set.
  const area = camera?.area ?? { height: 100, radius: 0, width: 100, x: 0, y: 0 };
  const pose = (key: "from" | "to", change: Partial<CameraPose>): void => {
    if (camera) onChange({ ...camera, [key]: { ...camera[key], ...change } });
  };
  return (
    <div className={styles.camera}>
      {camera ? (
        <>
          <Slider max={6} min={1} name="Zoom start" onValueChange={(zoom) => pose("from", { zoom })} step={0.05} unit="x" value={camera.from.zoom} />
          <Slider max={6} min={1} name="Zoom end" onValueChange={(zoom) => pose("to", { zoom })} step={0.05} unit="x" value={camera.to.zoom} />
          <Slider max={45} min={-45} name="Angle start" onValueChange={(yaw) => pose("from", { yaw })} step={0.5} unit="°" value={camera.from.yaw} />
          <Slider max={45} min={-45} name="Angle end" onValueChange={(yaw) => pose("to", { yaw })} step={0.5} unit="°" value={camera.to.yaw} />
          <Slider max={45} min={-45} name="Tilt start" onValueChange={(pitch) => pose("from", { pitch })} step={0.5} unit="°" value={camera.from.pitch} />
          <Slider max={45} min={-45} name="Tilt end" onValueChange={(pitch) => pose("to", { pitch })} step={0.5} unit="°" value={camera.to.pitch} />
          {onGroup ? (
            <FieldDescription>The camera works on the Camera group: its box is the frame, and the focus points are measured inside it (0% left or top, 100% right or bottom).</FieldDescription>
          ) : (
            <>
              <Slider max={95} min={0} name="Frame X" onValueChange={(x) => onChange({ ...camera, area: { ...area, x } })} step={0.5} unit="%" value={area.x} />
              <Slider max={95} min={0} name="Frame Y" onValueChange={(y) => onChange({ ...camera, area: { ...area, y } })} step={0.5} unit="%" value={area.y} />
              <Slider max={100} min={5} name="Frame width" onValueChange={(width) => onChange({ ...camera, area: { ...area, width } })} step={0.5} unit="%" value={area.width} />
              <Slider max={100} min={5} name="Frame height" onValueChange={(height) => onChange({ ...camera, area: { ...area, height } })} step={0.5} unit="%" value={area.height} />
            </>
          )}
          <Slider max={100} min={0} name="Frame corners" onValueChange={(radius) => onChange({ ...camera, area: { ...area, radius } })} step={1} unit="px" value={area.radius} />
          <Slider max={100} min={0} name="Focus X start" onValueChange={(focusX) => pose("from", { focusX })} step={0.5} unit="%" value={camera.from.focusX ?? camera.focusX} />
          <Slider max={100} min={0} name="Focus Y start" onValueChange={(focusY) => pose("from", { focusY })} step={0.5} unit="%" value={camera.from.focusY ?? camera.focusY} />
          <Slider max={100} min={0} name="Focus X end" onValueChange={(focusX) => pose("to", { focusX })} step={0.5} unit="%" value={camera.to.focusX ?? camera.focusX} />
          <Slider max={100} min={0} name="Focus Y end" onValueChange={(focusY) => pose("to", { focusY })} step={0.5} unit="%" value={camera.to.focusY ?? camera.focusY} />
          <Switch checked={camera.ease === "linear"} name="Linear speed" onCheckedChange={(on) => onChange({ ...camera, ease: on ? "linear" : "smooth" })} />
          <Switch checked={camera.vignette !== false} name="Dark edges" onCheckedChange={(on) => onChange({ ...camera, vignette: on })} />
        </>
      ) : null}
    </div>
  );
}
