import type { AnimationSpec } from "../animation/animation-spec";
import { readFigmaDesign } from "../mo/figma-paste-import";
import { dataUrlToBlob } from "./media-clip";
import { clipTime, planGainAt, planPartAt, readVideoSettings, type MediaLayer, type VideoSettings } from "./media-layer";

// The sound of the videos whose Sound is on (Layer section), laid out over the timeline the way their pictures play
// (the chosen part, looping, forwards or backwards), to be mixed with the project's music and interaction sounds.

const SAMPLE_RATE = 48_000;

type ClipSound = Readonly<{ asset: string; key: string; media: MediaLayer; settings: VideoSettings }>;

// A video is heard when its Sound is on, or when one of its parts has its own Sound on.
function heard(settings: VideoSettings): boolean {
  return settings.sound === true || (settings.segments ?? []).some((part) => part.sound === true);
}

// The videos that are seen and have Sound on: video layers that are shown, and the file a picture layer shows.
export function soundingClips(spec: AnimationSpec | null, params: Readonly<Record<string, unknown>> | undefined, shown: ReadonlySet<string>): ClipSound[] {
  if (!spec) return [];
  const clips: ClipSound[] = [];
  for (const [id, media] of Object.entries(spec.media ?? {})) {
    const settings = readVideoSettings(params, id);
    if (media.kind === "video" && heard(settings) && shown.has(id)) clips.push({ asset: media.asset, key: id, media, settings });
  }
  // A pasted design's picture layer plays only the file it shows; other pictures play every clip they hold.
  const pictureOf = new Map<string, { layer: string; shown: boolean }>();
  const pictures = (params?.__picture ?? {}) as Record<string, { show?: string } | undefined>;
  for (const block of readFigmaDesign(spec)?.blocks ?? []) {
    for (const item of block.items) {
      if (!item.pic) continue;
      const files = item.pic.files ?? [item.pic.asset];
      const show = pictures[item.id]?.show;
      const current = show && files.includes(show) ? show : files[0];
      for (const file of files) pictureOf.set(file, { layer: item.id, shown: file === current });
    }
  }
  for (const [key, media] of Object.entries(spec.assetMedia ?? {})) {
    const settings = readVideoSettings(params, key);
    const owner = pictureOf.get(key);
    if (media.kind !== "video" || !heard(settings) || (owner && (!owner.shown || !shown.has(owner.layer)))) continue;
    clips.push({ asset: media.asset, key, media, settings });
  }
  return clips;
}

export function clipSoundKey(clips: readonly ClipSound[], durationSeconds: number): string {
  return clips.length === 0 ? "" : JSON.stringify([durationSeconds, clips.map((clip) => [clip.key, clip.asset, clip.media.duration, clip.settings])]);
}

// Each video's sound, decoded once; null when the file has no sound the browser can decode.
const decoded = new Map<string, Promise<AudioBuffer | null>>();
export function clipAudio(dataUrl: string): Promise<AudioBuffer | null> {
  let found = decoded.get(dataUrl);
  if (!found) {
    found = dataUrlToBlob(dataUrl)
      .then((blob) => blob.arrayBuffer())
      .then((bytes) => new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes))
      .catch(() => null);
    decoded.set(dataUrl, found);
  }
  return found;
}

// The videos' sound over one loop of the timeline (two channels), or null when none is heard.
export async function buildClipSound(spec: AnimationSpec, clips: readonly ClipSound[], durationSeconds: number): Promise<AudioBuffer | null> {
  if (clips.length === 0) return null;
  const length = Math.max(1, Math.ceil(durationSeconds * SAMPLE_RATE));
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  let heard = false;
  for (const clip of clips) {
    const dataUrl = spec.assets[clip.asset];
    const audio = dataUrl ? await clipAudio(dataUrl) : null;
    if (!audio) continue;
    heard = true;
    const rate = audio.sampleRate;
    for (let channel = 0; channel < 2; channel += 1) {
      const source = audio.getChannelData(Math.min(channel, audio.numberOfChannels - 1));
      const target = out.getChannelData(channel);
      const plan = clip.settings.segments && clip.settings.segments.length > 0 ? clip.settings.segments : null;
      for (let index = 0; index < length; index += 1) {
        // A part's own Sound switch (the clip's Sound when the part has none) decides whether that part is heard.
        if (plan && (planPartAt(plan, index / SAMPLE_RATE, clip.settings.fit === true ? durationSeconds : undefined)?.sound ?? clip.settings.sound) !== true) continue;
        const at = Math.floor(clipTime(clip.media, clip.settings, index / SAMPLE_RATE, durationSeconds) * rate);
        const gain = plan ? planGainAt(plan, index / SAMPLE_RATE, clip.settings.fit === true ? durationSeconds : undefined) : 1;
        target[index] = (target[index] ?? 0) + (source[at] ?? 0) * gain;
      }
    }
  }
  return heard ? out : null;
}

// Two soundtracks played together (either may be missing); the result is as long as the timeline loop.
export function mixSound(a: AudioBuffer | null, b: AudioBuffer | null): AudioBuffer | null {
  if (!a || !b) return a ?? b;
  const length = Math.max(a.length, b.length);
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: a.sampleRate });
  for (let channel = 0; channel < 2; channel += 1) {
    const target = out.getChannelData(channel);
    const first = a.getChannelData(Math.min(channel, a.numberOfChannels - 1));
    const second = b.getChannelData(Math.min(channel, b.numberOfChannels - 1));
    for (let index = 0; index < length; index += 1) {
      target[index] = Math.max(-1, Math.min(1, (first[index] ?? 0) + (second[index] ?? 0)));
    }
  }
  return out;
}
