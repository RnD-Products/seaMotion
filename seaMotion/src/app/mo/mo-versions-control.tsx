import { CopySimple, DotsSixVertical, Trash } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, Input } from "@/toolcraft/ui";

import {
  captureMoVersionValues,
  copyMoVersion,
  createMoVersion,
  isMoVersionModified,
  moVersionFingerprint,
  nextMoVersionName,
  readMoVersions,
  versionLayerCommands,
  versionLoadValues,
  type MoVersion,
  type MoVersionsValue,
} from "./mo-versions";
import styles from "./mo-versions-control.module.css";

const MAX_NAME_LENGTH = 40;
// How long a change waits (the dot showing) before it is saved into the version on show.
const AUTO_SAVE_MS = 3000;

// The versions with `id` replaced by the current settings (same id and name).
function withSaved(versions: MoVersionsValue, id: string, state: ToolcraftCustomControlRendererProps["state"]): MoVersionsValue {
  return {
    ...versions,
    items: versions.items.map((item) => (item.id === id ? { ...createMoVersion(state, item.name), id } : item)),
  };
}

// Saves the current animation settings under a name and restores them later.
export function MoVersionsControl({
  dispatch,
  setValue,
  state,
  value,
}: ToolcraftCustomControlRendererProps): React.ReactNode {
  const versions = readMoVersions(value);
  const [draft, setDraft] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");

  // Dragging the grip (shown while the pointer is over a row) moves a version to the place it is dropped on; the one on show stays on show.
  const [dropAt, setDropAt] = React.useState<{ from: string; to: number } | null>(null);
  const startMove = (event: React.PointerEvent, id: string): void => {
    const list = listRef.current;
    if (!list) return;
    event.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("li")];
    const from = versions.items.findIndex((item) => item.id === id);
    const targetAt = (clientY: number): number => {
      let index = 0;
      rows.forEach((row, at) => {
        const box = row.getBoundingClientRect();
        if (clientY > box.top + box.height / 2) index = at + 1;
      });
      const domFrom = from - (archiveOpen ? 0 : split);
      return Math.min(versions.items.length - 1, Math.max(0, index > domFrom ? index - 1 : index) + (archiveOpen ? 0 : split));
    };
    document.documentElement.dataset.moDragging = "move";
    setDropAt({ from: id, to: from });
    const move = (e: PointerEvent): void => setDropAt({ from: id, to: targetAt(e.clientY) });
    const up = (e: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete document.documentElement.dataset.moDragging;
      setDropAt(null);
      const to = targetAt(e.clientY);
      if (to === from) return;
      const items = [...versions.items];
      const [moved] = items.splice(from, 1);
      if (moved) items.splice(to, 0, moved);
      setValue({ ...versions, items });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const save = (): void => {
    const name = draft.trim().slice(0, MAX_NAME_LENGTH) || nextMoVersionName(versions);
    const version = createMoVersion(state, name);
    setValue({ activeId: version.id, items: [...versions.items, version] });
    setDraft("");
  };
  // A version saved before a setting was kept in versions (Reactor and sound, for one) has no value for it, so
  // edits to it would never show as changes. The version on show takes those settings as they are now.
  const active = versions.items.find((item) => item.id === versions.activeId) ?? null;
  const current = captureMoVersionValues(state);
  const missing = active ? Object.keys(current).filter((key) => !(key in active.values)) : [];
  const missingKey = missing.join("|");
  React.useEffect(() => {
    if (!active || !missingKey) return;
    const adopted = Object.fromEntries(missing.map((key) => [key, current[key]]));
    setValue({
      ...versions,
      items: versions.items.map((item) => (item.id === active.id ? { ...item, values: { ...item.values, ...adopted } } : item)),
    });
    // Runs once per version and set of missing settings; the values are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, missingKey]);
  // The row just jumped to, briefly lit so the jump is felt.
  const [jumped, setJumped] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!jumped) return undefined;
    const timer = window.setTimeout(() => setJumped(null), 650);
    return () => window.clearTimeout(timer);
  }, [jumped]);
  const listRef = React.useRef<HTMLDivElement>(null);
  // Only the latest two versions are listed; the older ones wait in a fold ("Older versions") and can be dragged out of it into the list.
  const RECENT = 2;
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const split = Math.max(0, versions.items.length - RECENT);
  const hidden = archiveOpen ? 0 : split;
  // A change to the version on show waits AUTO_SAVE_MS (the dot showing; each further change restarts the wait),
  // then is saved into that version. Jumping away first saves it.
  const pending = active !== null && isMoVersionModified(state, active);
  const fingerprint = pending ? moVersionFingerprint(state) : "";
  const latest = React.useRef({ state, versions });
  latest.current = { state, versions };
  React.useEffect(() => {
    if (!active || !fingerprint) return undefined;
    const id = active.id;
    const timer = window.setTimeout(() => setValue(withSaved(latest.current.versions, id, latest.current.state)), AUTO_SAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, fingerprint]);
  const jumpTo = (version: MoVersion): void => {
    const base = active && pending ? withSaved(versions, active.id, state) : versions;
    if (version.id !== base.activeId) load(version, base);
    else if (base !== versions) setValue(base);
    setJumped(version.id);
  };
  // Arrow keys on a row jump to the version above or below it (and move the focus there).
  const jumpBy = (version: MoVersion, step: number): void => {
    const index = versions.items.findIndex((item) => item.id === version.id);
    const next = versions.items[index + step];
    if (!next) return;
    jumpTo(next);
    if (index + step < split) setArchiveOpen(true);
    listRef.current?.querySelectorAll<HTMLElement>("[data-version-row]")[index + step - hidden]?.focus();
  };
  const load = (version: MoVersion, base: MoVersionsValue = versions): void => {
    setValue({ ...base, activeId: version.id });
    // A version made by changing the motion brings its own script, controls and layers back with its settings.
    dispatch({ label: `Load ${version.name}`, type: "controls.apply", values: versionLoadValues(state.values, version, state.defaults) });
    dispatch({ durationSeconds: version.durationSeconds, type: "timeline.setDuration" });
    for (const command of versionLayerCommands(state.layers, version)) dispatch(command);
  };
  // Duplicate copies a version as a new one. On the version on show it first keeps any waiting change in it and
  // goes on from the copy; Cmd/Ctrl+click while a change waits puts the change in the new version instead and
  // leaves the version as it was saved. Another version is copied as saved, without switching to it.
  const duplicate = (version: MoVersion, toNew: boolean): void => {
    const name = nextMoVersionName(versions);
    if (version.id !== versions.activeId) {
      setValue({ ...versions, items: [...versions.items, copyMoVersion(version, name)] });
      return;
    }
    if (pending && toNew) {
      const next = createMoVersion(state, name);
      setValue({ activeId: next.id, items: [...versions.items, next] });
      setJumped(next.id);
      return;
    }
    const base = pending ? withSaved(versions, version.id, state) : versions;
    const saved = base.items.find((item) => item.id === version.id) ?? version;
    const copy = copyMoVersion(saved, name);
    setValue({ activeId: copy.id, items: [...base.items, copy] });
    setJumped(copy.id);
  };
  const startRename = (version: MoVersion): void => {
    setRenamingId(version.id);
    setRenameDraft(version.name);
  };
  const commitRename = (version: MoVersion): void => {
    const name = renameDraft.trim().slice(0, MAX_NAME_LENGTH);
    setRenamingId(null);
    if (!name || name === version.name) return;
    setValue({
      ...versions,
      items: versions.items.map((item) => (item.id === version.id ? { ...item, name } : item)),
    });
  };
  // Deleting the version on show opens the one below it (or above it, when it was the last); a change waiting to
  // be saved goes with the deleted version. Deleting another version leaves the one on show as it is.
  const remove = (version: MoVersion): void => {
    const index = versions.items.findIndex((item) => item.id === version.id);
    const items = versions.items.filter((item) => item.id !== version.id);
    if (versions.activeId !== version.id) {
      setValue({ ...versions, items });
      return;
    }
    const next = items[Math.min(index, items.length - 1)];
    if (!next) {
      setValue({ activeId: null, items });
      return;
    }
    load(next, { activeId: version.id, items });
    setJumped(next.id);
  };

  const renderRow = (version: MoVersion): React.ReactNode => {
            const isActive = version.id === versions.activeId;
            const waiting = isActive && pending;
            return (
            <li
              aria-current={isActive ? "true" : undefined}
              className={[styles.item, isActive ? styles.active : "", dropAt?.from === version.id ? styles.lifted : "", dropAt && dropAt.from !== version.id && versions.items[dropAt.to]?.id === version.id ? (versions.items.findIndex((item) => item.id === dropAt.from) < dropAt.to ? styles.dropping : styles.droppingUp) : ""].filter(Boolean).join(" ")}
              key={version.id}
            >
              {renamingId === version.id ? (
                <Input
                  aria-label={`Rename ${version.name}`}
                  autoFocus
                  maxLength={MAX_NAME_LENGTH}
                  onBlur={() => commitRename(version)}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onFocus={(event) => event.target.select()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename(version);
                    if (event.key === "Escape") setRenamingId(null);
                  }}
                  value={renameDraft}
                />
              ) : (
                <span
                  aria-label={`Jump to ${version.name}`}
                  className={jumped === version.id ? `${styles.name} ${styles.jumped}` : styles.name}
                  data-version-row=""
                  onClick={() => jumpTo(version)}
                  onDoubleClick={() => startRename(version)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      jumpTo(version);
                    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      jumpBy(version, event.key === "ArrowDown" ? 1 : -1);
                    } else if (event.key === "F2") {
                      startRename(version);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={`${version.name}: click to jump to it, double-click to rename (↑ ↓ to move between versions)`}
                >
                  {version.name}
                  {waiting ? (
                    <span
                      aria-label={`Change saving into ${version.name}`}
                      className={styles.pendingDot}
                      key={fingerprint}
                      title={`Saves into ${version.name} in 3 s. Cmd+click Duplicate to save it as a new version instead.`}
                    />
                  ) : null}
                </span>
              )}
              <span
                aria-label={`Drag ${version.name} to move it`}
                className={styles.grip}
                data-drag="move"
                onPointerDown={(event) => startMove(event, version.id)}
                role="button"
                title="Drag to move the version"
              >
                <DotsSixVertical size={14} weight="bold" />
              </span>
              <Button
                aria-label={`Duplicate ${version.name} as a new version`}
                onClick={(event) => duplicate(version, event.metaKey || event.ctrlKey)}
                size="icon-sm"
                title={
                  waiting
                    ? `Cmd+click: save your change as ${nextMoVersionName(versions)} and keep ${version.name} as it was`
                    : "Duplicate as a new version"
                }
                type="button"
                variant="ghost"
              >
                <CopySimple size={14} />
              </Button>
              <Button
                aria-label={`Delete ${version.name}`}
                onClick={() => remove(version)}
                size="icon-sm"
                title="Delete"
                type="button"
                variant="ghost"
              >
                <Trash size={14} />
              </Button>
            </li>
            );
  };

  return (
    <div className={styles.root}>
      <div className={styles.saveRow}>
        <Input
          aria-label="Version name"
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          placeholder={nextMoVersionName(versions)}
          value={draft}
        />
        <Button onClick={save} type="button">
          Save
        </Button>
      </div>
      {versions.items.length === 0 ? null : (
        <div ref={listRef}>
          {split > 0 ? (
            <div className={archiveOpen ? `${styles.archive} ${styles.archiveOpen}` : styles.archive}>
              <button aria-expanded={archiveOpen} className={styles.archiveToggle} onClick={() => setArchiveOpen(!archiveOpen)} title="The older versions: drag one out of here into the list" type="button">
                <span aria-hidden="true">{archiveOpen ? "▾" : "▸"}</span> Older versions ({split})
              </button>
              {archiveOpen ? <ul className={styles.list}>{versions.items.slice(0, split).map(renderRow)}</ul> : null}
            </div>
          ) : null}
          <ul className={styles.list}>{versions.items.slice(split).map(renderRow)}</ul>
        </div>
      )}
    </div>
  );
}
