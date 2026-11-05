import * as React from "react";
import type { ToolcraftCommand } from "@/toolcraft/runtime";
import {
  Button,
  ColorOpacity,
  ControlFieldLabel,
  createControlHistoryGroupId,
  Field,
  FieldDescription,
  FieldError,
  FileDrop,
  Select,
  Slider,
  Textarea,
  TextInput,
} from "@/toolcraft/ui";

import { ANIMATION_LIBRARY_TARGET, ANIMATION_PARAMS_TARGET, readAnimationLibrary, type AnimationSpec } from "../animation/animation-spec";
import {
  BLEND_KEY,
  BLEND_OPTIONS,
  findFigmaItem,
  fontKey,
  POSITION_KEY,
  readFigmaDesign,
  SHAPE_KEY,
  type PositionEdit,
  type ShapeEdit,
  PICTURE_EDITS_KEY,
  pictureFiles,
  TEXT_EDITS_KEY,
  textFonts,
  updateFigmaItem,
  weightOfStyle,
  type FigmaFont,
  type FigmaItem,
  type PictureEdit,
  type TextEdit,
} from "./figma-paste-import";
import { AdvancedToggle, SideBoxes, SidesToggle, StrokeAdvanced, StrokeHead } from "../animation/stroke-fields";
import strokeStyles from "../animation/stroke-fields.module.css";
import { CornerRadiusFields } from "../animation/corner-radius-fields";
import { LayerRotationField } from "../animation/layer-dimension-fields";
import { PositionPair } from "../animation/position-field";
import { ClipSettings } from "./clip-settings";
import styles from "./figma-layer-settings.module.css";
import { checkFontFile, FONT_FILE_ACCEPT, pickableFamilies, readFileAsDataUrl, resolveDesignFonts, saveFontForApp, withCarriedFont } from "./mo-fonts";
import { makeMediaPoster, mediaKindOf, readMediaFile, withAnimatedPicture, withoutAnimatedPicture } from "../media/media-layer";
import { pickMoFile } from "./mo-project-folder";

// The Layer section for a layer of a pasted Figma design: a text's wording and font settings, or a picture's file
// and fit. A text whose font this computer does not have shows as its picture and stays locked until the font file
// is added (it is then kept in the app for every project).

type Props = Readonly<{
  dispatch: (command: ToolcraftCommand) => void;
  layerId: string;
  params: Readonly<Record<string, unknown>>;
  // The project's length, for a video's Match / Fit to project.
  projectSeconds: number;
  spec: AnimationSpec;
  values: Readonly<Record<string, unknown>>;
}>;

const ALIGNS = [
  { label: "Left", value: "LEFT" },
  { label: "Center", value: "CENTER" },
  { label: "Right", value: "RIGHT" },
  { label: "Justified", value: "JUSTIFIED" },
];

const CASES = [
  { label: "As typed", value: "ORIGINAL" },
  { label: "Uppercase", value: "UPPER" },
  { label: "Lowercase", value: "LOWER" },
  { label: "Title case", value: "TITLE" },
];

const WEIGHT_NAMES: Readonly<Record<number, string>> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};
const WEIGHTS = Object.keys(WEIGHT_NAMES).map((weight) => ({ label: weight, value: weight }));

// The style name for a weight, keeping italic.
const styleFor = (weight: number, italic: boolean): string => {
  const name = WEIGHT_NAMES[weight] ?? "Regular";
  return italic ? (name === "Regular" ? "Italic" : `${name} Italic`) : name;
};

// A one-line label gets a text field; a box of paragraph text (or text with line breaks) gets the multiline field.
const isParagraph = (chars: string, resize: string | undefined): boolean =>
  chars.includes("\n") || (resize ? resize !== "WIDTH_AND_HEIGHT" : chars.length > 48);

const readNumber = (raw: string, fallback: number): number => {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
};

// A picture layer takes a still picture, a GIF or a video.
const PICTURE_ACCEPT = "image/*,video/mp4,video/webm,.mp4,.webm,.gif";

const FITS = [
  { label: "Fill", value: "FILL" },
  { label: "Fit", value: "FIT" },
  { label: "Crop", value: "CROP" },
  { label: "Tile", value: "TILE" },
];

const fontLabel = (font: FigmaFont): string => `${font.family} ${font.style}`;

function writeSpec(dispatch: Props["dispatch"], values: Props["values"], next: AnimationSpec, label: string): void {
  const library = readAnimationLibrary(values[ANIMATION_LIBRARY_TARGET]);
  dispatch({ label, target: ANIMATION_LIBRARY_TARGET, type: "controls.setValue", value: { items: { ...library.items, [next.id]: next } } });
}

// The multiline text field: the library's field label and textarea in the text font (CodeTextarea is monospace, for
// code). Typing is one undo step until the field is left.
function ParagraphField({
  disabled,
  name,
  onValueChange,
  value,
}: Readonly<{ disabled: boolean; name: string; onValueChange: (value: string, meta?: { history: "merge"; historyGroup: string }) => void; value: string }>): React.ReactNode {
  const [draft, setDraft] = React.useState(value);
  const group = React.useRef<string | null>(null);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <Field className={styles.field}>
      <ControlFieldLabel>{name}</ControlFieldLabel>
      <Textarea
        aria-label={name}
        className={styles.paragraph}
        disabled={disabled}
        onBlur={() => {
          group.current = null;
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          group.current ??= createControlHistoryGroupId(`text:${name}`);
          onValueChange(event.target.value, { history: "merge", historyGroup: group.current });
        }}
        size="sm"
        value={draft}
      />
    </Field>
  );
}

export function FigmaLayerSettings(props: Props): React.ReactNode {
  const item = findFigmaItem(props.spec, props.layerId);
  if (!item) return null;
  const own =
    item.kind === "text" && item.text ? (
      <TextSettings {...props} item={item} />
    ) : item.pic ? (
      <PictureSettings {...props} item={item} />
    ) : item.kind === "shape" && !item.isMask ? (
      <ShapeSettings {...props} item={item} />
    ) : null;
  return (
    <>
      {own}
      <PositionSettings {...props} item={item} />
      <BlendSettings {...props} item={item} />
      <MaskSettings {...props} item={item} />
    </>
  );
}


// A shape (a box, a circle, a line of a design): only the controls it needs are shown, found from what was pasted: its
// fills (a color, or the colors of a gradient), strokes with their width, corner radius (one value or one per corner),
// its effects and its opacity.
type PaintLike = { alpha?: number; color?: string; opacity?: number; stops?: { alpha?: number; color: string; position: number }[]; type?: string };
const asPaints = (list: readonly unknown[] | undefined): PaintLike[] => (Array.isArray(list) ? (list.filter((paint) => typeof paint === "object" && paint !== null) as PaintLike[]) : []);
const percent = (value: number | undefined): number => Math.round((value ?? 1) * 100);
const CORNERS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;

// A frame layer's own look: its fill, stroke, opacity, effects and blend mode. Its corner radius (and Clip content) are the group's, set above it.
export function FrameSettings(props: Props): React.ReactNode {
  const item = findFigmaItem(props.spec, props.layerId);
  if (!item?.frame) return null;
  return (
    <>
      <ShapeSettings {...props} hideRadius item={item} />
      <BlendSettings {...props} item={item} />
    </>
  );
}

function ShapeSettings({ dispatch, hideRadius: hideRadiusProp = false, item, params }: Props & Readonly<{ hideRadius?: boolean; item: FigmaItem }>): React.ReactNode {
  const hideRadius = hideRadiusProp || !!item.paths || !!item.line;
  const edits = (params[SHAPE_KEY] ?? {}) as Readonly<Record<string, ShapeEdit>>;
  const edit = edits[item.id] ?? {};
  const setEdit = (patch: ShapeEdit, label: string, historyGroup?: string): void =>
    dispatch({ historyGroup, label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [SHAPE_KEY]: { ...edits, [item.id]: { ...edit, ...patch } } } });

  const fills = asPaints((edit.fills ?? item.fills) as unknown[]);
  const strokes = asPaints((edit.strokes ?? item.strokes) as unknown[]);
  const radius = edit.radius ?? item.radius;
  const sw = edit.sw ?? item.sw;
  const dash = edit.dash ?? [];
  const sides = edit.sides ?? [];
  // The line style fields (dashes, ends, joins) open from the button after Weight; they start open when the stroke is not plain.
  const [advanced, setAdvanced] = React.useState(dash.length > 0 || !!edit.cap || !!edit.join);
  const hasFx = item.effects.length > 0;
  const fillsEditable = !item.fillAsset && !item.pic;

  const setFill = (index: number, change: (paint: PaintLike) => PaintLike): void => {
    const next = fills.map((paint, at) => (at === index ? change(paint) : paint));
    setEdit({ fills: next }, "Shape fill");
  };
  const setStroke = (index: number, change: (paint: PaintLike) => PaintLike): void => {
    const next = strokes.map((paint, at) => (at === index ? change(paint) : paint));
    setEdit({ strokes: next }, "Shape stroke");
  };
  const effectNames = [...new Set(item.effects.map((fx) => String((fx as { type?: string }).type ?? "effect").toLowerCase().replace(/_/g, " ")))];

  return (
    <div className={styles.root}>
      {fillsEditable ? (
        <StrokeHead
          hasStroke={fills.length > 0}
          onAdd={() => setEdit({ fills: [{ color: "#D9D9D9", opacity: 1, type: "SOLID" }] }, "Add fill")}
          onRemove={() => setEdit({ fills: [] }, "Remove fill")}
          title="Fill"
        />
      ) : null}
      {fillsEditable
        ? fills.map((paint, index) => {
            const label = fills.length > 1 ? `Fill ${index + 1}` : "Fill";
            if (paint.type === "SOLID") {
              return (
                <ColorOpacity
                  hex={paint.color ?? "#000000"}
                  key={`fill-${index}`}
                  name={label}
                  onValueChange={(next) => setFill(index, (own) => ({ ...own, color: next.hex, opacity: next.opacity / 100 }))}
                  opacity={percent(paint.opacity)}
                  showLabel={fills.length > 1}
                />
              );
            }
            if (paint.stops && paint.stops.length > 0) {
              return (
                <div className={styles.root} key={`fill-${index}`}>
                  {paint.stops.slice(0, 6).map((stop, at) => (
                    <ColorOpacity
                      hex={stop.color}
                      key={`stop-${at}`}
                      name={`${label} · ${Math.round(stop.position * 100)}%`}
                      onValueChange={(next) =>
                        setFill(index, (own) => ({ ...own, stops: (own.stops ?? []).map((own2, to) => (to === at ? { ...own2, alpha: next.opacity / 100, color: next.hex } : own2)) }))
                      }
                      opacity={percent(stop.alpha)}
                      showLabel={fills.length > 1}
                    />
                  ))}
                </div>
              );
            }
            return null;
          })
        : null}
      {!fillsEditable ? <FieldDescription>This shape is filled with a picture or several colors; its look comes from that picture.</FieldDescription> : null}
      <StrokeHead
        hasStroke={strokes.length > 0}
        onAdd={() => setEdit({ dash: [], sides: [], sp: "INSIDE", strokes: [{ color: "#000000", opacity: 1, type: "SOLID" }], sw: 1 }, "Add stroke")}
        onRemove={() => setEdit({ dash: [], sides: [], strokes: [], sw: 0 }, "Remove stroke")}
      />
      {strokes.map((paint, index) => {
        const label = strokes.length > 1 ? `Stroke ${index + 1}` : "Stroke";
        if (paint.type === "SOLID") {
          return (
            <ColorOpacity
              hex={paint.color ?? "#000000"}
              key={`stroke-${index}`}
              name={label}
              onValueChange={(next) => setStroke(index, (own) => ({ ...own, color: next.hex, opacity: next.opacity / 100 }))}
              opacity={percent(paint.opacity)}
              showLabel={strokes.length > 1}
            />
          );
        }
        if (paint.stops && paint.stops.length > 0) {
          return (
            <div className={styles.root} key={`stroke-${index}`}>
              {paint.stops.slice(0, 6).map((stop, at) => (
                <ColorOpacity
                  hex={stop.color}
                  key={`stroke-stop-${at}`}
                  name={`${label} · ${Math.round(stop.position * 100)}%`}
                  onValueChange={(next) =>
                    setStroke(index, (own) => ({ ...own, stops: (own.stops ?? []).map((own2, to) => (to === at ? { ...own2, alpha: next.opacity / 100, color: next.hex } : own2)) }))
                  }
                  opacity={percent(stop.alpha)}
                  showLabel={strokes.length > 1}
                />
              ))}
            </div>
          );
        }
        return null;
      })}
      {strokes.length > 0 ? (
        <>
          <div className={!item.paths && !item.line ? strokeStyles.weightRow : strokeStyles.weightRowShort}>
            {!item.paths && !item.line ? (
              <Select
                name="Position"
                onValueChange={(next) => setEdit({ sp: next }, "Stroke position")}
                options={[
                  { label: "Inside", value: "INSIDE" },
                  { label: "Center", value: "CENTER" },
                  { label: "Outside", value: "OUTSIDE" },
                ]}
                value={edit.sp ?? "INSIDE"}
              />
            ) : null}
            <TextInput
              commitOnBlur
              disabled={sides.length === 4}
              name="Weight"
              onValueChange={(raw) => setEdit({ sw: Math.max(0, readNumber(raw, sw)) }, "Stroke width")}
              value={sides.length === 4 ? "Mixed" : String(Math.round(sw * 100) / 100)}
            />
            {!item.paths && !item.line && !item.ellipse ? (
              <SidesToggle
                each={sides.length === 4}
                onToggle={() => (sides.length === 4 ? setEdit({ sides: [], sw: Math.max(...sides) }, "Stroke sides") : setEdit({ sides: [sw, sw, sw, sw] }, "Stroke sides"))}
              />
            ) : null}
            <AdvancedToggle onToggle={() => setAdvanced((on) => !on)} open={advanced} />
          </div>
          {sides.length === 4 ? <SideBoxes onChange={(next) => setEdit({ sides: next, sw: Math.max(...next) }, "Stroke sides")} sides={sides} /> : null}
          {advanced ? <StrokeAdvanced>
            <Select
              name="Style"
              onValueChange={(next) => setEdit({ dash: next === "dashed" ? [Math.max(4, Math.round(sw * 3)), Math.max(3, Math.round(sw * 2))] : [] }, "Stroke style")}
              options={[
                { label: "Solid", value: "solid" },
                { label: "Dashed", value: "dashed" },
              ]}
              value={dash.length > 0 ? "dashed" : "solid"}
            />
            {dash.length > 0 ? (
              <div className={styles.pair}>
                <TextInput commitOnBlur name="Dash" onValueChange={(raw) => setEdit({ dash: [Math.max(1, readNumber(raw, dash[0] ?? 4)), dash[1] ?? dash[0] ?? 4] }, "Stroke dash")} value={String(dash[0] ?? 4)} />
                <TextInput commitOnBlur name="Gap" onValueChange={(raw) => setEdit({ dash: [dash[0] ?? 4, Math.max(0, readNumber(raw, dash[1] ?? dash[0] ?? 4))] }, "Stroke gap")} value={String(dash[1] ?? dash[0] ?? 4)} />
              </div>
            ) : null}
            <div className={styles.pair}>
              <Select
                name="Ends"
                onValueChange={(next) => setEdit({ cap: next }, "Stroke ends")}
                options={[
                  { label: "None", value: "BUTT" },
                  { label: "Round", value: "ROUND" },
                  { label: "Square", value: "SQUARE" },
                ]}
                value={edit.cap ?? item.cap ?? "BUTT"}
              />
              <Select
                name="Joins"
                onValueChange={(next) => setEdit({ join: next }, "Stroke joins")}
                options={[
                  { label: "Miter", value: "MITER" },
                  { label: "Bevel", value: "BEVEL" },
                  { label: "Round", value: "ROUND" },
                ]}
                value={edit.join ?? item.join ?? "MITER"}
              />
            </div>
          </StrokeAdvanced> : null}
        </>
      ) : null}
      {!hideRadius && !item.ellipse ? <CornerRadiusFields onChange={(next, historyGroup) => setEdit({ radius: next }, "Corner radius", historyGroup)} radius={radius} /> : null}
      <Slider
        max={100}
        min={0}
        name="Opacity"
        onValueChange={(value, meta) => setEdit({ am: Math.min(100, Math.max(0, Math.round(value))) / 100 }, "Shape opacity", meta?.historyGroup)}
        step={1}
        unit="%"
        value={Math.round((edit.am ?? 1) * 100)}
      />
      {hasFx ? (
        <Select
          name={`Effects (${effectNames.join(", ")})`}
          onValueChange={(next) => setEdit({ fx: next === "on" }, "Shape effects")}
          options={[
            { label: "On", value: "on" },
            { label: "Off", value: "off" },
          ]}
          value={edit.fx === false ? "off" : "on"}
        />
      ) : null}
    </div>
  );
}


// Where the layer sits: X and Y in design pixels (from the artboard's top-left of the pasted design). Changing them moves
// the layer from where it was pasted; the stored value is that move.
function PositionSettings({ dispatch, item, params }: Props & Readonly<{ item: FigmaItem }>): React.ReactNode {
  if (item.isMask) return null;
  const moves = (params[POSITION_KEY] ?? {}) as Readonly<Record<string, PositionEdit>>;
  const move = moves[item.id] ?? {};
  const baseX = Math.round(item.m ? item.m[4] : item.x);
  const baseY = Math.round(item.m ? item.m[5] : item.y);
  const setMove = (patch: PositionEdit, historyGroup?: string): void => {
    const next = { ...move, ...patch };
    const rest = { ...moves };
    if (!next.x && !next.y) delete rest[item.id];
    else rest[item.id] = next;
    dispatch({ historyGroup, label: "Layer position", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [POSITION_KEY]: rest } } as ToolcraftCommand);
  };
  return (
    <>
      <PositionPair onXChange={(value, historyGroup) => setMove({ x: value - baseX }, historyGroup)} onYChange={(value, historyGroup) => setMove({ y: value - baseY }, historyGroup)} x={baseX + Math.round(move.x ?? 0)} y={baseY + Math.round(move.y ?? 0)} />
      <LayerRotationField dispatch={dispatch as (command: Record<string, unknown>) => void} layerId={item.id} params={params} />
    </>
  );
}

// How the layer blends with what is under it: the mode it was pasted with, or another one picked here.
function BlendSettings({ dispatch, item, params }: Props & Readonly<{ item: FigmaItem }>): React.ReactNode {
  if (item.isMask) return null;
  const picks = (params[BLEND_KEY] ?? {}) as Readonly<Record<string, string>>;
  const current = picks[item.id] ?? item.blend ?? "source-over";
  const options = BLEND_OPTIONS.some((option) => option.value === current) ? BLEND_OPTIONS : [...BLEND_OPTIONS, { label: current, value: current }];
  return (
    <Select
      name="Blend mode"
      onValueChange={(next) =>
        dispatch({
          label: "Blend mode",
          target: ANIMATION_PARAMS_TARGET,
          type: "controls.setValue",
          value: { ...params, [BLEND_KEY]: { ...picks, [item.id]: next } },
        })
      }
      options={options}
      value={current}
    />
  );
}

// A layer masked in Figma shows which mask layer cuts it; another of the design's mask layers (or none) can be picked.
const MASK_KEY = "__mask";
const NO_MASK = "none";
function MaskSettings({ dispatch, item, params, spec }: Props & Readonly<{ item: FigmaItem }>): React.ReactNode {
  const block = readFigmaDesign(spec)?.blocks.find((own) => own.items.some((candidate) => candidate.id === item.id));
  const masks = block?.masks;
  if (!masks || Object.keys(masks).length === 0) return null;
  if (item.isMask) return <FieldDescription>This is a mask layer: it is not drawn itself, it cuts the layers it masks.</FieldDescription>;
  const picks = (params[MASK_KEY] ?? {}) as Readonly<Record<string, string>>;
  const chosen = Object.prototype.hasOwnProperty.call(picks, item.id) ? picks[item.id] : item.mask;
  const value = chosen && masks[chosen] ? chosen : NO_MASK;
  const options = [{ label: "No mask", value: NO_MASK }, ...Object.entries(masks).map(([id, mask]) => ({ label: mask.name, value: id }))];
  return (
    <Select
      name="Masked by"
      onValueChange={(next) =>
        dispatch({
          label: "Mask layer",
          target: ANIMATION_PARAMS_TARGET,
          type: "controls.setValue",
          value: { ...params, [MASK_KEY]: { ...picks, [item.id]: next === NO_MASK ? "" : next } },
        })
      }
      options={options}
      value={value}
    />
  );
}

function TextSettings({ dispatch, item, params, spec, values }: Props & Readonly<{ item: FigmaItem }>): React.ReactNode {
  const text = item.text;
  const [families, setFamilies] = React.useState<readonly string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const specRef = React.useRef(spec);
  specRef.current = spec;

  React.useEffect(() => {
    let cancelled = false;
    void pickableFamilies(specRef.current).then((list) => {
      if (!cancelled) setFamilies(list);
    });
    return () => {
      cancelled = true;
    };
  }, [spec.id, spec.fonts.length]);

  if (!text) return null;
  const missingKeys = new Set(text.missing ?? []);
  const missing = textFonts(text).filter((font) => missingKeys.has(fontKey(font)));
  const locked = missing.length > 0;
  const edits = (params[TEXT_EDITS_KEY] ?? {}) as Readonly<Record<string, TextEdit>>;
  const edit = edits[item.id] ?? {};
  const current = { ...text, ...edit };

  const setEdit = (patch: TextEdit, label: string): void => {
    const next: TextEdit = { ...edit, ...patch };
    dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [TEXT_EDITS_KEY]: { ...edits, [item.id]: next } } });
  };

  // The font file for the first missing font: checked, added to this design, and saved for every project.
  const addFont = (font: FigmaFont): void => {
    setError(null);
    setNote(null);
    pickMoFile(FONT_FILE_ACCEPT)
      .then(async (file) => {
        setAdding(true);
        const dataUrl = await readFileAsDataUrl(file);
        await checkFontFile(font.family, dataUrl);
        const next = await resolveDesignFonts(withCarriedFont(specRef.current, font, dataUrl));
        writeSpec(dispatch, values, next, `Add font ${fontLabel(font)}`);
        const saved = await saveFontForApp(font, file.name, dataUrl);
        setNote(saved ? `${fontLabel(font)} is saved in the app; designs that need it get it by themselves.` : `${fontLabel(font)} was added to this project (the app's font folder could not be reached).`);
      })
      .catch((failure: unknown) => {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setError(failure instanceof Error ? failure.message : "Could not add that font.");
      })
      .finally(() => setAdding(false));
  };

  const familyOptions = [...new Set([current.family, ...families])].map((family) => ({ label: family, value: family }));
  const italic = /italic|oblique/i.test(current.style);
  const weight = String(Math.round((current.weight || 400) / 100) * 100);
  const solid = item.fills.find((fill): fill is { color: string; opacity?: number; type: string } => typeof fill === "object" && fill !== null && (fill as { type?: string }).type === "SOLID");
  const hex = current.color ?? solid?.color ?? "#000000";
  const opacity = current.opacity ?? Math.round((solid?.opacity ?? 1) * 100);
  const paragraph = isParagraph(text.chars, text.resize);

  return (
    <div className={styles.root}>
      {locked ? (
        <div className={styles.missing}>
          <FieldError>{`Font missing: ${missing.map(fontLabel).join(", ")}. This text shows as a picture and cannot be edited until the font is added.`}</FieldError>
          <Button disabled={adding} onClick={() => missing[0] && addFont(missing[0])} size="sm" type="button" variant="outline">
            {adding ? "Adding font…" : `Add ${missing[0] ? fontLabel(missing[0]) : "font"} file…`}
          </Button>
          <FieldDescription>A .ttf, .otf, .woff or .woff2 file. It is saved in the app, so the next design with this font gets it by itself.</FieldDescription>
        </div>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
      {note ? <FieldDescription>{note}</FieldDescription> : null}
      <div aria-disabled={locked} className={locked ? `${styles.root} ${styles.locked}` : styles.root}>
        {paragraph ? (
          <ParagraphField disabled={locked} name="Text" onValueChange={(chars) => setEdit({ chars }, "Edit text")} value={current.chars} />
        ) : (
          <TextInput disabled={locked} name="Text" onValueChange={(chars) => setEdit({ chars }, "Edit text")} value={current.chars} />
        )}
        <div className={styles.pair}>
          <Select disabled={locked} name="Font" onValueChange={(family) => setEdit({ family }, "Text font")} options={familyOptions} value={current.family} />
          <Select
            disabled={locked}
            name="Weight"
            onValueChange={(next) => setEdit({ style: styleFor(Number(next), italic), weight: Number(next) }, "Text weight")}
            options={WEIGHTS}
            value={weight}
          />
        </div>
        <div className={styles.pair}>
          <TextInput
            commitOnBlur
            disabled={locked}
            name="Size"
            onValueChange={(raw) => setEdit({ size: Math.max(1, readNumber(raw, current.size)) }, "Text size")}
            value={String(Math.round(current.size * 10) / 10)}
          />
          <Select disabled={locked} name="Case" onValueChange={(next) => setEdit({ case: next }, "Text case")} options={CASES} value={current.case ?? "ORIGINAL"} />
        </div>
        <ColorOpacity
          hex={hex}
          name="Color"
          onValueChange={(next) => setEdit({ color: next.hex, opacity: next.opacity }, "Text color")}
          opacity={opacity}
          showLabel
        />
        <div className={styles.pair}>
          <TextInput
            commitOnBlur
            disabled={locked}
            name="Line height"
            onValueChange={(raw) => setEdit({ lh: Math.max(0, readNumber(raw, current.lh)) }, "Line height")}
            value={String(Math.round(current.lh * 10) / 10)}
          />
          <TextInput
            commitOnBlur
            disabled={locked}
            name="Letter spacing"
            onValueChange={(raw) => setEdit({ ls: readNumber(raw, current.ls) }, "Letter spacing")}
            value={String(Math.round(current.ls * 10) / 10)}
          />
        </div>
        <Select disabled={locked} name="Align" onValueChange={(align) => setEdit({ align }, "Text align")} options={ALIGNS} value={current.align} />
      </div>
    </div>
  );
}

// A thumbnail of a video or GIF: its first frame with a small play icon in the middle (only the preview; the file is
// not changed).
const playThumbs = new Map<string, Promise<string>>();
function withPlayIcon(source: string): Promise<string> {
  let made = playThumbs.get(source);
  if (!made) {
    made = new Promise<string>((resolve) => {
      const image = new Image();
      image.onload = () => {
        const side = 160;
        const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(source);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        ctx.drawImage(image, (side - w) / 2, (side - h) / 2, w, h);
        const r = 22;
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.beginPath();
        ctx.arc(side / 2, side / 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(side / 2 - 6, side / 2 - 10);
        ctx.lineTo(side / 2 + 11, side / 2);
        ctx.lineTo(side / 2 - 6, side / 2 + 10);
        ctx.closePath();
        ctx.fill();
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => resolve(source);
      image.src = source;
    });
    playThumbs.set(source, made);
  }
  return made;
}

function usePlayThumbs(sources: readonly string[]): Readonly<Record<string, string>> {
  const [thumbs, setThumbs] = React.useState<Readonly<Record<string, string>>>({});
  const key = sources.join("|");
  React.useEffect(() => {
    let cancelled = false;
    void Promise.all(sources.map(async (source) => [source, await withPlayIcon(source)] as const)).then((pairs) => {
      if (!cancelled) setThumbs(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // The list of sources is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return thumbs;
}

function PictureSettings({ dispatch, item, params, projectSeconds, spec, values }: Props & Readonly<{ item: FigmaItem }>): React.ReactNode {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const pic = item.pic;
  // Video and GIF thumbnails get a play icon (worked out before anything returns, as hooks must).
  const thumbs = usePlayThumbs(
    (pic ? pictureFiles(pic) : []).filter((key) => spec.assetMedia?.[key]).map((key) => spec.assets[key] ?? "").filter(Boolean),
  );
  if (!pic) return null;
  const edits = (params[PICTURE_EDITS_KEY] ?? {}) as Readonly<Record<string, PictureEdit>>;
  const edit = edits[item.id] ?? {};
  const mode = edit.mode ?? pic.mode;
  const files = pictureFiles(pic);
  const shown = edit.show && files.includes(edit.show) ? edit.show : files[0];

  const setEdit = (patch: PictureEdit, label: string): void =>
    dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [PICTURE_EDITS_KEY]: { ...edits, [item.id]: { ...edit, ...patch } } } });
  const setFiles = (next: AnimationSpec, list: string[]): AnimationSpec =>
    updateFigmaItem(next, item.id, (own) => {
      if (!own.pic) return own;
      const { video: _waiting, ...rest } = own.pic;
      return { ...own, pic: { ...rest, files: list, only: true } };
    });

  // + adds files next to the ones already there (pictures, GIFs, videos); the last one added is shown.
  const add = async (picked: readonly File[]): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      let next: AnimationSpec = spec;
      const list = [...files];
      for (const file of picked) {
        let n = list.length + 1;
        while (next.assets[`${pic.asset}-${n}`] || list.includes(`${pic.asset}-${n}`)) n += 1;
        const key = `${pic.asset}-${n}`;
        if (mediaKindOf(file)) {
          const info = await readMediaFile(file);
          next = withAnimatedPicture(next, key, info, await makeMediaPoster(info));
        } else if (file.type.startsWith("image/")) {
          next = { ...next, assets: { ...next.assets, [key]: await readFileAsDataUrl(file) } };
        } else {
          throw new Error("Choose pictures (PNG, JPEG, WebP, SVG), GIFs, or MP4 or WebM videos.");
        }
        list.push(key);
      }
      const last = list[list.length - 1];
      writeSpec(dispatch, values, setFiles(next, list), "Add picture files");
      if (last) setEdit({ show: last }, "Show picture file");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not use that file.");
    } finally {
      setBusy(false);
    }
  };
  // × removes one file (its picture or clip goes from the project); another one is shown.
  const remove = (key: string): void => {
    const list = files.filter((file) => file !== key);
    const still = withoutAnimatedPicture(spec, key);
    const { [key]: _gone, ...assets } = still.assets;
    writeSpec(dispatch, values, setFiles({ ...still, assets }, list), "Remove picture file");
    if (shown === key) setEdit({ show: list[0] }, "Show picture file");
  };
  const kindOf = (key: string): string => {
    const media = spec.assetMedia?.[key];
    return media ? (media.kind === "gif" ? "GIF" : "Video") : "Picture";
  };

  return (
    <div className={styles.root}>
      {pic.video ? <FieldDescription>A video fill in Figma: this shows its picture. Add the video file to play it here.</FieldDescription> : null}
      <FileDrop
        onFilesSelect={(picked) => {
          if (picked.length > 0 && !busy) void add(picked);
        }}
        onItemRemove={(file) => remove(file.id)}
        onItemSelect={(file) => setEdit({ show: file.id }, "Show picture file")}
        onItemsReorder={(ordered) => writeSpec(dispatch, values, setFiles(spec, ordered.map((file) => file.id)), "Reorder picture files")}
        presentation={{
          accept: PICTURE_ACCEPT,
          allowsFileBatch: true,
          allowsFolderSelection: false,
          emptyDescription: "PNG, JPEG, WebP, SVG, GIF, MP4 or WebM",
          emptyTitle: "Add pictures or videos",
          items: files.map((key) => ({
            alt: key === shown ? `${kindOf(key)} (shown)` : kindOf(key),
            assetKind: "image",
            fileName: kindOf(key),
            id: key,
            previewSrc: spec.assetMedia?.[key] ? (thumbs[spec.assets[key] ?? ""] ?? spec.assets[key]) : spec.assets[key],
          })),
          presenter: "image-grid",
          secondaryActions: [],
        }}
      />
      {files.length > 1 ? <FieldDescription>{`Showing ${files.indexOf(shown ?? "") + 1} of ${files.length}: click a file to show it.`}</FieldDescription> : null}
      {busy ? <FieldDescription>Reading the files…</FieldDescription> : null}
      {shown && spec.assetMedia?.[shown] ? (
        <ClipSettings clipKey={shown} dataUrl={spec.assets[spec.assetMedia[shown]?.asset ?? ""]} dispatch={dispatch} media={spec.assetMedia[shown]} params={params} projectSeconds={projectSeconds} />
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
      <Select name="Fit" onValueChange={(next) => setEdit({ mode: next }, "Picture fit")} options={FITS} value={mode} />
    </div>
  );
}
