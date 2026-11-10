import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Button, FieldDescription } from "@/toolcraft/ui";

import { RATIO_KEYS, RATIO_LABELS, type RatioKey } from "./backdrop";
import styles from "./sticky-ratios.module.css";

// The ratios the sticky items show on. A click selects a ratio; another click deselects it.
export function StickyRatios({ setValue, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const selected = React.useMemo(
    () => new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : RATIO_KEYS),
    [value],
  );
  const toggle = (key: RatioKey): void => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setValue(RATIO_KEYS.filter((item) => next.has(item)));
  };
  return (
    <div className={styles.row}>
      <span className={styles.label}>Sticky shown</span>
      {RATIO_KEYS.map((key) => (
        <Button
          aria-pressed={selected.has(key)}
          key={key}
          onClick={() => toggle(key)}
          size="default"
          title={selected.has(key) ? "Sticky shows on this ratio. Click to hide it." : "Click to show the sticky on this ratio."}
          type="button"
          variant={selected.has(key) ? "secondary" : "outline"}
        >
          {RATIO_LABELS[key]}
        </Button>
      ))}
      <FieldDescription>Click a ratio to show the sticky on it. Click it again to hide it.</FieldDescription>
    </div>
  );
}
