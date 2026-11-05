import { readFigmaDesign, withFigmaDesign, type FigmaDesign, type FigmaItem } from "../mo/figma-paste-import";
import type { MediaLayer } from "../media/media-layer";
import type { AnimationSpec } from "./animation-spec";

// Copying, pasting and duplicating a layer of the design (the right-click menu of a layer, Cmd / Ctrl + D): a layer, or a group with everything it
// holds, is copied into a clip (its items, its places in the Layers panel, the settings the project keeps for the layers and the pictures it uses)
// and pasted with new ids. The clip also moves between projects. Duplicate is a copy pasted right above the layer, named "... copy".

type PanelLayer = Readonly<{ collapsed?: boolean; displayName?: string; id: string; kind?: string; name: string; parentGroupId?: string; visible: boolean }>;
type Draft = { collapsed?: boolean; displayName?: string; id: string; kind?: "group" | "layer"; name: string; parentGroupId?: string; visible: boolean };

// layer: a layer (or a group) as it is. group: the main layer without its own fill and clip, so it comes back as a plain group.
// frame: the main layer with its own fill and clip, so it comes back as a frame layer.
export type ClipMode = "frame" | "group" | "layer";

export type LayerClip = Readonly<{
  assetMedia: Readonly<Record<string, MediaLayer>>;
  assets: Readonly<Record<string, string>>;
  imageAssets: readonly string[];
  items: readonly FigmaItem[];
  mode: ClipMode;
  // The panel entries of the clip in the panel's order, the first being its root (ids and parents are the ones they had).
  rows: readonly PanelLayer[];
  rootId: string;
  // What the project kept for these layers: key ("__pos" ...) -> layer id -> setting.
  settings: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>;

export type LayerDuplicate = Readonly<{
  // The Layers panel entries to add, with the place each goes to (an index into the list the panel has now, counting the entries before it).
  adds: readonly Readonly<{ draft: Draft; index: number }>[];
  // The settings of the project's animation parameters with the copies' entries added (null when there is nothing to copy).
  params: Record<string, unknown> | null;
  rootId: string;
  spec: AnimationSpec;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// The picture keys an item draws with.
function assetKeysOf(item: FigmaItem): string[] {
  const keys: string[] = [];
  if (item.png) keys.push(item.png);
  if (item.fillAsset) keys.push(item.fillAsset);
  if (item.text?.img) keys.push(item.text.img);
  if (item.pic) for (const key of item.pic.files ?? [item.pic.asset]) keys.push(key);
  return keys;
}

export function copyLayer(spec: AnimationSpec, layers: readonly PanelLayer[], id: string, params: Readonly<Record<string, unknown>>, mode: ClipMode = "layer"): LayerClip | null {
  const design = readFigmaDesign(spec);
  const root = layers.find((layer) => layer.id === id);
  if (!design || !root) return null;
  // The layer and everything it holds, in the panel's order (a group's rows follow it).
  const block = new Set<string>([id]);
  for (const layer of layers) if (layer.parentGroupId && block.has(layer.parentGroupId)) block.add(layer.id);
  const rows = layers.filter((layer) => block.has(layer.id));
  // A group copy has no fill or clip of its own (and what it held is no longer cut by it).
  const dropRoot = mode === "group";
  const items: FigmaItem[] = [];
  for (const each of design.blocks) {
    for (const item of each.items) {
      if (!block.has(item.id) || (dropRoot && item.id === id)) continue;
      const copy = clone(item);
      if (dropRoot) copy.clips = copy.clips.filter((clip) => clip.f !== id);
      items.push(copy);
    }
  }
  const assets: Record<string, string> = {};
  const assetMedia: Record<string, MediaLayer> = {};
  const imageAssets: string[] = [];
  for (const item of items) {
    for (const key of assetKeysOf(item)) {
      const data = spec.assets[key];
      if (data !== undefined) assets[key] = data;
      const media = spec.assetMedia?.[key];
      if (media) {
        assetMedia[key] = media;
        const clip = spec.assets[media.asset];
        if (clip !== undefined) assets[media.asset] = clip;
      }
      if (spec.imageAssets.includes(key) && !imageAssets.includes(key)) imageAssets.push(key);
    }
  }
  const settings: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith("__") || !isRecord(value)) continue;
    const own: Record<string, unknown> = {};
    for (const row of rows) if (Object.hasOwn(value, row.id)) own[row.id] = clone(value[row.id]);
    if (Object.keys(own).length > 0) settings[key] = own;
  }
  return { assetMedia, assets, imageAssets, items, mode, rows, rootId: id, settings };
}

// Puts a clip into the project: `at` is the index in the Layers panel list where its root goes (the rows before it keep their places) and the
// group it goes into; `suffix` is added to the root's name.
export function pasteClip(
  spec: AnimationSpec,
  layers: readonly PanelLayer[],
  clip: LayerClip,
  params: Readonly<Record<string, unknown>>,
  at: Readonly<{ index: number; parentGroupId?: string }>,
  suffix: string,
): LayerDuplicate | null {
  const design = readFigmaDesign(spec);
  if (!design || design.blocks.length === 0) return null;
  const taken = new Set<string>(layers.map((layer) => layer.id));
  for (const each of design.blocks) for (const item of each.items) taken.add(item.id);
  const fresh = new Map<string, string>();
  for (const row of clip.rows) {
    let n = 1;
    while (taken.has(`${row.id}-d${n}`)) n += 1;
    const next = `${row.id}-d${n}`;
    taken.add(next);
    fresh.set(row.id, next);
  }
  const rootId = fresh.get(clip.rootId) as string;

  // The pictures: a key the project already has with other content gets a new name.
  const renamed = new Map<string, string>();
  const assets: Record<string, string> = { ...spec.assets };
  const assetMedia: Record<string, MediaLayer> = { ...(spec.assetMedia ?? {}) };
  const imageAssets = [...spec.imageAssets];
  const keyFor = (key: string): string => {
    const known = renamed.get(key);
    if (known) return known;
    let next = key;
    let n = 1;
    while (assets[next] !== undefined && assets[next] !== clip.assets[key]) {
      next = `${key}-p${n}`;
      n += 1;
    }
    renamed.set(key, next);
    if (clip.assets[key] !== undefined) assets[next] = clip.assets[key];
    const media = clip.assetMedia[key];
    if (media) assetMedia[next] = { ...media, asset: keyFor(media.asset) };
    if (clip.imageAssets.includes(key) && !imageAssets.includes(next)) imageAssets.push(next);
    return next;
  };

  const copied: { id: string; name: string }[] = [];
  const items = clip.items.map((item) => {
    const copy = clone(item);
    copy.id = fresh.get(item.id) as string;
    copy.clips = copy.clips.map((entry) => (entry.f && fresh.has(entry.f) ? { ...entry, f: fresh.get(entry.f) as string } : entry));
    if (copy.png) copy.png = keyFor(copy.png);
    if (copy.fillAsset) copy.fillAsset = keyFor(copy.fillAsset);
    if (copy.text?.img) copy.text = { ...copy.text, img: keyFor(copy.text.img) };
    if (copy.pic) copy.pic = { ...copy.pic, asset: keyFor(copy.pic.asset), ...(copy.pic.files ? { files: copy.pic.files.map(keyFor) } : {}) };
    const row = clip.rows.find((entry) => entry.id === item.id);
    copied.push({ id: copy.id, name: `${row?.displayName ?? row?.name ?? "Layer"}${item.id === clip.rootId ? suffix : ""}` });
    return copy;
  });
  const first = design.blocks[0] as FigmaDesign["blocks"][number];
  const blocks = design.blocks.map((each, index) => (index === 0 && items.length > 0 ? { ...first, items: [...first.items, ...items] } : each));
  const withItems: FigmaDesign = { ...design, blocks };
  const next = withFigmaDesign({ ...spec, assetMedia, assets, imageAssets, layers: [...spec.layers, ...copied] } as AnimationSpec, withItems);

  const adds = clip.rows.map((row, order) => ({
    draft: {
      ...(row.collapsed === undefined ? {} : { collapsed: row.collapsed }),
      displayName: row.id === clip.rootId ? `${row.displayName ?? row.name}${suffix}` : (row.displayName ?? row.name),
      id: fresh.get(row.id) as string,
      // A group copy of the main layer is a group; a frame copy keeps its frame fill, which sits on its group.
      kind: row.kind === "group" ? ("group" as const) : ("layer" as const),
      name: row.id === clip.rootId ? `${row.name}${suffix}` : row.name,
      ...(row.id === clip.rootId ? (at.parentGroupId ? { parentGroupId: at.parentGroupId } : {}) : row.parentGroupId && fresh.has(row.parentGroupId) ? { parentGroupId: fresh.get(row.parentGroupId) as string } : {}),
      visible: row.visible,
    },
    index: at.index + order,
  }));

  // What the project keeps for a layer in the animation's parameters.
  let changed = false;
  const nextParams: Record<string, unknown> = { ...params };
  for (const [key, entries] of Object.entries(clip.settings)) {
    const existing = isRecord(params[key]) ? (params[key] as Record<string, unknown>) : {};
    const more: Record<string, unknown> = {};
    for (const [from, to] of fresh) if (Object.hasOwn(entries, from)) more[to] = clone(entries[from]);
    if (Object.keys(more).length > 0) {
      nextParams[key] = { ...existing, ...more };
      changed = true;
    }
  }
  return { adds, params: changed ? nextParams : null, rootId, spec: next };
}

// A copy of a layer (a group with everything it holds) right above itself, named "... copy".
export function duplicateLayer(spec: AnimationSpec, layers: readonly PanelLayer[], id: string, params: Readonly<Record<string, unknown>>): LayerDuplicate | null {
  const clip = copyLayer(spec, layers, id, params);
  const start = layers.findIndex((layer) => layer.id === id);
  if (!clip || start < 0) return null;
  const root = layers[start] as PanelLayer;
  return pasteClip(spec, layers, clip, params, { index: start, ...(root.parentGroupId ? { parentGroupId: root.parentGroupId } : {}) }, " copy");
}
