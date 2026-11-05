import { CaretDown, CaretRight, CaretUp, Copy, Plus, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { createPortal } from "react-dom";
import type { ToolcraftState } from "@/toolcraft/runtime";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";
import { Button, Input, Select } from "@/toolcraft/ui";

import { MOTION_TYPES, MOTION_TYPE_TARGET, readMotionType } from "../animation/motion-type";
import {
  captureMoVersionValues,
  copyMoVersion,
  createMoVersion,
  isMoVersionModified,
  moVersionFingerprint,
  MO_VERSIONS_TARGET,
  nextMoVersionName,
  readMoVersions,
  versionLayerCommands,
  versionLoadValues,
  type MoVersion,
  type MoVersionsValue,
} from "./mo-versions";
import styles from "./mo-project-bar.module.css";

const APP_SELECTOR = '[data-slot="toolcraft-runtime-app"]';
const VIEWPORT_SELECTOR = '[data-slot="toolcraft-runtime-canvas"]';
const MAX_NAME_LENGTH = 40;
// The latest versions listed in the popup; older ones wait in a fold.
const RECENT_VERSIONS = 2;
// How long a change waits before it is saved into the version on show.
const AUTO_SAVE_MS = 3000;

// Only the last folder of the path ("…/Recovered"); the full path shows in the tooltip.
function shortFolder(dir: string | null): string {
  if (!dir) return "This browser";
  const last = dir.split("/").filter(Boolean).pop() ?? dir;
  return `…/${last}`;
}

type Popup = "actions" | "name" | "version" | null;

type Props = Readonly<{
  // The Clear caches button: beside the name while its popup is closed.
  clearCaches: React.ReactNode;
  id: string;
  name: string;
  onDelete: () => void;
  onDuplicate: () => void;
  onNew: () => void;
  // Returns false when the name is taken.
  onRename: (name: string) => boolean;
  // The save folder's full path (null while saving in the browser only), and the folder button with its menu.
  folderSettings: React.ReactNode;
  savedDir: string | null;
}>;

// The floating box at the top middle of the canvas: project name, then the version on show, then an arrow for
// Duplicate and Delete. The name opens project details, the version opens the version list.
export function MoProjectBar({ clearCaches, folderSettings, id, name, onDelete, onDuplicate, onNew, onRename, savedDir }: Props): React.JSX.Element | null {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const defaults = useToolcraftSelector((state) => state.defaults);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [centre, setCentre] = React.useState<number | null>(null);
  const [popup, setPopup] = React.useState<Popup>(null);
  const [nameDraft, setNameDraft] = React.useState(name);
  const [nameError, setNameError] = React.useState(false);
  const [olderOpen, setOlderOpen] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  // Dragging a version: the one being dragged and the row (by place in the list) it is over.
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropAt, setDropAt] = React.useState<number | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setHost(document.querySelector<HTMLElement>(APP_SELECTOR));
  }, []);

  // Sits at the middle of the canvas view, between the project panel and the inspector.
  React.useEffect(() => {
    const measure = (): void => {
      const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR)?.getBoundingClientRect();
      if (viewport && viewport.width > 0) setCentre(viewport.left + viewport.width / 2);
    };
    measure();
    const timer = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, []);

  React.useEffect(() => {
    if (!popup) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      // The Motion Type list opens outside the bar; choosing from it is not an outside click.
      if (event.target instanceof Element && event.target.closest('[data-slot="select-content"]')) return;
      setPopup(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      // While the Motion Type list is open, Escape only closes the list.
      if (event.key === "Escape" && !document.querySelector('[data-slot="select-content"]')) setPopup(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [popup]);

  const versions: MoVersionsValue = readMoVersions(values[MO_VERSIONS_TARGET]);
  const active = versions.items.find((item) => item.id === versions.activeId) ?? null;
  // The parts of the state a version reads.
  const snapshot = { defaults, layers, timeline: { durationSeconds }, values } as unknown as ToolcraftState;

  // The version on show keeps its changes: a change waits AUTO_SAVE_MS (each further change restarts the wait), then is saved
  // into that version. A version saved before a setting was kept has no value for it, so the version on show adopts the
  // current one, or edits to it would never count as changes.
  const latest = React.useRef({ snapshot, versions });
  latest.current = { snapshot, versions };
  const fingerprint = active && isMoVersionModified(snapshot, active) ? moVersionFingerprint(snapshot) : "";
  React.useEffect(() => {
    if (!active || !fingerprint) return undefined;
    const activeId = active.id;
    const timer = window.setTimeout(() => {
      const { snapshot: state, versions: list } = latest.current;
      setVersions({ ...list, items: list.items.map((item) => (item.id === activeId ? { ...createMoVersion(state, item.name), id: activeId } : item)) });
    }, AUTO_SAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, fingerprint]);
  const current = captureMoVersionValues(snapshot);
  const missingKey = active ? Object.keys(current).filter((key) => !(key in active.values)).join("|") : "";
  React.useEffect(() => {
    if (!active || !missingKey) return;
    const adopted = Object.fromEntries(missingKey.split("|").map((key) => [key, current[key]]));
    setVersions({ ...versions, items: versions.items.map((item) => (item.id === active.id ? { ...item, values: { ...item.values, ...adopted } } : item)) });
    // Runs once per version and set of missing settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, missingKey]);

  // The versions with any change still waiting on the one on show kept in it first.
  const savedBase = (): MoVersionsValue =>
    active && isMoVersionModified(snapshot, active)
      ? { ...versions, items: versions.items.map((item) => (item.id === active.id ? { ...createMoVersion(snapshot, item.name), id: item.id } : item)) }
      : versions;

  // Every project has a first version: v_01 is made as soon as a project has none, so the bar always shows a version.
  React.useEffect(() => {
    if (versions.items.length > 0) return;
    const first = createMoVersion(latest.current.snapshot, nextMoVersionName(versions));
    setVersions({ activeId: first.id, items: [first] });
    // Runs when the open project changes or its versions run out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, versions.items.length]);

  // A new version from the current settings, put on show.
  const addVersion = (): void => {
    setPopup(null);
    const base = savedBase();
    const next = createMoVersion(snapshot, nextMoVersionName(base));
    setVersions({ activeId: next.id, items: [...base.items, next] });
  };

  const setVersions = (next: MoVersionsValue): void => {
    dispatch({ label: "Versions", target: MO_VERSIONS_TARGET, type: "controls.setValue", value: next });
  };
  // Shows a version: a change still waiting on the one on show is kept in it first, then the version's settings,
  // script, duration and layers are applied (the same as picking it in the Motion tab).
  const showVersion = (version: MoVersion, given?: MoVersionsValue): void => {
    if (!given && version.id === versions.activeId) return;
    const base = given ?? savedBase();
    setVersions({ ...base, activeId: version.id });
    dispatch({ label: `Load ${version.name}`, type: "controls.apply", values: versionLoadValues(values, version, defaults) });
    dispatch({ durationSeconds: version.durationSeconds, type: "timeline.setDuration" });
    for (const command of versionLayerCommands(layers, version)) dispatch(command);
  };

  // Duplicate copies a version as it was saved under a new name. On the version on show it goes on from the copy; another
  // version is copied without switching to it.
  const duplicateVersion = (version: MoVersion): void => {
    const base = savedBase();
    const saved = base.items.find((item) => item.id === version.id) ?? version;
    const copy = copyMoVersion(saved, nextMoVersionName(base));
    setVersions(version.id === versions.activeId ? { activeId: copy.id, items: [...base.items, copy] } : { ...base, items: [...base.items, copy] });
  };

  // Deleting the version on show opens the one below it (or above it, when it was the last); a change waiting to be saved
  // goes with it. Deleting another version leaves the one on show as it is.
  const removeVersion = (version: MoVersion): void => {
    const index = versions.items.findIndex((item) => item.id === version.id);
    const items = versions.items.filter((item) => item.id !== version.id);
    if (versions.activeId !== version.id) {
      setVersions({ ...versions, items });
      return;
    }
    const next = items[Math.min(index, items.length - 1)];
    if (!next) setVersions({ activeId: null, items });
    else showVersion(next, { ...versions, items });
  };

  // Moves a version to a place in the list as shown (newest first). A version dragged from the older ones into the
  // list takes that place; the one pushed past the end of the list goes into the older ones.
  const moveVersion = (id: string, to: number): void => {
    const shown = [...versions.items].reverse();
    const moved = shown.find((item) => item.id === id);
    if (!moved) return;
    const rest = shown.filter((item) => item.id !== id);
    rest.splice(Math.min(to, rest.length), 0, moved);
    setVersions({ ...versions, items: rest.reverse() });
  };

  const commitRename = (version: MoVersion): void => {
    const next = renameDraft.trim().slice(0, MAX_NAME_LENGTH);
    setRenamingId(null);
    if (!next || next === version.name) return;
    setVersions({ ...versions, items: versions.items.map((item) => (item.id === version.id ? { ...item, name: next } : item)) });
  };

  const commitName = (): void => {
    const next = nameDraft.trim().slice(0, MAX_NAME_LENGTH);
    if (!next || next === name) {
      setNameDraft(name);
      setNameError(false);
      return;
    }
    if (onRename(next)) setNameError(false);
    else {
      setNameError(true);
      setNameDraft(name);
    }
  };

  const toggle = (next: Exclude<Popup, null>): void => {
    if (next === "name") {
      setNameDraft(name);
      setNameError(false);
    }
    setOlderOpen(false);
    setPopup((open) => (open === next ? null : next));
  };

  if (!host || centre === null) return null;

  // Newest first: the latest two, then the rest in the fold.
  const newestFirst = [...versions.items].reverse();
  const recent = newestFirst.slice(0, RECENT_VERSIONS);
  const older = newestFirst.slice(RECENT_VERSIONS);
  const shownVersions = [...recent, ...older];
  // ↑ ↓ (keys or the arrows under the list) show the version above or below the one on show; the older ones open when reached.
  const activeAt = shownVersions.findIndex((item) => item.id === versions.activeId);
  const newer = activeAt > 0 ? shownVersions[activeAt - 1] : undefined;
  const olderStep = activeAt >= 0 ? shownVersions[activeAt + 1] : undefined;
  const stepTo = (next: MoVersion): void => {
    if (shownVersions.indexOf(next) >= RECENT_VERSIONS) setOlderOpen(true);
    showVersion(next);
    window.setTimeout(() => rootRef.current?.querySelector<HTMLElement>(`[data-version-id="${next.id}"]`)?.focus(), 0);
  };
  const onListKey = (event: React.KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.target instanceof HTMLInputElement) return;
    const next = event.key === "ArrowDown" ? olderStep : newer;
    if (!next) return;
    event.preventDefault();
    stepTo(next);
  };
  const row = (version: MoVersion, index: number): React.ReactNode =>
    renamingId === version.id ? (
      <Input
        aria-label={`Rename ${version.name}`}
        autoFocus
        key={version.id}
        maxLength={MAX_NAME_LENGTH}
        onBlur={() => commitRename(version)}
        onChange={(event) => setRenameDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitRename(version);
          if (event.key === "Escape") {
            event.stopPropagation();
            setRenamingId(null);
          }
        }}
        value={renameDraft}
      />
    ) : (
      <div
        className={[styles.versionRow, version.id === versions.activeId ? styles.versionActive : "", dragId && dragId !== version.id && dropAt === index ? styles.dropTarget : ""].filter(Boolean).join(" ")}
        draggable
        key={version.id}
        onDragEnd={() => {
          setDragId(null);
          setDropAt(null);
        }}
        onDragOver={(event) => {
          if (!dragId) return;
          event.preventDefault();
          setDropAt(index);
        }}
        onDragStart={(event) => {
          setDragId(version.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", version.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragId) moveVersion(dragId, index);
          setDragId(null);
          setDropAt(null);
        }}
      >
        <Button
          aria-checked={version.id === versions.activeId}
          className={`${styles.item} ${styles.versionMain}`}
          data-version-id={version.id}
          onClick={() => showVersion(version)}
          onDoubleClick={() => {
            setRenamingId(version.id);
            setRenameDraft(version.name);
          }}
          role="menuitemradio"
          size="default"
          title="Click to show it, double-click to rename, drag to move"
          type="button"
          variant="ghost"
        >
          <span>
            {version.name}
            {version.id === versions.activeId && fingerprint ? <span aria-label={`Change saving into ${version.name}`} className={styles.pendingDot} key={fingerprint} /> : null}
          </span>
        </Button>
        <div className={styles.rowActions}>
          <Button aria-label={`Duplicate ${version.name}`} onClick={() => duplicateVersion(version)} size="icon-xs" title="Duplicate version" type="button" variant="ghost">
            <Copy size={12} />
          </Button>
          <Button aria-label={`Delete ${version.name}`} onClick={() => removeVersion(version)} size="icon-xs" title="Delete version" type="button" variant="ghost">
            <Trash size={12} />
          </Button>
        </div>
      </div>
    );

  return createPortal(
    <div className={styles.bar} data-mo-project-bar="" ref={rootRef} style={{ left: centre }}>
      {popup !== "name" ? clearCaches : null}
      <div className={styles.slotStatic}>
        <Button aria-expanded={popup === "name"} aria-haspopup="dialog" onClick={() => toggle("name")} size="default" type="button" variant="ghost">
          <span className={styles.name}>{name}</span>
        </Button>
        {popup === "name" ? (
          <div className={`${styles.popup} ${styles.popupFromBar}`} role="dialog">
            <div className={styles.field}>
              <Input
                aria-invalid={nameError}
                aria-label="Project name"
                autoFocus
                maxLength={MAX_NAME_LENGTH}
                onBlur={commitName}
                onChange={(event) => setNameDraft(event.target.value)}
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setNameDraft(name);
                    event.currentTarget.blur();
                  }
                }}
                value={nameDraft}
              />
              {nameError ? <span className={styles.label}>That name is already used.</span> : null}
              <span className={styles.id} title="This project's ID: unique, and saved in its file">
                ID {id}
              </span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Motion Type</span>
              <Select
                name="Motion type"
                onValueChange={(next) => {
                  if (MOTION_TYPES.some((type) => type.value === next && !type.locked)) {
                    dispatch({ label: "Motion type", target: MOTION_TYPE_TARGET, type: "controls.setValue", value: next });
                  }
                }}
                options={MOTION_TYPES.map((type) => ({ label: type.locked ? `${type.label} (soon)` : type.label, value: type.value }))}
                showLabel={false}
                value={readMotionType(values[MOTION_TYPE_TARGET])}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Saved to</span>
              <span className={styles.path} title={savedDir ?? "Saved in this browser"}>
                {shortFolder(savedDir)}
              </span>
              {folderSettings}
            </div>
          </div>
        ) : null}
      </div>
      <span aria-hidden="true" className={styles.separator}>
        _
      </span>
      <div className={styles.slotStatic}>
        <Button aria-expanded={popup === "version"} aria-haspopup="menu" onClick={() => toggle("version")} size="default" type="button" variant="ghost">
          <span>{active?.name ?? nextMoVersionName(versions)}</span>
          {fingerprint ? (
            <span
              aria-label={`Change saving into ${active?.name ?? "the version"}`}
              className={styles.pendingDot}
              key={fingerprint}
              title={`Saves into ${active?.name ?? "the version"} in 3 s`}
            />
          ) : null}
        </Button>
        {popup === "version" ? (
          <div className={`${styles.popup} ${styles.popupList} ${styles.popupFromBar}`} onKeyDown={onListKey} role="menu">
            {recent.map((version, index) => row(version, index))}
            {recent.length === 0 ? <span className={styles.label}>No versions yet.</span> : null}
            {older.length > 0 ? (
              <>
                <Button
                  aria-expanded={olderOpen}
                  className={styles.item}
                  onClick={() => setOlderOpen((open) => !open)}
                  size="default"
                  type="button"
                  variant="ghost"
                >
                  <span className={styles.muted}>History ({older.length})</span>
                  {olderOpen ? <CaretDown size={10} /> : <CaretRight size={10} />}
                </Button>
                {olderOpen ? <div className={styles.older}>{older.map((version, index) => row(version, RECENT_VERSIONS + index))}</div> : null}
              </>
            ) : null}
            <div className={styles.versionRow}>
              <Button className={`${styles.item} ${styles.versionMain}`} onClick={addVersion} role="menuitem" size="default" type="button" variant="ghost">
                <span>New version</span>
                <Plus size={12} />
              </Button>
              <div className={styles.navActions}>
                <Button aria-label="Show newer version" disabled={!newer} onClick={() => newer && stepTo(newer)} size="icon-xs" title="Newer version (↑)" type="button" variant="ghost">
                  <CaretUp size={12} />
                </Button>
                <Button aria-label="Show older version" disabled={!olderStep} onClick={() => olderStep && stepTo(olderStep)} size="icon-xs" title="Older version (↓)" type="button" variant="ghost">
                  <CaretDown size={12} />
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className={styles.slotStatic}>
        <Button aria-expanded={popup === "actions"} aria-haspopup="menu" aria-label="Project actions" onClick={() => toggle("actions")} size="icon-tight" type="button" variant="ghost">
          <CaretDown size={12} />
        </Button>
        {popup === "actions" ? (
          <div className={`${styles.popup} ${styles.popupList} ${styles.popupFromBar}`} role="menu">
            <Button
              className={styles.item}
              onClick={() => {
                setPopup(null);
                onNew();
              }}
              role="menuitem"
              size="default"
              type="button"
              variant="ghost"
            >
              <span>New project</span>
              <Plus size={12} />
            </Button>
            <Button
              className={styles.item}
              onClick={() => {
                setPopup(null);
                onDuplicate();
              }}
              role="menuitem"
              size="default"
              type="button"
              variant="ghost"
            >
              <span>Duplicate</span>
              <Copy size={12} />
            </Button>
            <Button
              className={styles.item}
              onClick={() => {
                setPopup(null);
                onDelete();
              }}
              role="menuitem"
              size="default"
              type="button"
              variant="ghost"
            >
              <span>Delete</span>
              <Trash size={12} />
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    host,
  );
}
