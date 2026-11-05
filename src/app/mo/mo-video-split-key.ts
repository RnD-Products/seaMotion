import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { ANIMATION_PARAMS_TARGET, getActiveAnimation } from "../animation/animation-spec";
import { readFigmaDesign } from "./figma-paste-import";
import { splitVideoParts, VIDEO_SETTINGS_KEY, videoParts, type VideoSettings } from "../media/media-layer";

// Cmd / Ctrl + Shift + C with a video layer selected in the Layers panel: the video is cut at the playhead (the same cut as the
// Split at playhead button of its Layer section and Cmd / Ctrl + click on its bar in the timeline).
export function useVideoSplitKey(activeLayerId: string | null): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const duration = useToolcraftSelector((state) => state.timeline.durationSeconds);
  // While it plays the playhead moves every frame: the shortcut waits for a pause.
  const time = useToolcraftSelector((state) => (state.timeline.isPlaying ? null : state.timeline.currentTimeSeconds));
  const live = React.useRef({ activeLayerId, dispatch, duration, time, values });
  live.current = { activeLayerId, dispatch, duration, time, values };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "c") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="textbox"]'))) return;
      const { activeLayerId: id, dispatch: send, duration: length, time: at, values: now } = live.current;
      if (!id || at === null) return;
      const spec = getActiveAnimation(now);
      // A design's picture layer plays the file it shows; a video layer of its own is its own clip.
      const pictureParams = ((now[ANIMATION_PARAMS_TARGET] as Record<string, unknown> | undefined)?.__picture ?? {}) as Record<string, { show?: string } | undefined>;
      const item = spec ? readFigmaDesign(spec)?.blocks.flatMap((block) => block.items).find((each) => each.id === id && each.pic) : undefined;
      const files = item?.pic ? (item.pic.files ?? [item.pic.asset]) : [];
      const shown = pictureParams[id]?.show;
      const fromDesign = files.includes(shown ?? "") ? shown : files[0];
      const key = [fromDesign, id, `pic-${id}`].find((candidate) => candidate !== undefined && (spec?.assetMedia?.[candidate]?.kind === "video" || spec?.media?.[candidate]?.kind === "video"));
      const media = key ? (spec?.assetMedia?.[key] ?? spec?.media?.[key]) : undefined;
      if (!key || !media) return;
      event.preventDefault();
      const params = (now[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      const clips = (params[VIDEO_SETTINGS_KEY] ?? {}) as Record<string, VideoSettings>;
      const settings = clips[key] ?? {};
      const split = splitVideoParts(videoParts(media, settings, length), at);
      if (split) send({ label: "Split video", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [VIDEO_SETTINGS_KEY]: { ...clips, [key]: { ...settings, segments: split } } } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
