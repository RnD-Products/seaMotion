import * as React from "react";
import { createPortal } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { changeScene, clampSceneSeconds, resolveProjectScenes } from "./scenes";
import { useTimelineView } from "./timeline-view";
import styles from "./scene-length-input.module.css";

const HEADER = '[data-slot="timeline-panel-header"]';

// In the timeline's header, beside "Duration": the length of the scene on show, to type (or step with the arrow keys). Longer or shorter, the
// whole motion's Duration follows (it is the sum of the scenes).
export function SceneLengthInput(): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const defaults = useToolcraftSelector((state) => state.defaults);
  const duration = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null);
  // Only the view of one scene has a scene length to set; the Overview (all the scenes) has none.
  const view = useTimelineView();
  React.useEffect(() => {
    if (host) host.style.display = view === "scene" ? "" : "none";
  }, [host, view]);

  React.useEffect(() => {
    let own: HTMLElement | null = null;
    const find = (): void => {
      const header = document.querySelector<HTMLElement>(HEADER);
      const group = header ? [...header.children].find((child) => /^Duration:/.test((child.textContent ?? "").trim())) : undefined;
      if (!header || !group) {
        if (own) {
          own.remove();
          own = null;
          setHost(null);
        }
        return;
      }
      if (own && own.previousElementSibling === group) return;
      own?.remove();
      own = document.createElement("div");
      own.setAttribute("data-mo-scene-length", "");
      own.className = styles.slot ?? "";
      group.insertAdjacentElement("afterend", own);
      setHost(own);
    };
    find();
    const timer = window.setInterval(find, 300);
    return () => {
      window.clearInterval(timer);
      own?.remove();
    };
  }, []);

  const scenes = resolveProjectScenes(values, duration);
  const shown = scenes.items[scenes.activeIndex];
  if (!host || !shown || view !== "scene") return null;
  const current = Math.round(shown.duration * 100) / 100;
  const set = (seconds: number): void => {
    if (!Number.isFinite(seconds)) return;
    const next = clampSceneSeconds(seconds);
    if (Math.abs(next - shown.duration) < 0.005) return;
    const edit = changeScene({ defaults, timelineSeconds: duration, values }, shown.scene.id, { duration: next });
    if (!edit) return;
    dispatch({ label: "Scene length", type: "controls.apply", values: edit.values });
    if (edit.durationSeconds !== null && Math.abs(edit.durationSeconds - duration) > 0.001) dispatch({ durationSeconds: edit.durationSeconds, type: "timeline.setDuration" });
  };
  const finish = (typed: string): void => {
    if (draft !== null || typed !== String(current)) set(Number.parseFloat(typed.replace(",", ".")));
    setDraft(null);
  };
  return createPortal(
    <label className={styles.field} title={`The length of ${shown.scene.name}; the whole Duration follows`}>
      <input
        aria-label={`Length of ${shown.scene.name} in seconds`}
        className={styles.input}
        inputMode="decimal"
        onBlur={(event) => finish(event.currentTarget.value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            finish(event.currentTarget.value);
            event.currentTarget.blur();
          }
          else if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            set(current + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 0.5 : 0.1));
            setDraft(null);
          }
        }}
        value={draft ?? String(current)}
      />
      <span>s</span>
    </label>,
    host,
  );
}
