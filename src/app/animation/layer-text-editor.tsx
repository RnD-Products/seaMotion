import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Select, TextInput } from "@/toolcraft/ui";

import { useActiveLayerId } from "../mo/mo-layer-selection";
import styles from "./animation-controls.module.css";
import { useProbedTexts } from "./layer-texts";

const LABEL_LIMIT = 36;

const shorten = (text: string): string => (text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text);

// The layer's texts sit in one dropdown; the chosen one gets an input. The dropdown shows each
// text as it is now, and clearing an input back to the original wording restores the original.
export function LayerTextEditor({ setValue, state, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const layerId = useActiveLayerId(state.selectedLayerId);
  const texts = useProbedTexts(layerId);
  const [chosen, setChosen] = React.useState<string | null>(null);
  if (texts.length === 0) return null;
  const overrides = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, string>) : {};
  const original = chosen !== null && texts.includes(chosen) ? chosen : (texts[0] ?? "");
  const current = overrides[original] ?? original;
  return (
    <div className={styles.root}>
      <div className={styles.item}>
        <Select
          name="Text"
          onValueChange={setChosen}
          options={texts.map((text) => ({ label: shorten(overrides[text] ?? text), value: text }))}
          value={original}
        />
      </div>
      <div className={styles.item}>
        <TextInput
          key={original}
          name="Edit text"
          onValueChange={(next, meta) => {
            const { [original]: _previous, ...rest } = overrides;
            setValue(next === original ? rest : { ...rest, [original]: next }, meta);
          }}
          showLabel={false}
          value={current}
        />
      </div>
    </div>
  );
}
