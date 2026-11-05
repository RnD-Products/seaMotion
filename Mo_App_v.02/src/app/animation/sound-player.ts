import * as React from "react";

import { getActiveAnimation, ANIMATION_PARAMS_TARGET } from "./animation-spec";
import { dragPathsKey, sampleDragPaths, type DragPaths } from "./drag-motion";
import { readInteractions } from "./interactions";
import { getProbeSandbox, useProbeSandboxVersion } from "./layer-texts";
import { getSoundtrack, needsDragPaths, readSoundSettings, soundtrackKey, soundtrackRequest } from "./sound";
import { getScenesSoundtrack, scenesSoundtrackKey } from "./scene-sound";
import { resolveProjectScenes, sceneValuesList } from "./scenes";
import { buildClipSound, clipSoundKey, mixSound, soundingClips } from "../media/media-sound";

// Plays the project's soundtrack while the timeline plays, in step with it: it starts where the playhead is,
// loops with the timeline, starts again from the new place after a jump (a scrub, a loop segment), and stops on
// pause. Preview sound can be switched off in the Sound section; the render keeps its sound either way.
let audioContext: AudioContext | null = null;
function context(): AudioContext {
  audioContext ??= new AudioContext({ latencyHint: "interactive" });
  return audioContext;
}

const JUMP_SECONDS = 0.3;

// The cursor's movement during each Drag, sampled once per change of the motion and reused.
let sampledPaths: { key: string; paths: Promise<DragPaths> } | null = null;
function useDragPaths(values: Readonly<Record<string, unknown>>, durationSeconds: number, canvas: Readonly<{ height: number; width: number }>): DragPaths | undefined {
  const wanted = needsDragPaths(values);
  const spec = wanted ? getActiveAnimation(values) : null;
  const items = wanted ? readInteractions(values) : [];
  const params = values[ANIMATION_PARAMS_TARGET];
  const key = wanted ? dragPathsKey(spec, params, items, durationSeconds) : "";
  const sandboxVersion = useProbeSandboxVersion();
  const [paths, setPaths] = React.useState<{ key: string; paths: DragPaths } | null>(null);
  const latest = React.useRef({ canvas, items, params, spec });
  latest.current = { canvas, items, params, spec };
  React.useEffect(() => {
    const sandbox = getProbeSandbox();
    const current = latest.current;
    if (!key || !sandbox || !current.spec) return;
    let cancelled = false;
    if (sampledPaths?.key !== key) {
      sampledPaths = { key, paths: sampleDragPaths(sandbox, current.spec, { canvas: current.canvas, durationSeconds, items: current.items, params: current.params }) };
    }
    const pending = sampledPaths;
    void pending.paths
      .then((result) => {
        if (!cancelled) setPaths({ key, paths: result });
      })
      .catch(() => {
        if (sampledPaths === pending) sampledPaths = null;
      });
    return () => {
      cancelled = true;
    };
  }, [durationSeconds, key, sandboxVersion]);
  return paths && paths.key === key ? paths.paths : undefined;
}

export function useSoundtrackPlayback(
  values: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  durationSeconds: number,
  isPlaying: boolean,
  timeSeconds: number,
  canvas: Readonly<{ height: number; width: number }>,
  layerStack: readonly string[] = [],
): void {
  // Every scene has its own sound; they play one after another. With one scene this is the project's sound as it is.
  const scenes = React.useMemo(() => resolveProjectScenes(values, durationSeconds), [values, durationSeconds]);
  const eachValues = React.useMemo(() => sceneValuesList(values, defaults, scenes), [values, defaults, scenes]);
  // The cursor's drag paths are sampled for the scene on show.
  const paths = useDragPaths(values, scenes.items[scenes.activeIndex]?.duration ?? durationSeconds, canvas);
  const requests = React.useMemo(
    () => scenes.items.map((item) => soundtrackRequest(eachValues[item.index] ?? values, item.duration, item.active ? paths : undefined)),
    [scenes, eachValues, values, paths],
  );
  const request = scenes.many ? null : (requests[0] ?? null);
  const sceneDurations = React.useMemo(() => scenes.items.map((item) => item.duration), [scenes]);
  const hasSound = requests.some((item) => item !== null);
  // Videos whose Sound is on play their sound with the soundtrack.
  const spec = getActiveAnimation(values);
  const stackKey = layerStack.join("|");
  const clips = React.useMemo(
    () => soundingClips(spec, values[ANIMATION_PARAMS_TARGET] as Readonly<Record<string, unknown>> | undefined, new Set(layerStack)),
    // The stack's key stands for the stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, values, stackKey],
  );
  const clipKey = clipSoundKey(clips, durationSeconds);
  const latestClips = React.useRef({ clips, spec });
  latestClips.current = { clips, spec };
  const key = `${scenes.many ? scenesSoundtrackKey(requests, sceneDurations) : soundtrackKey(request)}#${clipKey}`;
  const preview = readSoundSettings(values).preview;
  const [buffer, setBuffer] = React.useState<AudioBuffer | null>(null);
  React.useEffect(() => {
    const { clips: current, spec: own } = latestClips.current;
    if (!hasSound && current.length === 0) {
      setBuffer(null);
      return;
    }
    let cancelled = false;
    const built = scenes.many ? getScenesSoundtrack(requests, sceneDurations) : request ? getSoundtrack(request) : Promise.resolve(null);
    void Promise.all([built, own ? buildClipSound(own, current, durationSeconds) : Promise.resolve(null)])
      .then(([built, clipSound]) => {
        if (!cancelled) setBuffer(mixSound(built, clipSound));
      })
      .catch(() => {
        if (!cancelled) setBuffer(null);
      });
    return () => {
      cancelled = true;
    };
    // The key holds everything the soundtrack depends on.
  }, [key]);

  const playing = React.useRef<{ source: AudioBufferSourceNode; startedAt: number; from: number } | null>(null);
  const stop = React.useCallback(() => {
    const current = playing.current;
    playing.current = null;
    if (!current) return;
    try {
      current.source.stop();
    } catch {
      // Already stopped.
    }
    current.source.disconnect();
  }, []);

  const timeRef = React.useRef(timeSeconds);
  timeRef.current = timeSeconds;
  const start = React.useCallback(
    (sound: AudioBuffer, at: number) => {
      stop();
      const ctx = context();
      void ctx.resume().catch(() => undefined);
      const source = ctx.createBufferSource();
      source.buffer = sound;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = sound.duration;
      source.connect(ctx.destination);
      // The speakers play a moment after the sound is started (a few ms built in, more over Bluetooth); starting
      // that much further in keeps what is heard in step with what is seen.
      const delay = ctx.baseLatency + (ctx.outputLatency || 0);
      const from = (((at + delay) % sound.duration) + sound.duration) % sound.duration;
      source.start(0, from);
      playing.current = { from, source, startedAt: ctx.currentTime };
    },
    [stop],
  );

  const last = React.useRef<{ time: number; wall: number } | null>(null);
  // Start, stop or change sound with the transport and the settings.
  React.useEffect(() => {
    last.current = { time: timeRef.current, wall: performance.now() / 1000 };
    if (!isPlaying || !buffer || !preview) {
      stop();
      return;
    }
    start(buffer, timeRef.current);
    return stop;
  }, [buffer, isPlaying, preview, start, stop]);

  // Follow the playhead: after a jump (a scrub, a loop segment) start again from there. A jump is the playhead
  // moving differently from the clock since the last update; small timing jitter (the first frames after Play) is
  // not a jump, so the sound is never restarted for it.
  React.useEffect(() => {
    const wall = performance.now() / 1000;
    const previous = last.current;
    last.current = { time: timeSeconds, wall };
    if (!playing.current || !buffer || !isPlaying || !previous) return;
    const expected = previous.time + (wall - previous.wall);
    const span = buffer.duration;
    const gap = Math.abs((((timeSeconds - expected) % span) + span * 1.5) % span - span / 2);
    if (gap > JUMP_SECONDS) start(buffer, timeSeconds);
  }, [buffer, isPlaying, start, timeSeconds]);

  React.useEffect(() => stop, [stop]);
}
