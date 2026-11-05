import * as React from "react";
import type { ToolcraftCommand } from "@/toolcraft/runtime";
import { Button, FieldDescription, Select, Slider, Switch } from "@/toolcraft/ui";

import { ANIMATION_PARAMS_TARGET } from "../animation/animation-spec";
import { useToolcraftSelector } from "@/toolcraft/runtime/react";

import { clipRange, readVideoSettings, removeVideoPart, retimeVideoPart, setVideoPartDuration, splitVideoParts, VIDEO_SETTINGS_KEY, videoParts, type MediaLayer, type VideoSegment, type VideoSettings } from "../media/media-layer";
import { clipAudio } from "../media/media-sound";
import { pickVideoPart, takeFreshPick, useVideoPartPick } from "../media/video-part-pick";
import styles from "./figma-layer-settings.module.css";

// The Layer section for a video or GIF: what it is (length, size) and how it plays: the part that plays (Start, End),
// backwards or not, and (a video) whether its sound is heard in the preview and the render.

type Props = Readonly<{
  clipKey: string;
  dataUrl: string | undefined;
  dispatch: (command: ToolcraftCommand) => void;
  media: MediaLayer;
  params: Readonly<Record<string, unknown>>;
  projectSeconds: number;
}>;

// How a part comes in: the presets of its Transition. Cut has none; the first part has nothing before it to dissolve or dip from.
const TRANSITION_OPTIONS = [
  { label: "Cut", value: "cut" },
  { label: "Dissolve", value: "dissolve" },
  { label: "Dip to black", value: "dip" },
  { label: "Fade in", value: "fade" },
] as const;
const FIRST_TRANSITION_OPTIONS = TRANSITION_OPTIONS.filter((option) => option.value === "cut" || option.value === "fade");

const seconds = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)} s`;

// Whether the video has sound the browser can play (checked once per file).
function useHasSound(dataUrl: string | undefined, isVideo: boolean): boolean | null {
  const [has, setHas] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!dataUrl || !isVideo) {
      setHas(false);
      return undefined;
    }
    let cancelled = false;
    setHas(null);
    void clipAudio(dataUrl).then((audio) => {
      if (!cancelled) setHas(audio !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [dataUrl, isVideo]);
  return has;
}

export function ClipSettings({ clipKey, dataUrl, dispatch, media, params, projectSeconds }: Props): React.ReactNode {
  const isVideo = media.kind === "video";
  const kind = isVideo ? "Video" : "GIF";
  const hasSound = useHasSound(dataUrl, isVideo);
  const settings = readVideoSettings(params, clipKey);
  const { end, start } = clipRange(media, settings);
  const all = (params[VIDEO_SETTINGS_KEY] ?? {}) as Readonly<Record<string, VideoSettings>>;
  const set = (patch: VideoSettings, label: string): void =>
    dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [VIDEO_SETTINGS_KEY]: { ...all, [clipKey]: { ...settings, ...patch } } } });
  const duration = Math.max(0.1, media.duration);
  const pick = useVideoPartPick();
  const auto = settings.timing !== "manual";
  // A part picked on the timeline comes into view once, when it is picked (not on every render: the panel must stay free to scroll).
  const pickedClip = pick?.clip;
  const pickedIndex = pick?.index;
  React.useEffect(() => {
    if (pickedClip === clipKey && pickedIndex !== undefined && takeFreshPick()) document.querySelector(`[data-video-part="${clipKey}:${pickedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [clipKey, pickedClip, pickedIndex]);
  const timeSeconds = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const parts = settings.segments && settings.segments.length > 0 ? settings.segments : null;
  const setParts = (next: readonly VideoSegment[] | null, label: string): void => {
    const { segments: _old, ...rest } = settings;
    dispatch({ label, target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [VIDEO_SETTINGS_KEY]: { ...all, [clipKey]: next ? { ...settings, segments: next } : rest } } });
  };
  const splitHere = (): void => {
    const split = splitVideoParts(videoParts(media, settings, projectSeconds), timeSeconds);
    if (split) setParts(split, `${kind} split`);
  };
  const canSplit = splitVideoParts(videoParts(media, settings, projectSeconds), timeSeconds) !== null;
  const setPart = (index: number, patch: Partial<VideoSegment>, label: string): void =>
    setParts((parts ?? []).map((part, at) => (at === index ? { ...part, ...patch } : part)), label);
  const matches = Math.abs(end - start - projectSeconds) < 0.05;
  return (
    <div className={styles.root}>
      <div className={styles.info}>
        <span className={styles.infoTitle}>{kind}</span>
        <span>{`Duration ${seconds(media.duration)} · ${media.width} × ${media.height}`}</span>
        <span>{`Plays ${seconds(start)} – ${seconds(end)} (${seconds(end - start)})${settings.reverse ? ", backwards" : ""}, looping`}</span>
        <span>
          {settings.fit
            ? `Fitted to the project's ${seconds(projectSeconds)} (speed ${(Math.round(((end - start) / projectSeconds) * 100) / 100).toString()}×)`
            : matches
              ? `Matches the project's ${seconds(projectSeconds)}`
              : `Project is ${seconds(projectSeconds)}: the video ${end - start > projectSeconds ? "is cut at the project's end" : "loops inside it"}`}
        </span>
      </div>
      <Button disabled={!canSplit} onClick={splitHere} size="sm" type="button" variant="outline">
        {`Split at playhead (${seconds(timeSeconds)})`}
      </Button>
      {parts ? (
        <Switch checked={auto} name="Link Start · Duration · End" onCheckedChange={(on) => set({ timing: on ? undefined : "manual" }, `${kind} timing ${on ? "auto" : "manual"}`)} />
      ) : null}
      {parts ? (
        parts.map((part, index) => {
          const reversed = part.end < part.start;
          const low = Math.round(Math.min(part.start, part.end) * 10) / 10;
          const high = Math.round(Math.max(part.start, part.end) * 10) / 10;
          const max = Math.round(duration * 10) / 10;
          return (
            <div
              className={`${styles.info} ${pick && pick.clip === clipKey && pick.index === index ? styles.picked : ""}`}
              key={`${index}-${part.from}`}
              onPointerDown={() => pickVideoPart({ clip: clipKey, index })}
              data-video-part={`${clipKey}:${index}`}
            >
              <span className={styles.infoTitle}>{`Part ${index + 1} · ${seconds(part.from)} – ${seconds(part.to)}`}</span>
              <Slider
                max={max}
                min={0}
                name="Start"
                onValueChange={(value) => setParts(retimeVideoPart(parts, index, reversed ? { end: Math.min(value, high - 0.1) } : { start: Math.min(value, high - 0.1) }, auto, Math.max(projectSeconds, part.to), media.duration), `${kind} part start`)}
                step={0.1}
                unit="s"
                value={low}
              />
              <Slider
                max={Math.round(Math.max(projectSeconds, part.to) * 10) / 10 - Math.round(part.from * 10) / 10}
                min={0.1}
                name="Duration"
                onValueChange={(value) => setParts(setVideoPartDuration(parts, index, value, auto, Math.max(projectSeconds, part.to), media.duration), `${kind} part length`)}
                step={0.1}
                unit="s"
                value={Math.round((part.to - part.from) * 10) / 10}
              />
              <Slider
                max={max}
                min={0}
                name="End"
                onValueChange={(value) => setParts(retimeVideoPart(parts, index, reversed ? { start: Math.max(value, low + 0.1) } : { end: Math.max(value, low + 0.1) }, auto, Math.max(projectSeconds, part.to), media.duration), `${kind} part end`)}
                step={0.1}
                unit="s"
                value={high}
              />
              <Select
                name="Transition in"
                onValueChange={(next) =>
                  setPart(index, next === "cut" ? { fade: 0, style: undefined } : { fade: part.fade && part.fade > 0 ? part.fade : 0.5, style: next as VideoSegment["style"] }, `${kind} transition`)
                }
                options={index === 0 ? FIRST_TRANSITION_OPTIONS : TRANSITION_OPTIONS}
                value={part.fade && part.fade > 0 ? (index === 0 && part.style !== "fade" ? "cut" : (part.style ?? "dissolve")) : "cut"}
              />
              {part.fade && part.fade > 0 && (index > 0 || part.style === "fade") ? (
                <Slider max={3} min={0.1} name="Transition length" onValueChange={(fade) => setPart(index, { fade }, `${kind} transition length`)} step={0.1} unit="s" value={Math.round(part.fade * 10) / 10} />
              ) : null}
              <Slider max={3} min={0} name="Fade out" onValueChange={(fadeOut) => setPart(index, { fadeOut: fadeOut > 0 ? fadeOut : undefined }, `${kind} fade out`)} step={0.1} unit="s" value={Math.round((part.fadeOut ?? 0) * 10) / 10} />
              <Switch checked={reversed} name="Reverse" onCheckedChange={() => setPart(index, { end: part.start, start: part.end }, `${kind} part reverse`)} />
              {isVideo ? (
                <Switch
                  checked={(part.sound ?? settings.sound) === true && hasSound !== false}
                  name="Sound"
                  onCheckedChange={(sound) => {
                    if (hasSound !== false) setPart(index, { sound }, "Video part sound");
                  }}
                />
              ) : null}
              <Button onClick={() => setParts(removeVideoPart(parts, index), `${kind} part removed`)} size="sm" type="button" variant="outline">
                {parts.length > 1 ? "Delete part" : "Back to one clip"}
              </Button>
            </div>
          );
        })
      ) : (
        <>
      <Slider
        max={Math.round(duration * 10) / 10}
        min={0}
        name="Start"
        onValueChange={(value) => set({ start: Math.min(value, end - 0.1) }, `${kind} start`)}
        step={0.1}
        unit="s"
        value={Math.round(start * 10) / 10}
      />
      <Slider
        max={Math.round(duration * 10) / 10}
        min={0}
        name="End"
        onValueChange={(value) => set({ end: Math.max(value, start + 0.1) }, `${kind} end`)}
        step={0.1}
        unit="s"
        value={Math.round(end * 10) / 10}
      />
      <Button
        disabled={matches && !settings.fit}
        onClick={() => {
          // The project takes the playing part's length; the video plays at its own speed.
          if (settings.fit) set({ fit: false }, "Video fit off");
          dispatch({ durationSeconds: Math.round((end - start) * 100) / 100, type: "timeline.setDuration" });
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {`Match project length (${seconds(end - start)})`}
      </Button>
        </>
      )}
      <Switch checked={settings.fit === true} name="Fit to project" onCheckedChange={(fit) => set({ fit }, `${kind} fit to project`)} />
      {parts ? null : (
        <>
      <Switch checked={settings.reverse === true} name="Reverse" onCheckedChange={(reverse) => set({ reverse }, `${kind} reverse`)} />
      {isVideo ? (
        <>
          <Switch
            checked={settings.sound === true && hasSound !== false}
            name="Sound"
            onCheckedChange={(sound) => {
              if (hasSound !== false) set({ sound }, "Video sound");
            }}
          />
          {hasSound === false ? <FieldDescription>This video has no sound.</FieldDescription> : null}
        </>
      ) : null}
        </>
      )}
    </div>
  );
}
