import { ArrowLineDown, ArrowLineUp, CaretLineLeft, CaretLineRight, CaretRight, ClipboardText, Copy, CopySimple, Eraser, Eye, EyeSlash, FolderOpen, FolderSimple, FrameCorners, Lock, LockOpen, PencilSimple, Sparkle, Stack, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { createPortal } from "react-dom";

import { isFigmaPaste } from "./figma-paste-import";
import type { LayerActions } from "./mo-layer-duplicate";
import { useLayerMenuActions } from "./mo-layer-menu-actions";
import styles from "./mo-paste-menu.module.css";

// Right-click a layer (its row in Layers, or the layer under the pointer on the artboard) for its menu: Copy, Duplicate, Paste, Paste to replace
// and Delete. The main layer has Copy as group, Copy as frame, Paste to replace and Delete. Paste to replace: the design the Figma plugin
// copied takes that layer's place, filling its box; if the browser does not let the app read the clipboard, pressing Cmd+V while the menu is
// open pastes it.

type MenuTab = "arrange" | "edit" | "motion";
type MenuState = Readonly<{ error: string | null; layerId: string; name: string; x: number; y: number }>;

const LAYER_ROW = "[data-layer-id]";
const ARTBOARD = "canvas[data-toolcraft-product-output]";
const MENU_WIDTH = 200;
// About as tall as the longest menu; the menu scrolls when the window is shorter.
const MENU_HEIGHT = 520;

export function MoPasteMenu({
  actions,
  activeLayerId,
  canPaste,
  isMain,
  layerName,
  onReplace,
}: Readonly<{
  actions: LayerActions;
  activeLayerId: string | null;
  canPaste: boolean;
  isMain: (id: string) => boolean;
  layerName: (id: string) => string | null;
  onReplace: (layerId: string, text: string) => Promise<void>;
}>): React.ReactNode {
  const more = useLayerMenuActions();
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [tab, setTab] = React.useState<MenuTab>("edit");
  const [picking, setPicking] = React.useState<"frame" | "group" | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  // Where the menu really is: it opens at the pointer, then is moved by its measured size so it stays whole inside the window.
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);
  // Holds the keyboard focus while waiting for Cmd+V, so the paste always reaches the menu.
  const catcherRef = React.useRef<HTMLTextAreaElement>(null);
  const latest = React.useRef({ activeLayerId, layerName });
  latest.current = { activeLayerId, layerName };

  React.useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest(LAYER_ROW);
      if (target?.closest("[data-mo-canvas-edit]")) return;
      const layerId = row?.getAttribute("data-layer-id") ?? (target?.closest(ARTBOARD) ? latest.current.activeLayerId : null);
      if (!layerId) return;
      const name = latest.current.layerName(layerId);
      if (name === null) return;
      event.preventDefault();
      setMenu({
        error: null,
        layerId,
        name,
        x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT)),
      });
    };
    // A right-click on the artboard picks the layer under the pointer (canvas-edit.tsx) and tells the menu here.
    const onLayerMenu = (event: Event): void => {
      const detail = (event as CustomEvent<{ layerId: string; x: number; y: number }>).detail;
      const name = latest.current.layerName(detail.layerId);
      if (name === null) return;
      setMenu({ error: null, layerId: detail.layerId, name, x: Math.min(detail.x, window.innerWidth - MENU_WIDTH - 8), y: Math.max(8, Math.min(detail.y, window.innerHeight - MENU_HEIGHT)) });
    };
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mo-layer-menu", onLayerMenu);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mo-layer-menu", onLayerMenu);
    };
  }, []);

  const replace = React.useCallback(
    async (text: string): Promise<void> => {
      if (!menu) return;
      if (!isFigmaPaste(text)) {
        setMenu({ ...menu, error: "The clipboard has no design. In Figma, press Copy design in the seaMotion plugin first." });
        return;
      }
      setBusy(true);
      try {
        await onReplace(menu.layerId, text);
        setMenu(null);
      } catch (error) {
        setMenu({ ...menu, error: error instanceof Error ? error.message : "Could not paste that design." });
      } finally {
        setBusy(false);
      }
    },
    [menu, onReplace],
  );

  React.useEffect(() => {
    if (!menu) return undefined;
    const close = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenu(null);
    };
    // The browser may refuse to hand the clipboard over; a paste (Cmd+V) always carries it.
    const onPaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      void replace(text);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", close);
    };
  }, [menu, replace]);

  React.useEffect(() => {
    if (!menu) return;
    if (menu.error) catcherRef.current?.focus();
    else menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);

  React.useEffect(() => {
    setPicking(null);
    setTab("edit");
  }, [menu?.layerId, menu?.x, menu?.y]);
  React.useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) {
      setPlace(null);
      return;
    }
    const box = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(menu.x, window.innerWidth - box.width - margin));
    const top = Math.max(margin, Math.min(menu.y, window.innerHeight - box.height - margin));
    setPlace((current) => (current && current.left === left && current.top === top ? current : { left, top }));
  }, [menu, busy, picking, tab]);

  if (!menu) return null;
  const pasteFromClipboard = (): void => {
    if (!navigator.clipboard?.readText) {
      setMenu({ ...menu, error: "This browser does not let the app read the clipboard. Press Cmd+V now to paste." });
      return;
    }
    navigator.clipboard.readText().then(
      (text) => replace(text),
      () => setMenu({ ...menu, error: "The browser did not let the app read the clipboard. Press Cmd+V now to paste the design." }),
    );
  };
  const main = isMain(menu.layerId);
  const run = (action: () => void): void => {
    setMenu(null);
    action();
  };
  return createPortal(
    <div className={styles.menu} ref={menuRef} role="menu" style={{ left: place?.left ?? menu.x, maxHeight: "calc(100vh - 16px)", overflowY: "auto", top: place?.top ?? menu.y, visibility: place ? "visible" : "hidden" }}>
      <div className={styles.label}>{menu.name}</div>
      <div className={styles.tabs} role="tablist">
        {(main ? ["edit", "motion"] : ["edit", "arrange", "motion"]).map((id) => (
          <button aria-selected={tab === id} className={tab === id ? styles.tabOn : styles.tab} key={id} onClick={() => { setTab(id as MenuTab); setPicking(null); }} role="tab" type="button">
            {id === "edit" ? "Edit" : id === "arrange" ? "Arrange" : "Motion"}
          </button>
        ))}
      </div>
      {tab === "edit" ? (
        <>
      {main ? (
        <>
          <button className={styles.item} onClick={() => run(() => actions.copy(menu.layerId, "group"))} role="menuitem" type="button">
            <Stack size={14} />
            Copy as group
          </button>
          <button className={styles.item} onClick={() => run(() => actions.copy(menu.layerId, "frame"))} role="menuitem" type="button">
            <FrameCorners size={14} />
            Copy as frame
          </button>
        </>
      ) : (
        <>
          <button className={styles.item} onClick={() => run(() => actions.copy(menu.layerId))} role="menuitem" type="button">
            <Copy size={14} />
            Copy
          </button>
          <button className={styles.item} onClick={() => run(() => actions.duplicate(menu.layerId))} role="menuitem" type="button">
            <CopySimple size={14} />
            Duplicate
          </button>
          <button className={styles.item} disabled={!canPaste} onClick={() => run(() => actions.paste(menu.layerId))} role="menuitem" type="button">
            <ClipboardText size={14} />
            Paste
          </button>
        </>
      )}
      <button className={styles.item} disabled={busy} onClick={pasteFromClipboard} role="menuitem" type="button">
        <ClipboardText size={14} />
        {busy ? "Pasting…" : "Paste to replace"}
      </button>
      <button className={styles.item} onClick={() => run(() => more.rename(menu.layerId))} role="menuitem" type="button">
        <PencilSimple size={14} />
        Rename
      </button>
      <button className={styles.item} onClick={() => run(() => more.toggleLock(menu.layerId))} role="menuitem" type="button">
        {more.isLocked(menu.layerId) ? <LockOpen size={14} /> : <Lock size={14} />}
        {more.isLocked(menu.layerId) ? "Unlock" : "Lock"}
      </button>
      <button className={styles.item} onClick={() => run(() => more.toggleVisible(menu.layerId))} role="menuitem" type="button">
        {more.isHidden(menu.layerId) ? <Eye size={14} /> : <EyeSlash size={14} />}
        {more.isHidden(menu.layerId) ? "Show" : "Hide"}
      </button>
          <div className={styles.divider} />
      <button className={styles.item} onClick={() => run(() => actions.remove(menu.layerId))} role="menuitem" type="button">
        <Trash size={14} />
        Delete
      </button>
        </>
      ) : null}
      {tab === "arrange" && !main ? (
        <>
      {!main && more.isGroup(menu.layerId) ? (
        <button className={styles.item} onClick={() => run(() => more.ungroup(menu.layerId))} role="menuitem" type="button">
          <FolderOpen size={14} />
          Ungroup
        </button>
      ) : null}
      {!main ? (
        <>
          <button className={styles.item} onClick={() => run(() => more.group(menu.layerId, "Group"))} role="menuitem" type="button">
            <FolderSimple size={14} />
            New group
          </button>
          <button className={styles.item} onClick={() => run(() => more.group(menu.layerId, "Frame"))} role="menuitem" type="button">
            <FrameCorners size={14} />
            New frame
          </button>
          {more.groupTargets(menu.layerId).length > 0 ? (
            <>
              <button aria-expanded={picking === "group"} className={styles.item} onClick={() => setPicking((open) => (open === "group" ? null : "group"))} role="menuitem" type="button">
                <FolderOpen size={14} />
                Add to Group
                <CaretRight className={picking === "group" ? styles.caretOpen : styles.caret} size={12} />
              </button>
              {picking === "group"
                ? more.groupTargets(menu.layerId).map((target) => (
                    <button className={`${styles.item} ${styles.subItem}`} key={target.id} onClick={() => run(() => more.moveInto(menu.layerId, target.id))} role="menuitem" type="button">
                      <span className={styles.subName}>{target.name}</span>
                    </button>
                  ))
                : null}
            </>
          ) : null}
          {more.frameOf(menu.layerId) ? (
            <button className={styles.item} onClick={() => run(() => more.moveInto(menu.layerId, (more.frameOf(menu.layerId) as { id: string }).id))} role="menuitem" type="button">
              <FrameCorners size={14} />
              Add to Frame
            </button>
          ) : null}
        </>
      ) : null}
          <div className={styles.divider} />
          <button className={styles.item} onClick={() => run(() => more.toFront(menu.layerId))} role="menuitem" type="button">
            <ArrowLineUp size={14} />
            Bring to front
          </button>
          <button className={styles.item} onClick={() => run(() => more.toBack(menu.layerId))} role="menuitem" type="button">
            <ArrowLineDown size={14} />
            Send to back
          </button>
        </>
      ) : null}
      {tab === "motion" ? (
        <>
      <button className={styles.item} disabled={more.isLottie()} onClick={() => run(() => more.applyFloating(menu.layerId))} role="menuitem" title={more.isLottie() ? "A Lottie project keeps its motion in the Lottie file" : undefined} type="button">
        <Sparkle size={14} />
        Apply Floating
      </button>
      <button className={styles.item} disabled={!more.hasMotion(menu.layerId)} onClick={() => run(() => more.copyMotion(menu.layerId))} role="menuitem" type="button">
        <CopySimple size={14} />
        Copy motion
      </button>
      <button className={styles.item} disabled={!more.hasMotionClip()} onClick={() => run(() => more.pasteMotion(menu.layerId))} role="menuitem" type="button">
        <ClipboardText size={14} />
        Paste motion
      </button>
      <button className={styles.item} disabled={!more.hasMotion(menu.layerId)} onClick={() => run(() => more.trimStart(menu.layerId))} role="menuitem" type="button">
        <CaretLineRight size={14} />
        Start at playhead
      </button>
      <button className={styles.item} disabled={!more.hasMotion(menu.layerId)} onClick={() => run(() => more.trimEnd(menu.layerId))} role="menuitem" type="button">
        <CaretLineLeft size={14} />
        End at playhead
      </button>
      <button className={styles.item} disabled={!more.hasMotion(menu.layerId)} onClick={() => run(() => more.clearMotion(menu.layerId))} role="menuitem" type="button">
        <Eraser size={14} />
        Clear motion
      </button>
        </>
      ) : null}
      {menu.error ? <div className={styles.error}>{menu.error}</div> : null}
      <textarea aria-label="Paste the design here" className={styles.catcher} readOnly ref={catcherRef} tabIndex={-1} value="" />
    </div>,
    document.body,
  );
}
