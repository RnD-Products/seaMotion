import { Cube } from "@phosphor-icons/react";
import * as React from "react";
import { PanelSection } from "@/toolcraft/ui";

import styles from "./mo-effects-panel.module.css";

type Props = Readonly<{
  // Whether a layer is selected in the Layers tab (Perspective works on it).
  hasLayer: boolean;
  onTogglePerspective: () => void;
  perspectiveOn: boolean;
}>;

// The Effects panel: the effects as name cards. Perspective is the first.
export function MoEffectsPanel({ hasLayer, onTogglePerspective, perspectiveOn }: Props): React.JSX.Element {
  const blocked = !hasLayer && !perspectiveOn;
  return (
    <PanelSection title="Effects">
      <div className={styles.list}>
        <button
          aria-pressed={perspectiveOn}
          className={perspectiveOn ? `${styles.card} ${styles.on}` : styles.card}
          disabled={blocked}
          onClick={onTogglePerspective}
          title={blocked ? "Perspective: select a layer in the Layers tab first" : "Perspective: tilt the selected layer"}
          type="button"
        >
          <span className={styles.icon}>
            <Cube size={16} weight={perspectiveOn ? "fill" : "regular"} />
          </span>
          <span className={styles.text}>
            <span className={styles.name}>Perspective</span>
            <span className={styles.meta}>{blocked ? "Select a layer first" : "Tilt the selected layer"}</span>
          </span>
          <span className={styles.state}>{perspectiveOn ? "On" : "Off"}</span>
        </button>
      </div>
    </PanelSection>
  );
}
