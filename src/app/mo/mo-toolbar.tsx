import * as React from "react";
import { createPortal } from "react-dom";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";
import { Select } from "@/toolcraft/ui";

import { fitCanvasView } from "./mo-viewport";
import styles from "./mo-toolbar.module.css";

const TOOLBAR = '[data-panel-id="toolbar"]';
const INSPECTOR = '[data-panel-type="controls"]';
const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200, 400, 800] as const;
const EDGE_GAP = 10;
const INSPECTOR_GAP = 10;

// The toolbar is the framework's. Its zoom out/in buttons are hidden and the percentage becomes a
// preset menu, and the toolbar sits at the bottom, just left of the inspector.
export function MoToolbarTweaks(): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const zoom = useToolcraftSelector((state) => state.canvas.zoom);
  const offset = useToolcraftSelector((state) => state.canvas.offset);
  const toolbarOffset = useToolcraftSelector((state) => state.panels.toolbar.offset);
  const canvasSize = useToolcraftSelector((state) => state.canvas.size);
  const sizeRef = React.useRef(canvasSize);
  sizeRef.current = canvasSize;
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  // Center canvas centers the artboard in the whole view, which pushes the ratio bar off the top. After
  // the runtime has centered it, the view is fitted into the free area instead, as on open.
  React.useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('button[aria-label="Center canvas"]')) return;
      window.setTimeout(() => fitCanvasView(dispatch, sizeRef.current), 80);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dispatch]);

  // Hide the zoom buttons and give the percentage a place to render the preset menu.
  React.useEffect(() => {
    const sync = (): void => {
      const toolbar = document.querySelector<HTMLElement>(TOOLBAR);
      if (!toolbar) return;
      // The toolbar is not shown: its zoom, theme and Center canvas moved to the left rail. Undo and Redo stay on the keyboard.
      const frame = toolbar.closest<HTMLElement>('[data-slot="toolcraft-runtime-panel-host"]') ?? toolbar;
      frame.style.display = "none";
      // The inspector fills the window from its top down to the bottom edge, like the panels on the left.
      const inspectorSurface = document.querySelector<HTMLElement>(`${INSPECTOR} .toolcraft-panel-surface`);
      if (inspectorSurface && inspectorSurface.style.height !== "calc(100dvh - 10px)") {
        inspectorSurface.style.setProperty("height", "calc(100dvh - 10px)", "important");
        inspectorSurface.style.setProperty("max-height", "calc(100dvh - 10px)", "important");
      }
      // The playback bar is 36px tall; the toolbar's 4px padding makes it 38px, so it is trimmed to match.
      const surface = toolbar.firstElementChild;
      if (surface instanceof HTMLElement) surface.style.padding = "3px";
      for (const button of toolbar.querySelectorAll<HTMLElement>('button[aria-label="Zoom out"], button[aria-label="Zoom in"]')) {
        button.style.display = "none";
      }
      // Theme, Center canvas and the zoom presets moved to the bottom of the left rail; only Undo and Redo stay here.
      for (const button of toolbar.querySelectorAll<HTMLElement>('button[aria-label="Light theme"], button[aria-label="Dark theme"], button[aria-label="Center canvas"]')) {
        button.style.display = "none";
      }
      for (const divider of toolbar.querySelectorAll<HTMLElement>('[data-slot="desktop-toolbar-divider"]')) divider.style.display = "none";
      const presets = toolbar.querySelector<HTMLElement>("[data-zoom-presets]");
      if (presets) presets.style.display = "none";
      const label = [...toolbar.querySelectorAll<HTMLElement>("span")].find((span) => /^\d+%$/.test(span.textContent?.trim() ?? ""));
      if (label) label.style.display = "none";
      const anchor = label ?? toolbar.querySelector<HTMLElement>("[data-zoom-presets]")?.previousElementSibling;
      setHost((current) => {
        if (current?.isConnected) return current;
        if (!(anchor instanceof HTMLElement)) return null;
        const element = document.createElement("div");
        element.dataset.zoomPresets = "";
        element.dataset.panelDragIgnore = "";
        anchor.after(element);
        return element;
      });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Bottom of the window, left of the inspector. Placement is relative, so the move is the gap
  // between where the toolbar is and where it should be, added to its current offset.
  const offsetRef = React.useRef(toolbarOffset);
  offsetRef.current = toolbarOffset;
  React.useEffect(() => {
    let frame = 0;
    const place = (): void => {
      const toolbar = document.querySelector<HTMLElement>(TOOLBAR);
      const inspector = document.querySelector<HTMLElement>(INSPECTOR);
      if (!toolbar || !inspector) return;
      const box = toolbar.getBoundingClientRect();
      const target = {
        x: inspector.getBoundingClientRect().left - INSPECTOR_GAP - box.width,
        y: window.innerHeight - EDGE_GAP - box.height,
      };
      const dx = Math.round(target.x - box.left);
      const dy = Math.round(target.y - box.top);
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      dispatch({
        panelId: "toolbar",
        patch: { offset: { x: offsetRef.current.x + dx, y: offsetRef.current.y + dy }, snapEdge: undefined },
        type: "panels.update",
      });
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const timer = window.setTimeout(schedule, 1500);
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
  }, [dispatch, host]);

  if (!host) return null;
  const current = Math.round(zoom);
  const levels = ZOOM_PRESETS.includes(current as (typeof ZOOM_PRESETS)[number]) ? [...ZOOM_PRESETS] : [...ZOOM_PRESETS, current].sort((a, b) => a - b);
  const setZoom = (next: number): void => {
    // Zoom around the middle of the view: the offset scales with the zoom.
    const ratio = zoom > 0 ? next / zoom : 1;
    dispatch({ offset: { x: offset.x * ratio, y: offset.y * ratio }, type: "canvas.setViewport", zoom: next });
  };
  return createPortal(
    <div className={styles.zoom}>
      <Select
        name="Zoom"
        onValueChange={(next) => setZoom(Number(next))}
        options={levels.map((level) => ({ label: `${level}%`, value: String(level) }))}
        showLabel={false}
        value={String(current)}
      />
    </div>,
    host,
  );
}
