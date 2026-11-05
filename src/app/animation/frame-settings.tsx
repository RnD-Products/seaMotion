import { AlignBottom, AlignLeft, AlignRight, AlignTop, Crosshair } from "@phosphor-icons/react";
import type * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, Color, Select, Slider, Switch } from "@/toolcraft/ui";

import { ANIMATION_FRAME_TARGET, ANIMATION_PARAMS_TARGET, getActiveAnimation, getControlLayerId, resolveParams } from "./animation-spec";
import styles from "./animation-controls.module.css";
import { ControlList } from "./control-list";
import { useFrameLayout } from "./design-bounds";
import { FRAME_PANEL_LAYER_ID, FRAME_SIZE_PRESETS, getFrameSizePreset, mergeFrame, readFrameStyle, readFrameTransform, type FrameStyle } from "./frame-transform";
import { FRAME_LAYER_KEY, frameLayerCandidates, frameLayerFor, frameLayerStyle, readFrameLayer, type FrameLayer } from "../mo/figma-paste-import";

// Properties of the imported design. Size is the canvas size; position, rotation and opacity are
// stored under their own target; everything else comes from the design and is stored with the
// animation's values. All of it travels in the project file and in saved versions.
export function FrameSettings({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  // A blank project has no design, so the section starts locked. The Active switch unlocks it by
  // hand; its values are kept with the project and used once a design is open.
  const storedFrame = state.values[ANIMATION_FRAME_TARGET];
  const activated = typeof storedFrame === "object" && storedFrame !== null && (storedFrame as { active?: unknown }).active === true;
  const disabled = !spec && !activated;
  const transform = readFrameTransform(state.values);
  const { height, width } = state.canvas.size;
  const half = Math.max(width, height);

  // A pasted design can have one of its own layers as its frame (Frame layer): Fill, Stroke, Corner radius and Clip
  // content then edit that layer (kept with the design's settings), and the app draws no card of its own.
  const designParams = spec ? resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]) : {};
  const frameLayer = spec?.design ? readFrameLayer(designParams) : null;
  const candidates = spec?.design ? frameLayerCandidates(spec, state.layers) : [];
  const writeFrameLayer = (next: FrameLayer | null, label: string): void => {
    const { [FRAME_LAYER_KEY]: _old, ...rest } = designParams;
    dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: next ? { ...rest, [FRAME_LAYER_KEY]: next } : rest });
  };
  const chooseFrameLayer = (id: string): void => {
    const candidate = candidates.find((item) => item.id === id);
    const next = spec && candidate ? frameLayerFor(spec, candidate) : null;
    writeFrameLayer(next, next ? "Frame layer" : "No frame layer");
  };
  const layerStyle = spec && frameLayer ? frameLayerStyle(spec, frameLayer) : null;
  const style = layerStyle ?? readFrameStyle(state.values);
  // The frame record holds the transform and the style together; an edit changes only its own fields.
  const writeFrame = (patch: Record<string, unknown>, historyGroup?: string): void => {
    dispatch({
      historyGroup,
      label: "Frame setting",
      target: ANIMATION_FRAME_TARGET,
      type: "controls.setValue",
      value: mergeFrame(state.values, patch),
    });
  };
  // Turning Active on adds a "Frame" layer to the Layers panel (the blank project's frame is drawn
  // from it); turning it off removes the layer again.
  const setActive = (next: boolean): void => {
    writeFrame({ active: next });
    const present = state.layers.some((layer) => layer.id === FRAME_PANEL_LAYER_ID);
    if (next && !present) {
      dispatch({ insertIndex: 0, layer: { id: FRAME_PANEL_LAYER_ID, kind: "layer", name: "Frame", visible: true }, type: "layers.add" });
    } else if (!next && present) {
      dispatch({ layerId: FRAME_PANEL_LAYER_ID, type: "layers.delete" });
    }
  };
  const setTransform = (patch: Partial<typeof transform>): void => writeFrame(patch);
  const setStyle = (patch: Partial<FrameStyle>): void => {
    if (frameLayer) writeFrameLayer({ ...frameLayer, ...patch }, "Frame layer setting");
    else writeFrame(patch);
  };
  // Width and Height are the design's own size (the box around what it draws), not the canvas it
  // sits on. Resizing keeps the design's proportions: it sets the frame's scale.
  // On a ratio other than the design's own the frame is fitted to the artboard first; Width and
  // Height show the result and the stored scale is the adjustment on top of it.
  const { bounds, boxH, boxW, fit } = useFrameLayout();
  // A blank project has no design box, so its frame is the artboard (grown by the frame box factors).
  const baseWidth = (bounds?.width ?? (width * boxW) / 100) * fit;
  const baseHeight = (bounds?.height ?? (height * boxH) / 100) * fit;
  // The design's own size at the current fit, whatever the frame box is: the slider ranges stay put.
  const refWidth = baseWidth / (boxW / 100);
  const refHeight = baseHeight / (boxH / 100);
  const setDesignSize = (axis: "height" | "width", next: number): void => {
    const base = axis === "width" ? baseWidth : baseHeight;
    if (transform.lockRatio) {
      // Locked: Width and Height move together and scale the whole design evenly.
      setTransform({ scale: Math.min(400, Math.max(10, Math.round((next / base) * 100))) });
      return;
    }
    // Unlocked: only the frame rectangle changes on this axis; the design inside keeps its size.
    const current = axis === "width" ? boxW : boxH;
    const unit = (base * transform.scale) / 100 / (current / 100);
    const box = Math.min(1000, Math.max(5, Math.round((next / unit) * 100)));
    setTransform(axis === "width" ? { boxW: box } : { boxH: box });
  };

  // Alignment moves the frame against the artboard's edges (or back to the middle). Position X / Y
  // are offsets from the centred, fitted frame, so an edge is half the free space away.
  const frameWidth = (baseWidth * transform.scale) / 100;
  const frameHeight = (baseHeight * transform.scale) / 100;
  const align = (edge: "bottom" | "center" | "left" | "right" | "top"): void => {
    const freeX = Math.round((width - frameWidth) / 2);
    const freeY = Math.round((height - frameHeight) / 2);
    if (edge === "left") setTransform({ x: -freeX });
    else if (edge === "right") setTransform({ x: freeX });
    else if (edge === "top") setTransform({ y: -freeY });
    else if (edge === "bottom") setTransform({ y: freeY });
    else setTransform({ x: 0, y: 0 });
  };
  // Centre sits in the middle of the row, with the four edges around it.
  const ALIGNMENTS = [
    { edge: "left", icon: <AlignLeft style={{ height: 16, width: 16 }} />, label: "Align left" },
    { edge: "top", icon: <AlignTop style={{ height: 16, width: 16 }} />, label: "Align top" },
    { edge: "center", icon: <Crosshair style={{ height: 16, width: 16 }} />, label: "Center" },
    { edge: "bottom", icon: <AlignBottom style={{ height: 16, width: 16 }} />, label: "Align bottom" },
    { edge: "right", icon: <AlignRight style={{ height: 16, width: 16 }} />, label: "Align right" },
  ] as const;

  const custom = transform.sizePreset === "custom";
  // A preset sets an absolute frame size; going back to Custom keeps the size it gave, so nothing jumps.
  const chooseSize = (next: string): void => {
    if (next === "custom") setTransform({ boxH, boxW, sizePreset: "custom" });
    else if (getFrameSizePreset(next)) setTransform({ sizePreset: next });
  };

  const designControls = spec ? spec.controls.filter(
        // The frame's own fill, stroke and corner radius replace the design's card.* controls.
        (control) => control.section === "frame" && getControlLayerId(spec, control) === null && !control.id.startsWith("card."),
      ) : [];
  const params = spec ? resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET]) : {};
  return (
    <div className={styles.root}>
    {spec ? null : <Switch checked={activated} name="Active" onCheckedChange={setActive} />}
    <div className={disabled ? `${styles.root} ${styles.disabled}` : styles.root} inert={disabled || undefined}>
      <div className={styles.align}>
        {ALIGNMENTS.map((item) => (
          <Button aria-label={item.label} key={item.edge} onClick={() => align(item.edge)} className={styles.alignButton} size="icon" title={item.label} type="button" variant="ghost">
            {item.icon}
          </Button>
        ))}
      </div>
      {candidates.length > 0 ? (
        <Select
          name="Frame layer"
          onValueChange={chooseFrameLayer}
          options={[{ label: "None (app frame)", value: "none" }, ...candidates.map((item) => ({ label: item.name, value: item.id }))]}
          value={frameLayer && candidates.some((item) => item.id === frameLayer.layer) ? frameLayer.layer : "none"}
        />
      ) : null}
      <Select
        name="Frame size"
        onValueChange={chooseSize}
        options={[
          { label: "Custom", value: "custom" },
          ...FRAME_SIZE_PRESETS.map((preset) => ({ label: `${preset.label}  ${preset.width}×${preset.height}`, value: preset.id })),
        ]}
        value={transform.sizePreset}
      />
      {custom ? <Switch checked={transform.lockRatio} name="Lock ratio" onCheckedChange={(next) => setTransform({ lockRatio: next })} /> : null}
      {custom ? (
        <>
          <Slider
        max={Math.round(refWidth * 4)}
        min={Math.max(1, Math.round(refWidth * 0.1))}
        name="Width"
        onValueChange={(next) => setDesignSize("width", next)}
        step={1}
        unit="px"
        value={Math.round((baseWidth * transform.scale) / 100)}
      />
          <Slider
        max={Math.round(refHeight * 4)}
        min={Math.max(1, Math.round(refHeight * 0.1))}
        name="Height"
        onValueChange={(next) => setDesignSize("height", next)}
        step={1}
        unit="px"
        value={Math.round((baseHeight * transform.scale) / 100)}
      />
        </>
      ) : null}
      <Slider max={half} min={-half} name="Position X" onValueChange={(next) => setTransform({ x: next })} step={1} unit="px" value={transform.x} />
      <Slider max={half} min={-half} name="Position Y" onValueChange={(next) => setTransform({ y: next })} step={1} unit="px" value={transform.y} />
      <Slider max={400} min={10} name="Scale" onValueChange={(next) => setTransform({ scale: next })} step={1} unit="%" value={transform.scale} />
      <Slider max={180} min={-180} name="Rotation" onValueChange={(next) => setTransform({ rotation: next })} step={1} unit="°" value={transform.rotation} />
      <Slider max={100} min={0} name="Opacity" onValueChange={(next) => setTransform({ opacity: next })} step={1} unit="%" value={transform.opacity} />
      <Switch checked={style.clip} name="Clip Content" onCheckedChange={(next) => setStyle({ clip: next })} />
      <div className={styles.pair}>
        <Switch checked={style.fill} name="Fill" onCheckedChange={(next) => setStyle({ fill: next })} />
        <Color hex={style.fillColor} name="Fill color" onValueChange={(next) => setStyle({ fillColor: next.hex })} showLabel={false} />
      </div>
      <div className={styles.pair}>
        <Switch checked={style.stroke} name="Stroke" onCheckedChange={(next) => setStyle({ stroke: next })} />
        <Color hex={style.strokeColor} name="Stroke color" onValueChange={(next) => setStyle({ strokeColor: next.hex })} showLabel={false} />
      </div>
      <Slider
        max={frameLayer ? Math.max(40, Math.round(Math.min(frameLayer.box.w, frameLayer.box.h) / 2)) : Math.max(40, Math.round(Math.min(baseWidth, baseHeight) / 2))}
        min={0}
        name="Corner radius"
        onValueChange={(next) => setStyle({ radius: next })}
        step={1}
        unit="px"
        value={Math.round(style.radius)}
      />
      {designControls.length > 0 ? (
        <ControlList
          controls={designControls}
          onChange={(id, next) =>
            dispatch({ label: "Frame setting", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [id]: next } })
          }
          params={params}
        />
      ) : null}
    </div>
    </div>
  );
}
