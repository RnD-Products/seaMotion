import { buildSoundtrack, soundtrackKey, type SoundtrackRequest } from "./sound";

// The rate the sounds are built at (see sound.ts); a different rate here would stretch every sound out of step with the picture.
const SAMPLE_RATE = 48_000;

// What the sound of a project with several scenes depends on: each scene's own request and length.
export function scenesSoundtrackKey(requests: readonly (SoundtrackRequest | null)[], durations: readonly number[]): string {
  return requests.map((request, index) => `${Math.round((durations[index] ?? 0) * 1000)}:${soundtrackKey(request)}`).join("~");
}

// The sound of every scene laid one after another on one buffer as long as the timeline. The interaction sounds (clicks) of each
// scene are built on their own with the scene's settings; the music is one bed built once for the whole timeline (from the first
// scene that asks for music through the last one), so it runs through the scene joins without a seam. A scene with no sound is silent for its length.
// Null when no scene has any sound.
export async function buildScenesSoundtrack(requests: readonly (SoundtrackRequest | null)[], durations: readonly number[]): Promise<AudioBuffer | null> {
  if (requests.every((request) => request === null)) return null;
  const lengths = durations.map((seconds) => Math.max(1, Math.round(seconds * SAMPLE_RATE)));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const out = new AudioBuffer({ length: total, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  const mix = (built: AudioBuffer, at: number, length: number): void => {
    for (let channel = 0; channel < 2; channel += 1) {
      const target = out.getChannelData(channel);
      const source = built.getChannelData(Math.min(channel, built.numberOfChannels - 1));
      for (let index = 0, end = Math.min(length, source.length, total - at); index < end; index += 1) target[at + index] = (target[at + index] ?? 0) + (source[index] ?? 0);
    }
  };
  // The music is one bed for the whole video, from its first frame to its last: it fades in as the video starts and out as it ends
  // (its own fade settings), and takes its mood and volume from the first scene that asks for music.
  const musicRequest = requests.find((request) => request?.settings.music);
  if (musicRequest) {
    const bed = await buildSoundtrack({ ...musicRequest, durationSeconds: total / SAMPLE_RATE, items: [], paths: undefined, settings: { ...musicRequest.settings, drag: false, sfx: false } });
    mix(bed, 0, total);
  }
  let at = 0;
  for (const [index, request] of requests.entries()) {
    const length = lengths[index] ?? 0;
    if (request && request.items.length > 0) mix(await buildSoundtrack({ ...request, settings: { ...request.settings, music: false } }), at, length);
    at += length;
  }
  return out;
}

// One built soundtrack at a time, reused while its key is unchanged (like getSoundtrack).
let cached: { buffer: Promise<AudioBuffer | null>; key: string } | null = null;
export function getScenesSoundtrack(requests: readonly (SoundtrackRequest | null)[], durations: readonly number[]): Promise<AudioBuffer | null> {
  const key = scenesSoundtrackKey(requests, durations);
  if (cached?.key !== key) cached = { buffer: buildScenesSoundtrack(requests, durations), key };
  return cached.buffer;
}
