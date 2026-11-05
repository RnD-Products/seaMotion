import type { AnimationSpec } from "../animation/animation-spec";
import { findFigmaItem, frameIds } from "./figma-paste-import";

// A layer's tag says what kind of layer it is, so one motion can be given to every layer of a kind at once (Motion tab > Preset > Apply to).
//   Set in the Figma plugin (Tag, stored as plugin data so the layer's name never changes) or in the app (Modifier > Layer > Tag).
//   A layer with no tag gets one from what it is: picture -> image, text -> text, video file -> video, frame -> frame, group -> group,
//   box / ellipse / line -> shape, drawn outline -> path, exported icon picture -> vector.
//   Tags that are never worked out on their own (only set by hand): icon (a small symbol), button (a tappable box with its label),
//   background (a full-size backdrop layer).
export const LAYER_TAGS = ["image", "text", "video", "frame", "group", "shape", "path", "vector", "icon", "button", "background"] as const;
export type LayerTag = (typeof LAYER_TAGS)[number];

// What each ready-made tag is for (shown under the picker). A tag you make yourself has no note.
export const LAYER_TAG_NOTES: Readonly<Record<string, string>> = {
  background: "A full-size backdrop behind the design.",
  button: "A tappable box with its label.",
  frame: "A Figma frame, auto layout or component: a group with its own fill.",
  group: "A plain group of layers.",
  icon: "A small symbol.",
  image: "A picture, a photo or a GIF.",
  path: "A drawn outline (pen, star, polygon).",
  shape: "A box, circle or line.",
  text: "Text.",
  vector: "An exported SVG picture, such as a logo or an illustration.",
  video: "A video file.",
};

// Where a layer's tag is overridden in the app: layer id -> tag, and the names the app gave tags (tag -> new name). Both stay with the project
// only (a key starting with "__" travels with its settings) and never go back to the plugin.
export const LAYER_TAGS_KEY = "__layerTags";
export const TAG_RENAMES_KEY = "__tagRenames";
export const MAX_TAG_LENGTH = 24;

// A tag is any short name: the ready-made ones above, or one made in the plugin or the app.
export function normalizeTag(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH).trim() : "";
  return text || null;
}

// Two tags are the same tag whatever their capitals.
export const tagKey = (tag: string): string => tag.toLowerCase();

export const tagLabel = (tag: string): string => (isReady(tag) ? tag.charAt(0).toUpperCase() + tag.slice(1) : tag);
const isReady = (tag: string): boolean => (LAYER_TAGS as readonly string[]).includes(tag);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// The name the app gave a tag, if it renamed it.
export function renamedTag(tag: string, params: Record<string, unknown> | undefined): string {
  const to = normalizeTag(record(params?.[TAG_RENAMES_KEY])[tagKey(tag)]);
  return to ?? tag;
}

type LayerLike = Readonly<{ id: string; kind?: string }>;

function setByPlugin(spec: AnimationSpec | null, id: string): string | null {
  for (const block of (spec && (spec.design as { blocks?: { tags?: Record<string, string> }[] } | undefined)?.blocks) ?? []) {
    const found = normalizeTag(block.tags?.[id]);
    if (found) return found;
  }
  return null;
}

// The tag the app works out for a layer that has none set.
export function automaticTag(spec: AnimationSpec | null, layer: LayerLike): LayerTag | null {
  if (!spec) return null;
  const clip = spec.media?.[layer.id];
  if (clip) return clip.kind === "video" ? "video" : "image";
  if (layer.kind === "group") return frameIds(spec).has(layer.id) ? "frame" : "group";
  const item = findFigmaItem(spec, layer.id);
  if (!item) return null;
  if (item.kind === "text") return "text";
  if (item.kind === "png" || item.pic) return "image";
  if (item.kind === "svg") return "vector";
  return item.paths && item.paths.length > 0 ? "path" : "shape";
}

export type TagInfo = Readonly<{ source: "app" | "auto" | "plugin"; tag: string }>;

// The layer's tag: the one picked in the app, else the one set in the plugin, else the automatic one; then the name the app gave that tag.
export function layerTagInfo(spec: AnimationSpec | null, layer: LayerLike, params?: Record<string, unknown>): TagInfo | null {
  const own = normalizeTag(record(params?.[LAYER_TAGS_KEY])[layer.id]);
  const plugin = own ? null : setByPlugin(spec, layer.id);
  const auto = own || plugin ? null : automaticTag(spec, layer);
  const raw = own ?? plugin ?? auto;
  if (!raw) return null;
  return { source: own ? "app" : plugin ? "plugin" : "auto", tag: renamedTag(raw, params) };
}

// Every layer carrying the tag, in the Layers panel's order.
export function layersWithTag<T extends LayerLike>(spec: AnimationSpec | null, layers: readonly T[], params: Record<string, unknown> | undefined, tag: string): T[] {
  return layers.filter((layer) => {
    const found = layerTagInfo(spec, layer, params)?.tag;
    return found !== undefined && tagKey(found) === tagKey(tag);
  });
}

// The tags that exist in the project (on a layer), ready-made ones first, then the others by name.
export function tagsInUse<T extends LayerLike>(spec: AnimationSpec | null, layers: readonly T[], params: Record<string, unknown> | undefined): string[] {
  const seen = new Map<string, string>();
  for (const layer of layers) {
    const found = layerTagInfo(spec, layer, params)?.tag;
    if (found && !seen.has(tagKey(found))) seen.set(tagKey(found), found);
  }
  const rank = (tag: string): number => {
    const at = (LAYER_TAGS as readonly string[]).indexOf(tagKey(tag));
    return at < 0 ? 100 : at;
  };
  return [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
