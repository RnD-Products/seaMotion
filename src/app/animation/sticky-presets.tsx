import { CopySimple, Plus, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector, type ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, FieldDescription, Input } from "@/toolcraft/ui";

import { deletePreset, listPresets, savePreset, type Preset } from "../mo/mo-presets";
import styles from "./sticky-presets.module.css";

// The sticky settings of the project (the ratios, the top and the bottom item): one preset is all of them.
const isStickyKey = (key: string): boolean => key.startsWith("sticky.") && key !== "sticky.preset";

const sameValues = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  return true;
};

// Sticky presets: save the sticky settings as a named preset (the + button), choose one to use it in any project, remove one with its x.
export function StickyPresets(_props: ToolcraftCustomControlRendererProps): React.ReactNode {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const [presets, setPresets] = React.useState<readonly Preset[] | null | undefined>(undefined);
  const [naming, setNaming] = React.useState<string | null>(null);
  // The preset being renamed (double click on its name) and the name typed so far.
  const [renaming, setRenaming] = React.useState<{ draft: string; name: string } | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const reload = React.useCallback(async () => setPresets(await listPresets("sticky")), []);
  React.useEffect(() => {
    void reload();
  }, [reload]);

  const current = React.useMemo(() => Object.fromEntries(Object.entries(values).filter(([key]) => isStickyKey(key))), [values]);
  const nextName = (): string => {
    let n = (presets?.length ?? 0) + 1;
    while (presets?.some((preset) => preset.name === `Sticky ${n}`)) n += 1;
    return `Sticky ${n}`;
  };
  const save = async (): Promise<void> => {
    const name = (naming ?? "").trim() || nextName();
    setNaming(null);
    const ok = await savePreset("sticky", name, current);
    setMessage(ok ? null : "The preset could not be saved. Start the app with npm run dev (the helper keeps the presets).");
    await reload();
  };
  const apply = (preset: Preset): void => {
    dispatch({ label: `Sticky preset ${preset.name}`, type: "controls.apply", values: { ...preset.values } });
  };
  // A copy under a free name ("Name copy", "Name copy 2" …).
  const duplicate = async (preset: Preset): Promise<void> => {
    let name = `${preset.name} copy`;
    for (let n = 2; presets?.some((item) => item.name === name); n += 1) name = `${preset.name} copy ${n}`;
    await savePreset("sticky", name, preset.values);
    await reload();
  };
  const rename = async (): Promise<void> => {
    const current = renaming;
    setRenaming(null);
    if (!current) return;
    const name = current.draft.trim().slice(0, 60);
    const preset = presets?.find((item) => item.name === current.name);
    if (!name || name === current.name || !preset) return;
    if (presets?.some((item) => item.name === name)) {
      setMessage(`There is already a preset named ${name}.`);
      return;
    }
    setMessage(null);
    await savePreset("sticky", name, preset.values);
    await deletePreset("sticky", current.name);
    await reload();
  };
  const remove = async (preset: Preset): Promise<void> => {
    await deletePreset("sticky", preset.name);
    await reload();
  };

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.title}>Presets</span>
        <Button aria-label="Save the sticky settings as a new preset" onClick={() => setNaming(nextName())} size="icon-xs" title="Save these sticky settings as a new preset" type="button" variant="ghost">
          <Plus size={14} weight="bold" />
        </Button>
      </div>
      {naming !== null ? (
        <Input
          aria-label="Preset name"
          autoFocus
          maxLength={60}
          onBlur={() => void save()}
          onChange={(event) => setNaming(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") void save();
            if (event.key === "Escape") setNaming(null);
          }}
          value={naming}
        />
      ) : null}
      <div className={styles.list}>
        {(presets ?? []).map((preset) => {
          const active = sameValues(preset.values, current);
          return (
            <span className={active ? `${styles.chip} ${styles.active}` : styles.chip} key={preset.name}>
              {renaming?.name === preset.name ? (
                <input
                  aria-label={`Rename ${preset.name}`}
                  autoFocus
                  className={styles.rename}
                  maxLength={60}
                  onBlur={() => void rename()}
                  onChange={(event) => setRenaming({ draft: event.target.value, name: preset.name })}
                  onFocus={(event) => event.target.select()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") void rename();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  value={renaming.draft}
                />
              ) : (
                <button className={styles.name} onClick={() => apply(preset)} onDoubleClick={() => setRenaming({ draft: preset.name, name: preset.name })} title={`Use ${preset.name} for this project · double click to rename`} type="button">
                  {preset.name}
                </button>
              )}
              <button aria-label={`Duplicate ${preset.name}`} className={styles.tool} onClick={() => void duplicate(preset)} title="Duplicate this preset" type="button">
                <CopySimple size={11} />
              </button>
              <button aria-label={`Delete ${preset.name}`} className={styles.tool} onClick={() => void remove(preset)} title="Delete this preset" type="button">
                <Trash size={11} />
              </button>
            </span>
          );
        })}
      </div>
      {presets === null ? <FieldDescription>Presets need the app's helper (start it with npm run dev).</FieldDescription> : null}
      {presets && presets.length === 0 && naming === null ? <FieldDescription>No presets yet. Set the sticky items, then press + to keep them for other projects.</FieldDescription> : null}
      {message ? <FieldDescription>{message}</FieldDescription> : null}
    </div>
  );
}
