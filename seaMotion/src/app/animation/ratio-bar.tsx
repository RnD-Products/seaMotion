import { CaretDown, FrameCorners } from "@phosphor-icons/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";
import { Button, FieldDescription, TextInput } from "@/toolcraft/ui";

import { ARTBOARD_SELECT_COLOR, setArtboardSelected, useArtboardSelected } from "../mo/mo-artboard-selection";
import { notePickedLayer, useActiveLayerId } from "../mo/mo-layer-selection";
import { fitCanvasView } from "../mo/mo-viewport";
import { ANIMATION_FRAME_TARGET, getActiveAnimation } from "./animation-spec";
import { FRAME_SETTINGS_ACTIVE, mergeFrame } from "./frame-transform";
import styles from "./ratio-bar.module.css";

const APP_SELECTOR = '[data-slot="toolcraft-runtime-app"]';
const SIDEBAR_SELECTOR = "[data-mo-app-sidebar]";
const ASPECT_TARGET = "canvas.aspectRatio";
const SIDEBAR_GAP = 10;
const VIEWPORT_SELECTOR = '[data-slot="toolcraft-runtime-canvas"]';
const ARTBOARD_SELECTOR = "[data-toolcraft-canvas-surface]";
const BAR_HEIGHT = 36;
const BAR_GAP = 5;
const MIN_SIZE = 16;
const MAX_SIZE = 8000;

// The ratios in the dropdown, with the size each one applies.
const PRESETS = [
  { height: 1200, ratio: "4:3", width: 1600 },
  { height: 1080, ratio: "1:1", width: 1080 },
  { height: 1080, ratio: "16:9", width: 1920 },
  { height: 1920, ratio: "9:16", width: 1080 },
  { height: 1500, ratio: "2:3", width: 1000 },
] as const;

const clampSize = (value: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));

// A ratio dropdown at the canvas's top-left, beside the project sidebar. The button shows the icon and the
// current ratio (Original when the artboard matches none of them); Custom opens a small popup with the size in pixels.
export function RatioBar(): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const aspect = useToolcraftSelector((state) => state.values[ASPECT_TARGET]);
  const size = useToolcraftSelector((state) => state.canvas.size);
  const mode = useToolcraftSelector((state) => state.canvas.mode);
  const offset = useToolcraftSelector((state) => state.canvas.offset);
  const zoom = useToolcraftSelector((state) => state.canvas.zoom);
  const values = useToolcraftSelector((state) => state.values);
  const spec = getActiveAnimation(values);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [sidebarRight, setSidebarRight] = React.useState(SIDEBAR_GAP);
  const [spot, setSpot] = React.useState({ left: SIDEBAR_GAP, top: 10, visible: true });
  const [inspectorLeft, setInspectorLeft] = React.useState(Number.POSITIVE_INFINITY);
  const [barWidth, setBarWidth] = React.useState(0);
  // Where the project bar (top middle) is; the label keeps clear of it.
  const [projectBar, setProjectBar] = React.useState<{ bottom: number; left: number; right: number; top: number } | null>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  // The artboard is selected when it was clicked or its main layer (the first top-level group) is the selected layer.
  const layers = useToolcraftSelector((state) => state.layers);
  const selectedLayerId = useToolcraftSelector((state) => state.selectedLayerId);
  const activeLayerId = useActiveLayerId(selectedLayerId);
  const artboardClicked = useArtboardSelected();
  const mainLayerId = layers.find((layer) => layer.kind === "group" && !layer.parentGroupId)?.id ?? null;
  const artboardSelected = artboardClicked || (activeLayerId !== null && activeLayerId === mainLayerId);
  const [draft, setDraft] = React.useState({ height: String(size.height), width: String(size.width) });
  const customRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setHost(document.querySelector<HTMLElement>(APP_SELECTOR));
  }, []);

  // Sits just right of the project sidebar, wherever it currently is.
  React.useEffect(() => {
    const measure = (): void => {
      const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR)?.getBoundingClientRect();
      setSidebarRight(sidebar && sidebar.width > 0 ? sidebar.right + SIDEBAR_GAP : SIDEBAR_GAP);
      // The inspector on the right: the bar never runs under it.
      const motionTab = [...document.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')].find((tab) => tab.textContent?.trim() === "Motion");
      const tabsControl = motionTab?.closest<HTMLElement>('[data-slot="tabs-control"]');
      // The panel is the first ancestor wider than the tab row (some wrappers have no box of their own).
      let panel = tabsControl?.parentElement ?? null;
      while (panel && panel.getBoundingClientRect().width <= (tabsControl?.getBoundingClientRect().width ?? 0)) panel = panel.parentElement;
      const inspector = panel?.getBoundingClientRect();
      setInspectorLeft(inspector && inspector.width > 0 ? inspector.left - SIDEBAR_GAP : Number.POSITIVE_INFINITY);
      setBarWidth(barRef.current?.getBoundingClientRect().width ?? 0);
      const box = document.querySelector<HTMLElement>("[data-mo-project-bar]")?.getBoundingClientRect();
      const next = box && box.width > 0 ? { bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top) } : null;
      setProjectBar((current) => (current && next && current.bottom === next.bottom && current.left === next.left && current.right === next.right && current.top === next.top ? current : next));
    };
    measure();
    const timer = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // The bar sits on top of the artboard, aligned with its left edge, and follows pan and zoom. It
  // never goes under the project sidebar or off the top of the view.
  React.useLayoutEffect(() => {
    const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR)?.getBoundingClientRect();
    if (!viewport) return;
    const scale = zoom / 100;
    // The artboard's real box is measured, so the bar lines up with its edge whatever the viewport's own box is.
    const measured = document.querySelector<HTMLElement>(ARTBOARD_SELECTOR)?.getBoundingClientRect();
    const artboardLeft = measured && measured.width > 0 ? measured.left : viewport.left + viewport.width / 2 + offset.x - (size.width / 2) * scale;
    const artboardTop = measured && measured.width > 0 ? measured.top : viewport.top + viewport.height / 2 + offset.y - (size.height / 2) * scale;
    // The bar follows the artboard's top-left corner, scrolling away with it; it is hidden once its
    // row is no longer inside the view. It never slides under the project sidebar.
    const top = artboardTop - BAR_HEIGHT - BAR_GAP;
    // Over a narrow artboard the bar is centred on it instead of hanging off its right side, and it
    // always stays between the project sidebar and the inspector.
    const artboardWidth = size.width * scale;
    const wanted = artboardWidth < barWidth ? artboardLeft + (artboardWidth - barWidth) / 2 : artboardLeft;
    const roomRight = Math.min(inspectorLeft, window.innerWidth - SIDEBAR_GAP) - barWidth;
    let left = Math.max(sidebarRight, Math.min(wanted, roomRight));
    // Meeting the project bar: the label jumps (no easing) beside the artboard, level with its top edge, on the left or the right side,
    // whichever has room (the one with more room when both do).
    let labelTop = top;
    if (projectBar && barWidth > 0) {
      const touches = left < projectBar.right + SIDEBAR_GAP && left + barWidth > projectBar.left - SIDEBAR_GAP && top < projectBar.bottom + SIDEBAR_GAP && top + BAR_HEIGHT > projectBar.top - SIDEBAR_GAP;
      if (touches) {
        const artboardRight = artboardLeft + artboardWidth;
        const leftSide = artboardLeft - SIDEBAR_GAP - barWidth;
        const rightSide = artboardRight + SIDEBAR_GAP;
        const leftRoom = leftSide >= sidebarRight ? leftSide - sidebarRight : -1;
        const rightRoom = rightSide <= roomRight ? roomRight - rightSide : -1;
        if (leftRoom >= 0 || rightRoom >= 0) {
          left = rightRoom > leftRoom ? rightSide : leftSide;
          labelTop = artboardTop;
        }
      }
    }
    setSpot({ left, top: labelTop, visible: labelTop >= viewport.top && labelTop <= viewport.bottom - BAR_HEIGHT });
  }, [barWidth, inspectorLeft, offset.x, offset.y, projectBar, size.height, size.width, sidebarRight, zoom]);

  // Close the menu and the popup on an outside press or Escape.
  React.useEffect(() => {
    if (!open && !menuOpen) return;
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && customRef.current?.contains(event.target)) return;
      setOpen(false);
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, menuOpen]);

  if (!host) return null;
  // The ratio comes from the artboard's real size, so a pasted design that matches one of them shows it.
  const activePreset = PRESETS.find((preset) => Math.abs(preset.width / preset.height - size.width / size.height) < 0.005)?.ratio;

  // After the canvas changes shape only the view is zoomed and centered on the new artboard; the
  // frame fits the artboard by itself (`layoutFrame`), so there is nothing to store here.
  const fitToCanvas = (next: { height: number; width: number }): void => {
    window.setTimeout(() => fitCanvasView(dispatch, next), 60);
  };

  // Original: the canvas goes back to the size the design was made at, and the design sits as drawn.
  const original = spec?.size;
  const isOriginal = original !== undefined && original.width === size.width && original.height === size.height;
  const applyOriginal = (): void => {
    if (!original) return;
    dispatch({
      aspectRatio: { height: original.height, mode: "custom", value: `${original.width}:${original.height}`, width: original.width },
      label: "Original size",
      mode,
      size: { height: original.height, unit: "px", width: original.width },
      type: "canvas.applySettings",
    });
    // The frame settings are off, so nothing is stored for them.
    if (FRAME_SETTINGS_ACTIVE) {
      dispatch({
        label: "Original size",
        target: ANIMATION_FRAME_TARGET,
        type: "controls.setValue",
        value: mergeFrame(values, { boxH: 100, boxW: 100, scale: 100, sizePreset: "custom", x: 0, y: 0 }),
      });
    }
    setOpen(false);
    setMenuOpen(false);
    window.setTimeout(() => fitCanvasView(dispatch, original), 60);
  };

  const applyPreset = (preset: (typeof PRESETS)[number]): void => {
    dispatch({
      label: `Ratio ${preset.ratio}`,
      target: ASPECT_TARGET,
      type: "controls.setValue",
      value: { height: preset.height, mode: "preset", value: preset.ratio, width: preset.width },
    });
    setOpen(false);
    setMenuOpen(false);
    fitToCanvas({ height: preset.height, width: preset.width });
  };

  const applyCustom = (next: { height: string; width: string }): void => {
    const width = Number.parseInt(next.width, 10);
    const height = Number.parseInt(next.height, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const w = clampSize(width);
    const h = clampSize(height);
    setDraft({ height: String(h), width: String(w) });
    if (w === size.width && h === size.height) return;
    dispatch({
      aspectRatio: { height: h, mode: "custom", value: `${w}:${h}`, width: w },
      label: "Custom size",
      mode,
      size: { height: h, unit: "px", width: w },
      type: "canvas.applySettings",
    });
    fitToCanvas({ height: h, width: w });
  };

  return createPortal(
    <div className={styles.bar} ref={barRef} style={{ left: spot.left, top: spot.top, visibility: spot.visible ? "visible" : "hidden" }}>
      <div className={styles.custom} ref={customRef}>
        <Button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Canvas ratio"
          onClick={() => {
            setOpen(false);
            setMenuOpen((value) => !value);
            // Choosing the ratio is working on the artboard: it is selected (and its main layer with it).
            setArtboardSelected(true);
            if (mainLayerId !== null) {
              notePickedLayer();
              dispatch({ layerId: mainLayerId, type: "layers.select" });
            }
          }}
          size="default"
          style={artboardSelected ? { color: ARTBOARD_SELECT_COLOR } : undefined}
          title={`Artboard ${size.width} × ${size.height}`}
          type="button"
          variant="ghost"
        >
          <FrameCorners />
          <span>{activePreset ?? "Original"}</span>
          <span className={styles.size}>
            {size.width} × {size.height}
          </span>
          <CaretDown size={10} />
        </Button>
        {menuOpen ? (
          <div className={styles.menu} role="menu">
            {PRESETS.map((preset) => (
              <Button
                aria-checked={activePreset === preset.ratio}
                className={styles.menuItem}
                key={preset.ratio}
                onClick={() => applyPreset(preset)}
                role="menuitemradio"
                size="default"
                type="button"
                variant={activePreset === preset.ratio ? "secondary" : "ghost"}
              >
                <span>{preset.ratio}</span>
                <span className={styles.menuSize}>
                  {preset.width} × {preset.height}
                </span>
              </Button>
            ))}
            <Button
              aria-checked={activePreset === undefined}
              className={styles.menuItem}
              disabled={!original}
              onClick={applyOriginal}
              role="menuitemradio"
              size="default"
              title={original ? "Original size of the design" : "This design does not record its original size"}
              type="button"
              variant={activePreset === undefined ? "secondary" : "ghost"}
            >
              <span>Original</span>
              <span className={styles.menuSize}>{original ? `${original.width} × ${original.height}` : ""}</span>
            </Button>
            <Button
              className={styles.menuItem}
              onClick={() => {
                setDraft({ height: String(size.height), width: String(size.width) });
                setMenuOpen(false);
                setOpen(true);
              }}
              role="menuitem"
              size="default"
              type="button"
              variant="ghost"
            >
              <span>Custom…</span>
            </Button>
          </div>
        ) : null}
        {open ? (
          <div className={styles.popup}>
            <div className={styles.fields}>
              <TextInput
                commitOnBlur
                name="Width"
                onValueChange={(next) => applyCustom({ ...draft, width: next })}
                value={draft.width}
              />
              <TextInput
                commitOnBlur
                name="Height"
                onValueChange={(next) => applyCustom({ ...draft, height: next })}
                value={draft.height}
              />
            </div>
            <FieldDescription>Size in px ({MIN_SIZE}–{MAX_SIZE}).</FieldDescription>
          </div>
        ) : null}
      </div>
    </div>,
    host,
  );
}
