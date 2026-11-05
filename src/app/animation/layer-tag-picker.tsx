import { PencilSimple } from "@phosphor-icons/react";
import * as React from "react";
import { FieldDescription, Input, Select } from "@/toolcraft/ui";

import {
  LAYER_TAGS,
  LAYER_TAGS_KEY,
  LAYER_TAG_NOTES,
  MAX_TAG_LENGTH,
  TAG_RENAMES_KEY,
  layerTagInfo,
  normalizeTag,
  renamedTag,
  tagKey,
  tagLabel,
  tagsInUse,
} from "../mo/mo-layer-tags";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { useActiveLayerId } from "../mo/mo-layer-selection";
import { ANIMATION_PARAMS_TARGET, getActiveAnimation, resolveParams, type AnimationSpec } from "./animation-spec";
import styles from "./animation-controls.module.css";
import tagStyles from "./layer-tag-picker.module.css";


const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

// Modifier > Layer > Tag: what kind of layer this is. The Figma plugin sets it (or the app works it out); picking another here changes it for
// this layer only, and never goes back to the plugin. New tags are made in the plugin; the pen here renames this tag for every layer that
// has it (in this project only). Motion tab > Preset > Apply to can then give one motion to every layer with a tag.
export function LayerTagPicker({
  dispatch,
  layer,
  layers,
  params,
  spec,
}: Readonly<{
  dispatch: (command: Record<string, unknown>) => void;
  layer: Readonly<{ id: string; kind?: string }>;
  layers: readonly Readonly<{ id: string; kind?: string }>[];
  params: Record<string, unknown>;
  spec: AnimationSpec;
}>): React.ReactNode {
  const [draft, setDraft] = React.useState<{ text: string } | null>(null);
  React.useEffect(() => setDraft(null), [layer.id]);
  const info = layerTagInfo(spec, layer, params);
  const write = (patch: Record<string, unknown>, label: string): void =>
    dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, ...patch } });

  // The layer's own tag: the plugin's or the automatic one, as the project names it.
  const fallback = layerTagInfo(spec, layer, { ...params, [LAYER_TAGS_KEY]: {} });
  const setOwn = (tag: string): void => {
    const next = { ...asRecord(params[LAYER_TAGS_KEY]) };
    const clean = normalizeTag(tag);
    if (!clean || (fallback && tagKey(clean) === tagKey(fallback.tag))) delete next[layer.id];
    else next[layer.id] = clean;
    write({ [LAYER_TAGS_KEY]: next }, "Layer tag");
  };
  // Renames the tag this layer has, for every layer that has it.
  const renameCurrent = (to: string): void => {
    if (!info) return;
    const from = tagKey(info.tag);
    const next = { ...asRecord(params[TAG_RENAMES_KEY]) };
    let reached = false;
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === "string" && tagKey(value) === from) {
        next[key] = to;
        reached = true;
      }
    }
    if (!reached) next[from] = to;
    for (const [key, value] of Object.entries(next)) if (typeof value === "string" && tagKey(value) === key) delete next[key];
    write({ [TAG_RENAMES_KEY]: next }, "Rename tag");
  };

  const commit = (): void => {
    const text = normalizeTag(draft?.text);
    if (!draft || !text) return setDraft(null);
    renameCurrent(text);
    setDraft(null);
  };

  const names = new Map<string, string>();
  for (const tag of [...LAYER_TAGS.map((ready) => renamedTag(ready, params)), ...tagsInUse(spec, layers, params)]) if (!names.has(tagKey(tag))) names.set(tagKey(tag), tag);
  const options = [
    ...[...names.values()].map((tag) => ({ label: tagLabel(tag), value: tag })),
  ];
  const from = info?.source === "plugin" ? "Set in the plugin." : info?.source === "app" ? "Picked here." : "Worked out automatically.";
  const note = info ? LAYER_TAG_NOTES[tagKey(info.tag)] : undefined;

  return (
    <>
      <div className={`${styles.item} ${tagStyles.row}`}>
        {draft ? (
          <Input
            aria-label="New name for this tag"
            autoFocus
            className={tagStyles.grow}
            maxLength={MAX_TAG_LENGTH}
            onBlur={commit}
            onChange={(event) => setDraft({ text: event.target.value })}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(null);
              }
            }}
            value={draft.text}
          />
        ) : (
          <div className={tagStyles.grow}>
            <Select name="Tag" onValueChange={setOwn} options={options} value={info?.tag ?? ""} />
          </div>
        )}
        <button aria-label="Rename this tag" className={tagStyles.pen} disabled={!info} onMouseDown={(event) => event.preventDefault()} onClick={() => setDraft({ text: info?.tag ?? "" })} title="Rename this tag for every layer that has it" type="button">
          <PencilSimple size={14} />
        </button>
      </div>
      {info ? (
        <FieldDescription>
          {note ? `${note} ` : ""}
          {from}
        </FieldDescription>
      ) : null}
    </>
  );
}

// The Tag section of the Modifier tab: the picker for the layer selected in the Layers tab.
export function LayerTagSection({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  const layerId = useActiveLayerId(state.selectedLayerId);
  const layer = state.layers.find((item) => item.id === layerId);
  if (!spec || !layer) return <FieldDescription>Select a layer to see its tag.</FieldDescription>;
  return <LayerTagPicker dispatch={dispatch as (command: Record<string, unknown>) => void} layer={layer} layers={state.layers} params={resolveParams(spec, state.values[ANIMATION_PARAMS_TARGET])} spec={spec} />;
}
