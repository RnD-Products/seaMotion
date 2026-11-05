import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";

import { ANIMATION_PARAMS_TARGET } from "../animation/animation-spec";
import { LOCK_KEY, lockedLayers, readLocked, withLock } from "../animation/layer-lock";

// A lock at the right end of each layer's row, to the right of the eye. It shows while the row is hovered or selected; a locked layer keeps its lock shown,
// and the layers a locked group holds show it dimmed. Locked layers cannot be picked,
// moved or resized on the artboard (canvas-edit.tsx). The locks are kept in the project's settings (animation/layer-lock.ts).

const STYLE_ID = "mo-app-layer-lock";
const CLOSED = '<svg viewBox="0 0 256 256" width="12" height="12" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="52" y="112" width="152" height="108" rx="22"/><path d="M88 112V84a40 40 0 0 1 80 0v28"/></svg>';
const OPEN = '<svg viewBox="0 0 256 256" width="12" height="12" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="52" y="112" width="152" height="108" rx="22"/><path d="M88 112V84a40 40 0 0 1 76-17"/></svg>';

const CSS = `
/* The lock sits at the right end of the row, to the right of the eye (the eye moves left to make room). It shows while the row is hovered,
   or selected, and stays shown on a locked layer. */
li[data-layer-id] { position: relative; }
li[data-layer-id] [data-layer-actions] { right: 22px !important; }
li[data-layer-id] > [data-mo-lock] {
  position: absolute;
  top: 0;
  right: 4px;
  bottom: 0;
  z-index: 3;
  display: flex;
  width: 20px;
  align-items: center;
  justify-content: center;
  color: var(--foreground, #fff);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms;
}
li[data-layer-id]:hover > [data-mo-lock],
li[data-layer-id][data-selected="true"] > [data-mo-lock],
/* The selected row is the one whose surface has the accent fill, unless the user clicked away from it (the app marks that row data-deselected). */
li[data-layer-id]:not([data-deselected]):has(> [data-layer-row-surface][class*="var(--accent)_20%"]) > [data-mo-lock] { opacity: 0.5; }
li[data-layer-id] > [data-mo-lock]:hover { opacity: 0.95; }
li[data-layer-id] > [data-mo-lock] [data-lock-open] { display: flex; }
li[data-layer-id] > [data-mo-lock] [data-lock-closed] { display: none; }
li[data-layer-id][data-mo-locked="own"] > [data-mo-lock] { opacity: 0.85; }
li[data-layer-id][data-mo-locked="own"] > [data-mo-lock] [data-lock-open] { display: none; }
li[data-layer-id][data-mo-locked="own"] > [data-mo-lock] [data-lock-closed] { display: flex; }
li[data-layer-id][data-mo-locked="inherited"] > [data-mo-lock] { opacity: 0.35; }
li[data-layer-id][data-mo-locked="inherited"] > [data-mo-lock] [data-lock-open] { display: none; }
li[data-layer-id][data-mo-locked="inherited"] > [data-mo-lock] [data-lock-closed] { display: flex; }
`;

export function useLayerLock(): void {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const live = React.useRef({ dispatch, layers, values });
  live.current = { dispatch, layers, values };

  React.useEffect(() => {
    if (document.getElementById(STYLE_ID)) return undefined;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  }, []);

  const paint = React.useCallback((): void => {
    const { layers: list, values: now } = live.current;
    const params = (now[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
    const locks = readLocked(params);
    const all = lockedLayers(list, locks);
    for (const row of document.querySelectorAll<HTMLElement>("li[data-layer-id]")) {
      const id = row.dataset.layerId as string;
      // The first version put the lock beside the layer's icon: take that one away.
      row.querySelector("[data-layer-row-surface] [data-mo-lock]")?.remove();
      if (!row.querySelector(":scope > [data-mo-lock]")) {
        const lock = document.createElement("span");
        lock.dataset.moLock = "";
        lock.setAttribute("role", "button");
        lock.innerHTML = `<span data-lock-open>${OPEN}</span><span data-lock-closed>${CLOSED}</span>`;
        row.append(lock);
      }
      const state = locks[id] ? "own" : all.has(id) ? "inherited" : "";
      if ((row.dataset.moLocked ?? "") !== state) {
        if (state) row.dataset.moLocked = state;
        else delete row.dataset.moLocked;
      }
      const lock = row.querySelector<HTMLElement>(":scope > [data-mo-lock]");
      if (lock) {
        const title = locks[id] ? "Unlock the layer" : state === "inherited" ? "Locked by its group" : "Lock the layer";
        if (lock.title !== title) lock.title = title;
        lock.setAttribute("aria-label", title);
      }
    }
  }, []);

  React.useEffect(() => {
    let frame = 0;
    const schedule = (): void => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          paint();
        });
      }
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const onClick = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-mo-lock]") : null;
      if (!target) return;
      const row = target.closest<HTMLElement>("li[data-layer-id]");
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const id = row.dataset.layerId as string;
      const { dispatch: send, values: now } = live.current;
      const params = (now[ANIMATION_PARAMS_TARGET] ?? {}) as Record<string, unknown>;
      const locks = readLocked(params);
      send({ label: locks[id] ? "Unlock layer" : "Lock layer", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: { ...params, [LOCK_KEY]: withLock(locks, id, !locks[id]) } });
    };
    // In the capture phase: the row selects itself on a press, and a press on the lock must only lock.
    const swallow = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest("[data-mo-lock]")) event.stopPropagation();
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", swallow, true);
    window.addEventListener("mousedown", swallow, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", swallow, true);
      window.removeEventListener("mousedown", swallow, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [paint]);

  // The locks change with the values.
  React.useEffect(() => {
    paint();
  }, [paint, values, layers]);
}
