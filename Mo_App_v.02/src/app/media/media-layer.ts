import type { AnimationSpec, LayerSpec } from "../animation/animation-spec";
import type { ProjectFile } from "../mo/mo-projects";
import { dataUrlToBlob, openMediaClip, type MediaKind } from "./media-clip";

// A video or GIF layer of a project. Its file lives in the spec's assets (a data: URL under `asset`); the app
// decodes it and places it in the design's box, so it works in every project type, under or over the design.
export type MediaLayer = Readonly<{
  asset: string;
  duration: number;
  // cover fills the design's box (cropping), contain shows the whole picture.
  fit: "contain" | "cover";
  height: number;
  kind: MediaKind;
  width: number;
}>;

export type MediaFileInfo = Readonly<{ dataUrl: string; duration: number; height: number; kind: MediaKind; name: string; width: number }>;

// Videos and GIFs are kept inside the project file, which the auto-save helper caps at 96 MB.
export const MAX_MEDIA_BYTES = 40 * 1024 * 1024;
export const MEDIA_FILE_ACCEPT = ".mp4,.webm,.gif,video/mp4,video/webm,image/gif";

export function mediaKindOf(file: Readonly<{ name: string; type: string }>): MediaKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (file.type === "video/mp4" || file.type === "video/webm" || /\.(mp4|m4v|webm)$/.test(name)) return "video";
  return null;
}

export function getMediaLayers(spec: AnimationSpec | null): Readonly<Record<string, MediaLayer>> {
  return spec?.media ?? {};
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

// Reads a picked file and measures it (size, length) by opening it once.
export async function readMediaFile(file: File): Promise<MediaFileInfo> {
  const kind = mediaKindOf(file);
  if (!kind) throw new Error("Choose an MP4, WebM or GIF file.");
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(0)} MB; videos up to ${MAX_MEDIA_BYTES / 1024 / 1024} MB fit in a project. Shorten or compress it first.`);
  }
  const dataUrl = await readAsDataUrl(file);
  const clip = await openMediaClip(await dataUrlToBlob(dataUrl), kind);
  try {
    if (!(clip.width > 0 && clip.height > 0)) throw new Error("Could not read the size of that file.");
    return { dataUrl, duration: clip.duration > 0 ? clip.duration : 5, height: clip.height, kind, name: file.name.replace(/\.[^.]+$/, ""), width: clip.width };
  } finally {
    clip.dispose();
  }
}

// The drawing script of a project made from a video alone: it draws nothing itself; the video layer is
// placed by the app.
const EMPTY_SCRIPT = "return { render() {} };";

function mediaLayerId(): string {
  return `media-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// A new Animation project made of one video or GIF, at the file's size and length.
export function buildProjectFromMedia(info: MediaFileInfo): ProjectFile {
  const id = mediaLayerId();
  const spec: AnimationSpec = {
    assets: { [id]: info.dataUrl },
    code: EMPTY_SCRIPT,
    controls: [],
    fonts: [],
    id: `media-design-${Date.now().toString(36)}`,
    imageAssets: [],
    layers: [{ id, name: info.name }],
    media: { [id]: { asset: id, duration: info.duration, fit: "cover", height: info.height, kind: info.kind, width: info.width } },
    name: info.name,
    size: { height: info.height, width: info.width },
    version: 1,
  };
  return {
    animation: spec,
    canvas: { mode: "finite", size: { height: info.height, width: info.width } },
    durationSeconds: Math.round(info.duration * 100) / 100,
    id: null,
    layers: [{ id, kind: "layer", name: info.name, visible: true }],
    name: info.name,
    params: {},
    values: { "animation.frame": { clip: false, fill: false, stroke: false }, "motion.type": "animation" },
  };
}

// The open project's animation with a video or GIF layer added on top. A project with no animation yet gets
// one at the canvas size that draws only the video.
export function withMediaLayer(
  spec: AnimationSpec | null,
  info: MediaFileInfo,
  canvas: Readonly<{ height: number; width: number }>,
): Readonly<{ layer: LayerSpec; spec: AnimationSpec }> {
  const id = mediaLayerId();
  const layer: LayerSpec = { id, name: info.name };
  const media: MediaLayer = { asset: id, duration: info.duration, fit: "cover", height: info.height, kind: info.kind, width: info.width };
  const base: AnimationSpec = spec ?? {
    assets: {},
    code: EMPTY_SCRIPT,
    controls: [],
    fonts: [],
    id: `media-design-${Date.now().toString(36)}`,
    imageAssets: [],
    layers: [],
    name: info.name,
    size: { height: canvas.height, width: canvas.width },
    version: 0,
  };
  return {
    layer,
    spec: {
      ...base,
      assets: { ...base.assets, [id]: info.dataUrl },
      layers: [layer, ...base.layers],
      media: { ...(base.media ?? {}), [id]: media },
      version: base.version + 1,
    },
  };
}

// A still of the clip's first frame (PNG), used as the picture a layer's script loads.
export async function makeMediaPoster(info: MediaFileInfo): Promise<string> {
  const clip = await openMediaClip(await dataUrlToBlob(info.dataUrl), info.kind);
  try {
    const frame = await clip.frameAt(0);
    if (!frame) throw new Error("Could not read the first frame of that file.");
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")?.drawImage(frame, 0, 0);
    frame.close();
    return canvas.toDataURL("image/png");
  } finally {
    clip.dispose();
  }
}

// The animation with the picture `key` played by a video or GIF (or added as one), in the same place.
export function withAnimatedPicture(spec: AnimationSpec, key: string, info: MediaFileInfo, poster: string): AnimationSpec {
  const mediaKey = `${key}.media`;
  return {
    ...spec,
    assetMedia: { ...(spec.assetMedia ?? {}), [key]: { asset: mediaKey, duration: info.duration, fit: "cover", height: info.height, kind: info.kind, width: info.width } },
    assets: { ...spec.assets, [key]: poster, [mediaKey]: info.dataUrl },
    version: spec.version + 1,
  };
}

// The animation with the picture `key` back to a still image (its clip removed).
export function withoutAnimatedPicture(spec: AnimationSpec, key: string): AnimationSpec {
  const media = spec.assetMedia?.[key];
  if (!media) return spec;
  const { [key]: _gone, ...assetMedia } = spec.assetMedia ?? {};
  const { [media.asset]: _file, ...assets } = spec.assets;
  return { ...spec, assetMedia, assets };
}

// Per-clip settings made in the Layer section, kept with the project's settings (params) under VIDEO_SETTINGS_KEY by
// the clip's key (a video layer's id, or a picture file's asset key): the part of the clip that plays, backwards or
// not, and whether its sound is heard.
export const VIDEO_SETTINGS_KEY = "__video";
// fit: the chosen part is sped up or slowed down to last exactly one loop of the project.
// segments: a plan of parts instead of one loop. Each part says which seconds of the clip (`start` to `end`, backwards when `end` is
// smaller) play across which seconds of the timeline (`from` to `to`), so a clip can play forward, slow down, then run back.
// `fade`: seconds the part takes to dissolve in over the part before it (which keeps running underneath), so the speed or direction
// changes without a cut or a flash.
// How a part comes in over the one before it, for `fade` seconds: dissolve (a cross-fade), dip (the one before goes to black, this one
// comes up from black) or fade (it comes up from nothing, over whatever is under the video). fadeOut: seconds at the end of a part
// in which it goes to nothing.
export type VideoTransition = "dip" | "dissolve" | "fade";
export const VIDEO_TRANSITIONS: readonly VideoTransition[] = ["dissolve", "dip", "fade"];
export type VideoSegment = Readonly<{ end: number; fade?: number; fadeOut?: number; from: number; sound?: boolean; start: number; style?: VideoTransition; to: number }>;
// timing: "manual" keeps a part's Start, Duration and End apart; otherwise (auto) they are linked and the part keeps its speed.
export type VideoSettings = Readonly<{ end?: number; fit?: boolean; reverse?: boolean; segments?: readonly VideoSegment[]; sound?: boolean; start?: number; timing?: "manual" }>;

export function readVideoSettings(params: Readonly<Record<string, unknown>> | undefined, key: string): VideoSettings {
  const all = params?.[VIDEO_SETTINGS_KEY];
  const own = typeof all === "object" && all !== null ? (all as Record<string, unknown>)[key] : undefined;
  return typeof own === "object" && own !== null ? (own as VideoSettings) : {};
}

// The part of the clip that plays, in its own seconds (at least a twentieth of a second long).
export function clipRange(media: Pick<MediaLayer, "duration">, settings: VideoSettings): Readonly<{ end: number; start: number }> {
  const duration = Math.max(0.05, media.duration);
  const start = Math.min(Math.max(0, settings.start ?? 0), duration - 0.05);
  const end = Math.min(duration, Math.max(start + 0.05, settings.end ?? duration));
  return { end, start };
}

// Where the part `part` is in the clip at timeline time `at` (it keeps going linearly past its own end, within the clip).
function partTime(media: Pick<MediaLayer, "duration">, part: VideoSegment, at: number): number {
  const share = part.to > part.from ? (at - part.from) / (part.to - part.from) : 0;
  return Math.min(Math.max(0, media.duration - 1e-3), Math.max(0, part.start + (part.end - part.start) * share));
}

// What a plan of parts shows at timeline time `t`: the clip time `at`, and while a part dissolves in over the one before it, that
// picture the part before it ended on (`under`, the clip time at the moment the new part starts, held still) and how far the new
// part has come in (`mix`, 0 to 1, eased). `reverse`: the part plays backwards. `alpha` (how much of the picture is there) and `black`
// (how much of it is covered with black) are 1 / 0 outside the transitions.
export type ClipBlend = Readonly<{ alpha?: number; at: number; black?: number; mix: number; reverse: boolean; under?: number }>;
const ease = (x: number): number => x * x * (3 - 2 * x);
export function planBlend(media: Pick<MediaLayer, "duration">, plan: readonly VideoSegment[], t: number, fitSeconds?: number): ClipBlend {
  // The timeline repeats, so a time past its length (or before its start) comes back into it. With Fit the parts are stretched
  // together so the whole plan plays exactly once per project loop.
  const last = Math.max(...plan.map((part) => part.to));
  const fitted = fitSeconds !== undefined && fitSeconds > 0 && last > 0;
  const at = last > 0 ? (fitted ? ((((t % fitSeconds) + fitSeconds) % fitSeconds) / fitSeconds) * last : ((t % last) + last) % last) : 0;
  const found = plan.findIndex((each) => at >= each.from && at < each.to);
  const position = found >= 0 ? found : plan.length - 1;
  const part = plan[position] as VideoSegment;
  const own = Math.min(Math.max(0, at), last);
  const fade = part.fade ?? 0;
  const reverse = part.end < part.start;
  const before = position > 0 ? plan[position - 1] : undefined;
  // Going out: the picture goes to nothing over the last `fadeOut` seconds of the part.
  const out = (part.fadeOut ?? 0) > 0 && part.to - own < (part.fadeOut as number) ? Math.min(1, Math.max(0, (part.to - own) / (part.fadeOut as number))) : 1;
  const style = part.style ?? "dissolve";
  if (fade > 0 && own - part.from < fade) {
    const x = Math.min(1, Math.max(0, (own - part.from) / fade));
    if (style === "fade") return { alpha: ease(x) * out, at: partTime(media, part, own), mix: 1, reverse };
    if (before && style === "dip") {
      // The part before is held on its last picture and goes to black, then this part comes up from black.
      return x < 0.5
        ? { alpha: out, at: partTime(media, before, part.from), black: ease(x * 2), mix: 1, reverse: before.end < before.start }
        : { alpha: out, at: partTime(media, part, own), black: ease(2 - x * 2), mix: 1, reverse };
    }
    if (before) return { alpha: out, at: partTime(media, part, own), mix: ease(x), reverse, under: partTime(media, before, part.from) };
  }
  return { alpha: out, at: partTime(media, part, own), mix: 1, reverse };
}

// How loud a part is at timeline time `t` (the same time mapping as planBlend): it comes in and goes out with its transitions.
export function planGainAt(plan: readonly VideoSegment[], t: number, fitSeconds?: number): number {
  const last = Math.max(...plan.map((part) => part.to));
  if (!(last > 0)) return 1;
  const at = fitSeconds !== undefined && fitSeconds > 0 ? ((((t % fitSeconds) + fitSeconds) % fitSeconds) / fitSeconds) * last : ((t % last) + last) % last;
  const part = plan.find((each) => at >= each.from && at < each.to) ?? (plan[plan.length - 1] as VideoSegment);
  const fade = part.fade ?? 0;
  const into = fade > 0 && at - part.from < fade && (part.style === "fade" || plan.indexOf(part) > 0) ? ease(Math.min(1, Math.max(0, (at - part.from) / fade))) : 1;
  const out = (part.fadeOut ?? 0) > 0 && part.to - at < (part.fadeOut as number) ? Math.min(1, Math.max(0, (part.to - at) / (part.fadeOut as number))) : 1;
  return into * out;
}

// The part of a plan that plays at timeline time `t` (the same time mapping as planBlend), for the part's own settings (sound).
export function planPartAt(plan: readonly VideoSegment[], t: number, fitSeconds?: number): VideoSegment | undefined {
  const last = Math.max(...plan.map((part) => part.to));
  if (!(last > 0)) return plan[0];
  const fitted = fitSeconds !== undefined && fitSeconds > 0;
  const at = fitted ? ((((t % fitSeconds) + fitSeconds) % fitSeconds) / fitSeconds) * last : ((t % last) + last) % last;
  return plan.find((part) => at >= part.from && at < part.to) ?? plan[plan.length - 1];
}

const roundTime = (value: number): number => Math.round(value * 100) / 100;
const MIN_PART_SECONDS = 0.1;

// The plan of parts a clip plays: its own parts, or (before it is split) one part that plays what the clip plays now.
export function videoParts(media: Pick<MediaLayer, "duration">, settings: VideoSettings, projectSeconds: number): readonly VideoSegment[] {
  if (settings.segments && settings.segments.length > 0) return settings.segments;
  const { end, start } = clipRange(media, settings);
  const sound = settings.sound === true;
  return [{ end: settings.reverse ? start : end, from: 0, sound, start: settings.reverse ? end : start, to: roundTime(settings.fit ? projectSeconds : end - start) }];
}

// Splits the part playing at timeline time `at` in two (each keeps the picture it had); null when `at` is too close to a part's edge.
export function splitVideoParts(parts: readonly VideoSegment[], at: number): readonly VideoSegment[] | null {
  const index = parts.findIndex((part) => at >= part.from + MIN_PART_SECONDS && at <= part.to - MIN_PART_SECONDS);
  const part = parts[index];
  if (!part) return null;
  const cut = roundTime(at);
  const middle = roundTime(part.start + ((part.end - part.start) * (cut - part.from)) / (part.to - part.from));
  const { fade: _fade, ...rest } = part;
  return [...parts.slice(0, index), { ...part, end: middle, to: cut }, { ...rest, from: cut, start: middle }, ...parts.slice(index + 1)];
}

// Moves the cut at the end of part `index` to timeline time `to` (the end of the last part when it is the last one): both parts
// keep their speed, so the picture stays continuous across the cut.
// With `keepClip` the part keeps the clip times it has (it was just given new ones) and only its time on the timeline changes.
export function resizeVideoPart(parts: readonly VideoSegment[], index: number, to: number, limit = 600, keepClip = false): readonly VideoSegment[] {
  const part = parts[index];
  if (!part) return parts;
  const next = parts[index + 1];
  const cut = roundTime(Math.min(next ? next.to - MIN_PART_SECONDS : limit, Math.max(part.from + MIN_PART_SECONDS, to)));
  return parts.map((each, at) => {
    const span = each.to - each.from;
    if (at === index && keepClip) return { ...each, to: cut };
    if (at === index) return { ...each, end: span > 0 ? each.start + ((each.end - each.start) / span) * (cut - each.from) : each.end, to: cut };
    if (at === index + 1) return { ...each, from: cut, start: span > 0 ? each.end - ((each.end - each.start) / span) * (each.to - cut) : each.start };
    return each;
  });
}

// Gives part `index` new clip times (`patch`: Start and/or End in the clip's own seconds). Auto: Start, Duration and End are one linked
// set at normal speed (End - Start = Duration): Start moves the window along the clip (End and the cut follow, Duration stays unless the clip
// ends first), End sets Duration. Manual: only the clip times change and the part plays faster or slower.
export function retimeVideoPart(parts: readonly VideoSegment[], index: number, patch: Partial<Pick<VideoSegment, "end" | "start">>, auto: boolean, limit: number, clipSeconds: number): readonly VideoSegment[] {
  const part = parts[index];
  if (!part) return parts;
  const span = part.to - part.from;
  if (!auto || !(span > 0)) return parts.map((each, at) => (at === index ? { ...each, ...patch } : each));
  const direction = part.end < part.start ? -1 : 1;
  const start = patch.start ?? part.start;
  const room = direction > 0 ? clipSeconds - start : start;
  const length = patch.start !== undefined && patch.end === undefined ? Math.min(span, room) : Math.abs((patch.end ?? part.end) - start);
  const size = Math.max(MIN_PART_SECONDS, roundTime(length));
  const replaced = parts.map((each, at) => (at === index ? { ...each, end: roundTime(start + direction * size), start } : each));
  return resizeVideoPart(replaced, index, part.from + size, limit, true);
}

// How long part `index` lasts. Auto: End follows (Start + Duration, normal speed, up to the end of the clip); manual: the clip times stay.
export function setVideoPartDuration(parts: readonly VideoSegment[], index: number, seconds: number, auto: boolean, limit: number, clipSeconds: number): readonly VideoSegment[] {
  const part = parts[index];
  if (!part) return parts;
  if (!auto) return resizeVideoPart(parts, index, part.from + seconds, limit, true);
  const direction = part.end < part.start ? -1 : 1;
  const room = direction > 0 ? clipSeconds - part.start : part.start;
  return retimeVideoPart(parts, index, { end: part.start + direction * Math.min(seconds, Math.max(MIN_PART_SECONDS, room)) }, true, limit, clipSeconds);
}

// Removes a part: the neighbour takes over its time. The last part left is removed with the plan (null: back to one clip).
export function removeVideoPart(parts: readonly VideoSegment[], index: number): readonly VideoSegment[] | null {
  const gone = parts[index];
  if (!gone || parts.length <= 1) return null;
  const rest = parts.filter((_, at) => at !== index);
  return rest.map((part, at) => (index > 0 && at === index - 1 ? { ...part, to: gone.to } : index === 0 && at === 0 ? { ...part, from: gone.from } : part));
}

// The clip's own time at timeline time `t`: the chosen part loops, played forward or backwards. With fit (and the
// project's length), the part is stretched to the project's loop, so it plays exactly once per loop.
export function clipTime(media: Pick<MediaLayer, "duration">, settings: VideoSettings, t: number, projectSeconds?: number): number {
  const plan = settings.segments;
  if (plan && plan.length > 0) return planBlend(media, plan, t, settings.fit === true ? projectSeconds : undefined).at;
  const { end, start } = clipRange(media, settings);
  const span = end - start;
  const fitted = settings.fit === true && projectSeconds !== undefined && projectSeconds > 0;
  const local = fitted ? ((((t % projectSeconds) + projectSeconds) % projectSeconds) / projectSeconds) * span : ((t % span) + span) % span;
  return settings.reverse ? Math.max(start, end - local - 1e-3) : start + local;
}

// The animation as it is saved: a video or GIF layer deleted from the Layers panel leaves no data behind (its clip,
// its settings entry and its layer).
export function pruneDeletedMedia(spec: AnimationSpec, panelLayers: readonly Readonly<{ id: string }>[]): AnimationSpec {
  const media = spec.media;
  if (!media) return spec;
  const keep = new Set(panelLayers.map((layer) => layer.id));
  const gone = Object.keys(media).filter((id) => !keep.has(id));
  if (gone.length === 0) return spec;
  const goneAssets = new Set(gone.map((id) => media[id]?.asset).filter((key): key is string => typeof key === "string"));
  return {
    ...spec,
    assets: Object.fromEntries(Object.entries(spec.assets).filter(([key]) => !goneAssets.has(key))),
    layers: spec.layers.filter((layer) => !gone.includes(layer.id)),
    media: Object.fromEntries(Object.entries(media).filter(([id]) => keep.has(id))),
  };
}
