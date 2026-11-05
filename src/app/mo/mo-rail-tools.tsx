import { Keyboard, Moon, Sun, Target } from "@phosphor-icons/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector, useToolcraftTheme } from "@/toolcraft/runtime/react";
import { Button } from "@/toolcraft/ui";

import { fitCanvasView } from "./mo-viewport";
import styles from "./mo-rail-tools.module.css";

const APP_SELECTOR = '[data-slot="toolcraft-runtime-app"]';
const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200, 400, 800] as const;

// What the keys do in the app (⌘ is Ctrl on Windows and Linux).
const SHORTCUTS: readonly (readonly [string, string])[] = [
  ["Play / pause", "Space"],
  ["Undo", "⌘ Z"],
  ["Redo", "⇧ ⌘ Z"],
  ["Duplicate the selected layer or bars", "⌘ D"],
  ["Cut the selected video at the playhead", "⇧ ⌘ C"],
  ["Cut a video part where the pointer is", "⌘ + click"],
  ["Select all bars in the timeline", "⌘ A"],
  ["Delete the selected layer or the shown scene", "Delete"],
  ["Zoom the timeline or scenes", "⌘ + scroll"],
  ["Let go of the selection, close a popup", "Esc"],
];

type Popup = "shortcuts" | "zoom" | null;

// Zoom presets, Center canvas, theme and keyboard shortcuts, at the bottom of the rail (they used to sit in the inspector's toolbar).
export function MoRailTools(): React.JSX.Element {
  const dispatch = useToolcraftDispatch();
  const zoom = useToolcraftSelector((state) => state.canvas.zoom);
  const offset = useToolcraftSelector((state) => state.canvas.offset);
  const canvasSize = useToolcraftSelector((state) => state.canvas.size);
  const { resolvedTheme, toggleResolvedTheme } = useToolcraftTheme();
  const [popup, setPopup] = React.useState<Popup>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  // The popups open to the right of the rail, above the timeline and the canvas: they are drawn on the app, at the rail's bottom edge.
  const [spot, setSpot] = React.useState<{ bottom: number; left: number } | null>(null);
  const toggle = (next: Exclude<Popup, null>): void => {
    const box = rootRef.current?.getBoundingClientRect();
    if (box) setSpot({ bottom: window.innerHeight - box.bottom, left: box.right + 12 });
    setPopup((open) => (open === next ? null : next));
  };

  React.useEffect(() => {
    if (!popup) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-rail-popup]")) return;
      setPopup(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPopup(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [popup]);

  const current = Math.round(zoom);
  const levels = ZOOM_PRESETS.includes(current as (typeof ZOOM_PRESETS)[number]) ? [...ZOOM_PRESETS] : [...ZOOM_PRESETS, current].sort((a, b) => a - b);
  // Zoom around the middle of the view: the offset scales with the zoom.
  const setZoom = (next: number): void => {
    const ratio = zoom > 0 ? next / zoom : 1;
    dispatch({ offset: { x: offset.x * ratio, y: offset.y * ratio }, type: "canvas.setViewport", zoom: next });
    setPopup(null);
  };
  // Center canvas, then the view is fitted into the free area, as on open.
  const center = (): void => {
    dispatch({ type: "canvas.center" });
    window.setTimeout(() => fitCanvasView(dispatch, canvasSize), 80);
  };

  return (
    <div className={styles.group} ref={rootRef}>
      <Button aria-label="Center canvas" onClick={center} size="icon" title="Center canvas" type="button" variant="ghost">
        <Target aria-hidden="true" size={16} />
      </Button>
      <Button aria-expanded={popup === "zoom"} aria-label="Zoom" className={styles.zoomButton} onClick={() => toggle("zoom")} size="icon" title={`Zoom ${current}%`} type="button" variant={popup === "zoom" ? "secondary" : "ghost"}>
        {current}%
      </Button>
      <Button aria-expanded={popup === "shortcuts"} aria-label="Keyboard shortcuts" onClick={() => toggle("shortcuts")} size="icon" title="Keyboard shortcuts" type="button" variant={popup === "shortcuts" ? "secondary" : "ghost"}>
        <Keyboard aria-hidden="true" size={16} />
      </Button>
      <Button aria-label={resolvedTheme === "dark" ? "Light theme" : "Dark theme"} onClick={toggleResolvedTheme} size="icon" title={resolvedTheme === "dark" ? "Light theme" : "Dark theme"} type="button" variant="ghost">
        {resolvedTheme === "dark" ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
      </Button>
      {popup && spot ? createPortal(
        <div className={popup === "shortcuts" ? `${styles.popup} ${styles.shortcuts}` : styles.popup} data-rail-popup="" role={popup === "zoom" ? "menu" : "dialog"} style={{ bottom: spot.bottom, left: spot.left }}>
          {popup === "zoom"
            ? levels.map((level) => (
                <Button aria-checked={level === current} className={styles.preset} key={level} onClick={() => setZoom(level)} role="menuitemradio" size="default" type="button" variant={level === current ? "secondary" : "ghost"}>
                  <span>{level}%</span>
                </Button>
              ))
            : (
              <>
                <span className={styles.title}>Keyboard shortcuts</span>
                {SHORTCUTS.map(([action, keys]) => (
                  <div className={styles.shortcut} key={action}>
                    <span>{action}</span>
                    <span className={styles.keys}>{keys}</span>
                  </div>
                ))}
              </>
            )}
        </div>,
        document.querySelector<HTMLElement>(APP_SELECTOR) ?? document.body,
      ) : null}
    </div>
  );
}
