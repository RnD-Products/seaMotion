import { ArrowClockwise } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, FieldDescription, FieldError } from "@/toolcraft/ui";

import { ANIMATION_LIBRARY_TARGET, getActiveAnimation, readAnimationLibrary, type AnimationSpec } from "../animation/animation-spec";
import { designFonts, fontKey, readFigmaDesign, type FigmaFont } from "./figma-paste-import";
import { resolveDesignFonts } from "./mo-fonts";
import styles from "./artboard-fonts.module.css";

const missingKeys = (spec: AnimationSpec): Set<string> => {
  const keys = new Set<string>();
  for (const block of readFigmaDesign(spec)?.blocks ?? []) for (const item of block.items) for (const key of item.text?.missing ?? []) keys.add(key);
  return keys;
};

const fontLabel = (font: FigmaFont): string => `${font.family} ${font.style}`;

// Artboard setting > fonts: the fonts the design's texts need that this computer and the app's Fonts folder do not have, and a
// reload button that looks again (after a font file was put into the Fonts folder).
export function ArtboardFonts({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const missing = React.useMemo(() => {
    if (!spec) return [];
    const keys = missingKeys(spec);
    return designFonts(spec).filter((font) => keys.has(fontKey(font)));
  }, [spec]);

  const reload = (): void => {
    if (!spec || busy) return;
    setBusy(true);
    setNote(null);
    resolveDesignFonts(spec)
      .then((next) => {
        const after = missingKeys(next);
        const found = missing.filter((font) => !after.has(fontKey(font)));
        if (found.length > 0) {
          const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
          dispatch({ label: "Reload fonts", target: ANIMATION_LIBRARY_TARGET, type: "controls.setValue", value: { items: { ...library.items, [next.id]: next } } });
        }
        setNote(found.length > 0 ? `Found ${found.map(fontLabel).join(", ")}.` : "No new font found. Put the font file in the Fonts folder and reload again.");
      })
      .catch(() => setNote("Could not look for fonts."))
      .finally(() => setBusy(false));
  };

  if (missing.length === 0) return null;
  const grouped = new Map<string, string[]>();
  for (const font of missing) grouped.set(font.family, [...(grouped.get(font.family) ?? []), font.style]);
  const families = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <div className={styles.text}>
          <FieldError>Font missing. Texts with these fonts show as a picture and cannot be edited:</FieldError>
          <ul className={styles.list}>
            {families.map(([family, list]) => (
              <li key={family}>
                <strong>{family}</strong>: {list.join(", ")}
              </li>
            ))}
          </ul>
        </div>
        <Button aria-label="Reload fonts" className={styles.reload} disabled={busy} onClick={reload} size="icon-sm" title="Reload fonts" type="button" variant="outline">
          <ArrowClockwise className={busy ? styles.spin : undefined} size={14} />
        </Button>
      </div>
      {note ? <FieldDescription>{note}</FieldDescription> : null}
    </div>
  );
}
