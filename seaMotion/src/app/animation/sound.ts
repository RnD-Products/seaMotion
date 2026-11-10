// Sound for a project: interaction sounds made from the Reactor items (a click for each Tap, a grab and a release
// for each Drag) and a minimal background music bed fitted to the timeline, so the loop is seamless. Everything is
// synthesised with Web Audio (no sound files), once per change, into one buffer the preview plays in step with the
// timeline and the video render mixes into its file.
import { fastestSpeed, pathAt, type DragPath, type DragPaths } from "./drag-motion";
import { readInteractions, type InteractionItem } from "./interactions";

export const SOUND_SFX_TARGET = "sound.sfx";
export const SOUND_SFX_VOLUME_TARGET = "sound.sfxVolume";
export const SOUND_SFX_STYLE_TARGET = "sound.sfxStyle";
export const SOUND_SFX_PITCH_TARGET = "sound.sfxPitch";
export const SOUND_DRAG_TARGET = "sound.drag";
export const SOUND_DRAG_STYLE_TARGET = "sound.dragStyle";
export const SOUND_DRAG_VOLUME_TARGET = "sound.dragVolume";
export const SOUND_DRAG_FADE_TARGET = "sound.dragFade";

// Each interaction sound on its own: its volume (0 = off) and its pitch on top of the shared ones.
export const SOUND_PARTS = ["press", "lift", "grab", "release", "hold"] as const;
export type SoundPart = (typeof SOUND_PARTS)[number];
export const SOUND_PART_LABELS: Readonly<Record<SoundPart, string>> = {
  grab: "Grab",
  hold: "Drag hold",
  lift: "Tap lift",
  press: "Tap click",
  release: "Release",
};
export const soundPartVolumeTarget = (part: SoundPart): string => `sound.${part}Volume`;
export const soundPartPitchTarget = (part: SoundPart): string => `sound.${part}Pitch`;
export type SoundPartSettings = Readonly<{ pitch: number; volume: number }>;
export const SOUND_MUSIC_TARGET = "sound.music";
export const SOUND_MUSIC_VOLUME_TARGET = "sound.musicVolume";
export const SOUND_MUSIC_MOOD_TARGET = "sound.musicMood";
export const SOUND_MUSIC_FADE_IN_TARGET = "sound.musicFadeIn";
export const SOUND_MUSIC_FADE_OUT_TARGET = "sound.musicFadeOut";
export const SOUND_PREVIEW_TARGET = "sound.preview";

export type MusicMood = "calm" | "bright";
// Soft: gentle clicks and a soft grab. Crisp: short bright UI ticks. Bubble: rounded, playful pops.
export type SfxStyle = "soft" | "crisp" | "bubble";
const SFX_STYLES: readonly SfxStyle[] = ["soft", "crisp", "bubble"];
// While a Drag is held: Swish, a soft airy friction; Ticks, tiny detent clicks like a slider notching; Reel, a
// fishing reel's ratchet spinning up and winding down.
export type DragStyle = "swish" | "ticks" | "reel";
const DRAG_STYLES: readonly DragStyle[] = ["swish", "ticks", "reel"];

export type SoundSettings = Readonly<{
  drag: boolean;
  // Seconds the drag sound takes to fade in after the grab and out before the release.
  dragFade: number;
  dragStyle: DragStyle;
  dragVolume: number;
  music: boolean;
  // Seconds the music takes to fade in at its start and out before its end (0 = no fade).
  musicFadeIn: number;
  musicFadeOut: number;
  musicMood: MusicMood;
  musicVolume: number;
  parts: Readonly<Record<SoundPart, SoundPartSettings>>;
  preview: boolean;
  sfx: boolean;
  // Semitones up (+) or down (-) for every interaction sound.
  sfxPitch: number;
  sfxStyle: SfxStyle;
  sfxVolume: number;
}>;

const percent = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : fallback;

const seconds = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0);

export function readSoundSettings(values: Readonly<Record<string, unknown>>): SoundSettings {
  return {
    drag: values[SOUND_DRAG_TARGET] === true,
    dragFade: typeof values[SOUND_DRAG_FADE_TARGET] === "number" && Number.isFinite(values[SOUND_DRAG_FADE_TARGET]) ? Math.min(2, Math.max(0, values[SOUND_DRAG_FADE_TARGET] as number)) : 0.25,
    dragStyle: DRAG_STYLES.includes(values[SOUND_DRAG_STYLE_TARGET] as DragStyle) ? (values[SOUND_DRAG_STYLE_TARGET] as DragStyle) : "swish",
    dragVolume: percent(values[SOUND_DRAG_VOLUME_TARGET], 0.5),
    music: values[SOUND_MUSIC_TARGET] === true,
    musicFadeIn: seconds(values[SOUND_MUSIC_FADE_IN_TARGET]),
    musicFadeOut: seconds(values[SOUND_MUSIC_FADE_OUT_TARGET]),
    musicMood: values[SOUND_MUSIC_MOOD_TARGET] === "bright" ? "bright" : "calm",
    musicVolume: percent(values[SOUND_MUSIC_VOLUME_TARGET], 0.35),
    parts: Object.fromEntries(
      SOUND_PARTS.map((part) => {
        const pitch = values[soundPartPitchTarget(part)];
        return [part, { pitch: typeof pitch === "number" && Number.isFinite(pitch) ? Math.min(12, Math.max(-12, pitch)) : 0, volume: percent(values[soundPartVolumeTarget(part)], 1) }];
      }),
    ) as Record<SoundPart, SoundPartSettings>,
    preview: values[SOUND_PREVIEW_TARGET] !== false,
    sfx: values[SOUND_SFX_TARGET] === true,
    sfxPitch: typeof values[SOUND_SFX_PITCH_TARGET] === "number" && Number.isFinite(values[SOUND_SFX_PITCH_TARGET]) ? Math.min(12, Math.max(-12, values[SOUND_SFX_PITCH_TARGET] as number)) : 0,
    sfxStyle: SFX_STYLES.includes(values[SOUND_SFX_STYLE_TARGET] as SfxStyle) ? (values[SOUND_SFX_STYLE_TARGET] as SfxStyle) : "soft",
    sfxVolume: percent(values[SOUND_SFX_VOLUME_TARGET], 0.6),
  };
}

export type SoundtrackRequest = Readonly<{
  durationSeconds: number;
  items: readonly InteractionItem[];
  // How the cursor really moves during each Drag (by item id), when it has been sampled.
  paths?: DragPaths;
  settings: SoundSettings;
}>;

// The soundtrack a project asks for, or null when it has no sound.
export function soundtrackRequest(values: Readonly<Record<string, unknown>>, durationSeconds: number, paths?: DragPaths): SoundtrackRequest | null {
  const settings = readSoundSettings(values);
  const items = settings.sfx ? readInteractions(values) : [];
  if (!(durationSeconds > 0) || (!settings.music && items.length === 0)) return null;
  return { durationSeconds, items, paths, settings };
}

// Whether the drag sound uses the cursor's movement (and so needs it sampled).
export function needsDragPaths(values: Readonly<Record<string, unknown>>): boolean {
  const settings = readSoundSettings(values);
  return settings.sfx && settings.drag && settings.parts.hold.volume > 0;
}

// A short fingerprint of the sampled movement, for the soundtrack key.
function pathsPrint(paths: DragPaths | undefined): string {
  if (!paths) return "";
  let hash = 2166136261;
  for (const [id, path] of Object.entries(paths)) {
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    path.speed.forEach((value, index) => {
      hash = Math.imul(hash ^ Math.round(value), 16777619);
      hash = Math.imul(hash ^ ((path.dir[index] ?? 0) + 2), 16777619);
    });
  }
  return (hash >>> 0).toString(36);
}

// What the soundtrack depends on, to reuse a built one until something that changes it changes.
export function soundtrackKey(request: SoundtrackRequest | null): string {
  if (!request) return "";
  const { settings } = request;
  return JSON.stringify([
    Math.round(request.durationSeconds * 1000),
    settings.music ? [settings.musicMood, settings.musicVolume, settings.musicFadeIn, settings.musicFadeOut] : null,
    settings.sfx ? [settings.sfxStyle, settings.sfxVolume, settings.sfxPitch, SOUND_PARTS.map((part) => [settings.parts[part].volume, settings.parts[part].pitch])] : null,
    settings.sfx && settings.drag ? [settings.dragStyle, settings.dragVolume, settings.dragFade, pathsPrint(request.paths)] : null,
    request.items.map((item) => [item.type, item.start, item.duration, item.device, item.hold, item.x === item.toX && item.y === item.toY]),
  ]);
}

const SAMPLE_RATE = 48_000;

// The music bed is built quiet (a soft pad); this brings its 100 % up to a level that is heard clearly next to the clicks.
const MUSIC_MAKEUP = 3.2;

type Ctx = BaseAudioContext;

// One short sound: a tone gliding from one pitch to another, and an optional click (noise) at `clickHz`.
type Blip = Readonly<{ click: number; clickHz?: number; decay: number; from: number; gain: number; to: number; type: OscillatorType }>;

// A short burst of noise (made once per context) for click transients.
function noiseBuffer(ctx: Ctx): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 7;
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 16807) % 2147483647;
    data[index] = (seed / 2147483647) * 2 - 1;
  }
  return buffer;
}

// A pitched blip with a fast attack and an exponential decay, plus an optional filtered noise transient.
function blip(
  ctx: Ctx,
  out: AudioNode,
  noise: AudioBuffer,
  at: number,
  o: Blip,
): void {
  if (at < 0) return;
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, at);
  osc.frequency.exponentialRampToValueAtTime(o.to, at + o.decay * 0.6);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(o.gain, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + o.decay);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + o.decay + 0.02);
  if (o.click > 0) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = Math.min(12000, o.clickHz ?? 3800);
    band.Q.value = 1.2;
    const clickEnv = ctx.createGain();
    clickEnv.gain.setValueAtTime(o.click, at);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.018);
    src.connect(band).connect(clickEnv).connect(out);
    src.start(at, 0, 0.03);
  }
}


// The sounds of each style: a Tap's press and lift, a Drag's grab and release.
const SFX_SOUNDS: Readonly<Record<SfxStyle, Readonly<{ grab: Blip; lift: Blip; press: Blip; release: Blip }>>> = {
  soft: {
    press: { click: 0.35, decay: 0.07, from: 1500, gain: 0.5, to: 900, type: "sine" },
    lift: { click: 0.12, decay: 0.05, from: 1900, gain: 0.18, to: 1500, type: "sine" },
    grab: { click: 0.2, decay: 0.09, from: 420, gain: 0.45, to: 260, type: "triangle" },
    release: { click: 0.08, decay: 0.07, from: 640, gain: 0.22, to: 520, type: "triangle" },
  },
  // Short, bright and precise, like a trackpad click or a small switch.
  crisp: {
    press: { click: 0.6, decay: 0.03, from: 3200, gain: 0.32, to: 2400, type: "square" },
    lift: { click: 0.25, decay: 0.02, from: 4200, gain: 0.12, to: 3600, type: "square" },
    grab: { click: 0.45, decay: 0.035, from: 1300, gain: 0.3, to: 900, type: "square" },
    release: { click: 0.3, decay: 0.03, from: 1800, gain: 0.18, to: 1500, type: "square" },
  },
  // Rounded pops with rising and falling pitch, like drops of water.
  bubble: {
    press: { click: 0, decay: 0.12, from: 380, gain: 0.55, to: 980, type: "sine" },
    lift: { click: 0, decay: 0.08, from: 700, gain: 0.2, to: 1300, type: "sine" },
    grab: { click: 0, decay: 0.14, from: 240, gain: 0.5, to: 520, type: "sine" },
    release: { click: 0, decay: 0.12, from: 560, gain: 0.3, to: 260, type: "sine" },
  },
};

// A Cursor item that stays where it is (its end is its start) is a rest: the cursor hovers there.
const hoverRests = (item: InteractionItem): boolean => item.x === item.toX && item.y === item.toY;
const quiet = (sound: Blip | null): Blip | null => (sound ? { ...sound, click: sound.click * 0.35, gain: sound.gain * 0.35 } : null);

// Interaction sounds, timed with the Reactor icons: a Tap sounds as the arrow presses (and softly as it lifts);
// a Drag sounds as the hand takes hold and, lighter, when it lets go.
function scheduleSfx(
  ctx: Ctx,
  out: AudioNode,
  items: readonly InteractionItem[],
  offset: number,
  style: SfxStyle,
  pitch: number,
  parts: Readonly<Record<SoundPart, SoundPartSettings>>,
): void {
  const noise = noiseBuffer(ctx);
  // Pitch moves every tone (and the click's colour) by the same number of semitones; each sound's own pitch and
  // volume come on top. A sound at volume 0 is left out.
  const base = SFX_SOUNDS[style];
  const tuned = (part: "grab" | "lift" | "press" | "release"): Blip | null => {
    const own = parts[part];
    if (own.volume <= 0) return null;
    const ratio = 2 ** ((pitch + own.pitch) / 12);
    const sound = base[part];
    return { ...sound, click: sound.click * own.volume, clickHz: 3800 * ratio, from: sound.from * ratio, gain: sound.gain * own.volume, to: sound.to * ratio };
  };
  const sounds = { grab: tuned("grab"), lift: tuned("lift"), press: tuned("press"), release: tuned("release") };
  // Square waves are bright; a gentle low-pass keeps the Crisp style from getting harsh.
  let bus: AudioNode = out;
  if (style === "crisp") {
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 6000;
    tone.connect(out);
    bus = tone;
  }
  const play = (at: number, sound: Blip | null): void => {
    if (sound) blip(ctx, bus, noise, at, sound);
  };
  for (const item of items) {
    const start = item.start + offset;
    if (item.type === "tap") {
      play(start + item.duration * 0.25, sounds.press);
      play(start + item.duration * 0.55, sounds.lift);
    } else if (item.type === "drag") {
      play(start, sounds.grab);
      play(start + item.duration, sounds.release);
    } else if (item.type === "cursor" && (hoverRests(item) || item.hold > 0)) {
      // A hover: the cursor comes to rest on something. A minimal tick (the Tap lift, a third as loud), as it stops.
      play(start + (hoverRests(item) ? 0 : item.duration), quiet(sounds.lift));
    }
  }
}

// A soft fade at both ends of a held sound: 0 to 1 over `fade` seconds, and back over the last `fade` seconds.
const fadeAt = (t: number, length: number, fade: number): number =>
  fade > 0 ? Math.max(0, Math.min(1, t / fade, (length - t) / fade)) : t >= 0 && t <= length ? 1 : 0;

// Looping noise shaped by a gain curve over [start, start + length].
function heldNoise(ctx: Ctx, out: AudioNode, noise: AudioBuffer, start: number, length: number, shape: (t: number) => number, filters: readonly BiquadFilterNode[]): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const env = ctx.createGain();
  const points = Math.max(16, Math.round(length * 60));
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) curve[index] = shape((index / (points - 1)) * length);
  env.gain.setValueAtTime(0, start);
  env.gain.setValueCurveAtTime(curve, start, length);
  let node: AudioNode = src;
  for (const filter of filters) node = node.connect(filter);
  node.connect(env).connect(out);
  src.start(start);
  src.stop(start + length + 0.05);
}

const filter = (ctx: Ctx, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode => {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
};

// One pawl click of a reel: a bright metallic ping, a burst of filtered noise, and a small body knock.
function reelClick(ctx: Ctx, out: AudioNode, noise: AudioBuffer, at: number, gain: number, ratio: number): void {
  const ping = ctx.createOscillator();
  ping.type = "triangle";
  ping.frequency.value = 4300 * ratio;
  const pingEnv = ctx.createGain();
  pingEnv.gain.setValueAtTime(0.0001, at);
  pingEnv.gain.exponentialRampToValueAtTime(0.5 * gain, at + 0.001);
  pingEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.011);
  ping.connect(pingEnv).connect(out);
  ping.start(at);
  ping.stop(at + 0.02);
  const burst = ctx.createBufferSource();
  burst.buffer = noise;
  const burstEnv = ctx.createGain();
  burstEnv.gain.setValueAtTime(0.9 * gain, at);
  burstEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.006);
  burst.connect(filter(ctx, "bandpass", 3200 * ratio, 2.5)).connect(burstEnv).connect(out);
  burst.start(at, (at * 7.31) % 0.15, 0.012);
  const knock = ctx.createOscillator();
  knock.type = "sine";
  knock.frequency.value = 900 * ratio;
  const knockEnv = ctx.createGain();
  knockEnv.gain.setValueAtTime(0.0001, at);
  knockEnv.gain.exponentialRampToValueAtTime(0.35 * gain, at + 0.001);
  knockEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.009);
  knock.connect(knockEnv).connect(out);
  knock.start(at);
  knock.stop(at + 0.015);
}

// The sound of holding a Drag, for its whole length, faded in after the grab and out before the release. When the
// cursor's movement has been sampled, the sound follows it: louder and faster while it moves fast, quiet at the
// turnarounds, a little lower while it moves back. Without it, a fixed spin up and wind down is used.
// Swish: looping noise through a band-pass. Ticks: detent clicks. Reel: a fishing reel's ratchet (pawl clicks over
// a faint spinning whir).
function scheduleDrag(
  ctx: Ctx,
  out: AudioNode,
  items: readonly InteractionItem[],
  offset: number,
  style: DragStyle,
  pitch: number,
  fade: number,
  paths: DragPaths | undefined,
): void {
  const ratio = 2 ** (pitch / 12);
  const noise = noiseBuffer(ctx);
  const fastest = paths ? fastestSpeed(paths) : 0;
  for (const item of items) {
    if (item.type !== "drag") continue;
    const start = item.start + offset;
    const length = item.duration;
    if (!(length > 0.1) || start < 0) continue;
    const edge = Math.min(fade, length / 2);
    const path: DragPath | undefined = paths?.[item.id];
    // Movement at a time in the drag: 0 still .. 1 fastest, and the direction.
    const motion = (t: number): { dir: number; speed: number } => {
      if (path && fastest > 0) return pathAt(path, item.start + t, fastest);
      const u = t / length;
      return { dir: 1, speed: Math.min(1, u / 0.3, (1 - u) / 0.35) ** 0.7 };
    };
    // Clicks at a rate that follows the movement (the phase advances with the rate, a click on each whole turn).
    const clicks = (topRate: number, minRate: number, each: (at: number, level: number, dir: number, speed: number) => void): void => {
      let phase = 0.5;
      const dt = 0.002;
      for (let t = 0; t < length - 0.01; t += dt) {
        const { dir, speed } = motion(t);
        const rate = topRate * speed ** 0.8;
        if (rate < minRate) continue;
        phase += rate * dt;
        if (phase >= 1) {
          phase -= 1;
          const level = fadeAt(t, length, edge);
          if (level > 0.02) each(t, level, dir, speed);
        }
      }
    };
    if (style === "swish") {
      heldNoise(ctx, out, noise, start, length, (t) => 0.34 * fadeAt(t, length, edge) * (0.12 + 0.88 * motion(t).speed ** 0.7), [
        filter(ctx, "bandpass", 1100 * ratio, 0.8),
        filter(ctx, "highpass", 280 * ratio),
      ]);
    } else if (style === "ticks") {
      let seed = Math.round(item.start * 1000) + 11;
      clicks(16, 1.5, (t, level, dir) => {
        seed = (seed * 16807) % 2147483647;
        const jitter = seed / 2147483647;
        const tone = ratio * (dir < 0 ? 0.89 : 1);
        blip(ctx, out, noise, start + t, {
          click: 0.04 * level,
          clickHz: 5200 * tone,
          decay: 0.014,
          from: 2600 * tone,
          gain: (0.09 + 0.05 * jitter) * level,
          to: 2200 * tone,
          type: "sine",
        });
      });
    } else {
      heldNoise(ctx, out, noise, start, length, (t) => 0.05 * fadeAt(t, length, edge) * (0.2 + 0.8 * motion(t).speed), [
        filter(ctx, "lowpass", 700 * ratio),
        filter(ctx, "highpass", 120 * ratio),
      ]);
      let seed = Math.round(item.start * 1000) + 29;
      clicks(36, 2, (t, level, dir, speed) => {
        seed = (seed * 16807) % 2147483647;
        const jitter = seed / 2147483647;
        // Moving back sounds two semitones lower than moving forward.
        reelClick(ctx, out, noise, start + t, 0.22 * level * (0.6 + 0.4 * speed) * (0.85 + 0.3 * jitter), ratio * (dir < 0 ? 0.89 : 1));
      });
    }
  }
}

const midi = (note: number): number => 440 * 2 ** ((note - 69) / 12);

// Chords (MIDI notes) per mood: soft extended chords that suit a calm product walkthrough.
const CHORDS: Readonly<Record<MusicMood, readonly (readonly number[])[]>> = {
  bright: [
    [60, 64, 67, 71], // Cmaj7
    [57, 60, 64, 67], // Am7
    [65, 69, 72, 76], // Fmaj7
    [67, 71, 74, 77], // G7
  ],
  calm: [
    [53, 57, 60, 64], // Fmaj7
    [57, 60, 64, 67], // Am7
    [50, 53, 57, 60, 64], // Dm9
    [48, 52, 55, 59], // Cmaj7
  ],
};

// A minimal music bed: a warm pad that moves through four chords, a quiet sub note on each chord, and a sparse
// pluck that picks chord tones. The chord length fits the timeline exactly (about four seconds each).
function scheduleMusic(ctx: Ctx, out: AudioNode, duration: number, mood: MusicMood, offset: number): void {
  const chords = CHORDS[mood];
  const count = Math.max(2, Math.round(duration / 4));
  const bar = duration / count;
  const padBus = ctx.createBiquadFilter();
  padBus.type = "lowpass";
  padBus.frequency.value = mood === "bright" ? 1400 : 950;
  padBus.Q.value = 0.4;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.16;
  padBus.connect(padGain).connect(out);
  for (let index = 0; index < count; index += 1) {
    const chord = chords[index % chords.length] ?? chords[0] ?? [];
    const at = offset + index * bar;
    const fadeIn = Math.min(1.2, bar * 0.35);
    const end = at + bar + Math.min(1.5, bar * 0.4);
    for (const note of chord) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midi(note);
        osc.detune.value = detune;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.06, at + fadeIn);
        env.gain.setValueAtTime(0.06, at + bar);
        env.gain.linearRampToValueAtTime(0, end);
        osc.connect(env).connect(padBus);
        osc.start(at);
        osc.stop(end + 0.05);
      }
    }
    // A quiet sub note under each chord.
    const root = chord[0] ?? 48;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = midi(root - 12);
    const subEnv = ctx.createGain();
    subEnv.gain.setValueAtTime(0, at);
    subEnv.gain.linearRampToValueAtTime(0.12, at + 0.3);
    subEnv.gain.setValueAtTime(0.12, at + bar - 0.2);
    subEnv.gain.linearRampToValueAtTime(0, at + bar + 0.3);
    sub.connect(subEnv).connect(out);
    sub.start(at);
    sub.stop(at + bar + 0.35);
    // A sparse pluck: a few chord tones an octave up on an even grid (eight steps a chord, half of them played).
    const steps = 8;
    const pattern = mood === "bright" ? [0, 2, 3, 5, 6] : [0, 3, 5];
    for (const step of pattern) {
      const note = chord[(step + index) % chord.length] ?? root;
      const pAt = at + (step * bar) / steps;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midi(note + 12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, pAt);
      env.gain.exponentialRampToValueAtTime(0.07, pAt + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, pAt + 0.9);
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2400;
      osc.connect(tone).connect(env).connect(out);
      osc.start(pAt);
      osc.stop(pAt + 0.95);
    }
  }
}

// Builds the whole soundtrack for one loop of the timeline. The music is played twice and the second pass is kept,
// so the start already carries the tail of the end and the loop has no seam.
export async function buildSoundtrack(request: SoundtrackRequest): Promise<AudioBuffer> {
  const duration = request.durationSeconds;
  const music = request.settings.music;
  const length = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, music ? length * 2 : length, SAMPLE_RATE);
  const offset = music ? duration : 0;
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 3;
  master.connect(ctx.destination);
  if (music) {
    const musicGain = ctx.createGain();
    // The loop keeps the second pass, so the fades are set on that pass (the first one only prepares the tail).
    const { musicFadeIn, musicFadeOut } = request.settings;
    const musicVolume = request.settings.musicVolume * MUSIC_MAKEUP;
    const fadeIn = Math.min(musicFadeIn, duration / 2);
    const fadeOut = Math.min(musicFadeOut, duration / 2);
    musicGain.gain.setValueAtTime(musicVolume, 0);
    if (fadeIn > 0 || fadeOut > 0) {
      musicGain.gain.setValueAtTime(fadeIn > 0 ? 0 : musicVolume, offset);
      if (fadeIn > 0) musicGain.gain.linearRampToValueAtTime(musicVolume, offset + fadeIn);
      if (fadeOut > 0) musicGain.gain.setValueAtTime(musicVolume, offset + duration - fadeOut);
      musicGain.gain.linearRampToValueAtTime(fadeOut > 0 ? 0 : musicVolume, offset + duration);
    }
    musicGain.connect(master);
    scheduleMusic(ctx, musicGain, duration, request.settings.musicMood, 0);
    scheduleMusic(ctx, musicGain, duration, request.settings.musicMood, duration);
  }
  if (request.items.length > 0) {
    const sfxGain = ctx.createGain();
    sfxGain.gain.value = request.settings.sfxVolume;
    sfxGain.connect(master);
    scheduleSfx(ctx, sfxGain, request.items, offset, request.settings.sfxStyle, request.settings.sfxPitch, request.settings.parts);
    // A sound near the end rings into the next loop.
    if (music) scheduleSfx(ctx, sfxGain, request.items.filter((item) => item.start + item.duration > duration - 0.5), 0, request.settings.sfxStyle, request.settings.sfxPitch, request.settings.parts);
    const hold = request.settings.parts.hold;
    if (request.settings.drag && hold.volume > 0) {
      const holdPitch = request.settings.sfxPitch + hold.pitch;
      const dragGain = ctx.createGain();
      dragGain.gain.value = request.settings.dragVolume * hold.volume;
      dragGain.connect(master);
      scheduleDrag(ctx, dragGain, request.items, offset, request.settings.dragStyle, holdPitch, request.settings.dragFade, request.paths);
      if (music) scheduleDrag(ctx, dragGain, request.items.filter((item) => item.start + item.duration > duration - 0.5), 0, request.settings.dragStyle, holdPitch, request.settings.dragFade, request.paths);
    }
  }
  const rendered = await ctx.startRendering();
  if (!music) return rendered;
  const loop = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  for (let channel = 0; channel < 2; channel += 1) loop.copyToChannel(rendered.getChannelData(channel).subarray(length, length * 2), channel);
  return loop;
}

// One built soundtrack at a time, reused while its key is unchanged.
let cached: { key: string; buffer: Promise<AudioBuffer> } | null = null;
export function getSoundtrack(request: SoundtrackRequest): Promise<AudioBuffer> {
  const key = soundtrackKey(request);
  if (cached?.key !== key) cached = { buffer: buildSoundtrack(request), key };
  return cached.buffer;
}
