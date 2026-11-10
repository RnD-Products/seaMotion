import type * as React from "react";
import { Button, Label } from "@/toolcraft/ui";

import { ANIMATION_PARAMS_TARGET, type AnimationSpec } from "./animation-spec";
import styles from "./animation-controls.module.css";
import { limitFloats } from "./float-room";
import { alignLayer } from "./layer-align-action";
import type { AlignEdge } from "./layer-align";

// The same six icons, in the same order, as Figma's alignment bar: left, horizontal centres, right, top, vertical centres, bottom. Each is the
// alignment line with two boxes lined up against it.
const Icon = ({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element => (
  <svg aria-hidden fill="currentColor" height={16} viewBox="0 0 16 16" width={16}>
    {children}
  </svg>
);
const ALIGNMENTS = [
  { edge: "left", icon: <Icon><path d="M2 1.5h1v13H2z" /><rect height="3" rx="0.5" width="9" x="4.5" y="4" /><rect height="3" rx="0.5" width="5" x="4.5" y="9" /></Icon>, label: "Align left" },
  { edge: "hcenter", icon: <Icon><path d="M7.5 1.5h1v13h-1z" /><rect height="3" rx="0.5" width="10" x="3" y="4" /><rect height="3" rx="0.5" width="6" x="5" y="9" /></Icon>, label: "Align horizontal centers" },
  { edge: "right", icon: <Icon><path d="M13 1.5h1v13h-1z" /><rect height="3" rx="0.5" width="9" x="2.5" y="4" /><rect height="3" rx="0.5" width="5" x="6.5" y="9" /></Icon>, label: "Align right" },
  { edge: "top", icon: <Icon><path d="M1.5 2h13v1h-13z" /><rect height="9" rx="0.5" width="3" x="4" y="4.5" /><rect height="5" rx="0.5" width="3" x="9" y="4.5" /></Icon>, label: "Align top" },
  { edge: "vcenter", icon: <Icon><path d="M1.5 7.5h13v1h-13z" /><rect height="10" rx="0.5" width="3" x="4" y="3" /><rect height="6" rx="0.5" width="3" x="9" y="5" /></Icon>, label: "Align vertical centers" },
  { edge: "bottom", icon: <Icon><path d="M1.5 13h13v1h-13z" /><rect height="9" rx="0.5" width="3" x="4" y="2.5" /><rect height="5" rx="0.5" width="3" x="9" y="6.5" /></Icon>, label: "Align bottom" },
] as const satisfies readonly Readonly<{ edge: Exclude<AlignEdge, "center">; icon: React.ReactNode; label: string }>[];

// Moves the selected layer or group to an edge or the middle of the artboard, across and down on their own, like Figma. An action, not a setting:
// the icons never stay lit.
export function LayerAlignRow({
  area,
  dispatch,
  layerId,
  layers,
  params,
  spec,
}: Readonly<{
  area: Readonly<{ height: number; width: number }>;
  dispatch: (command: Record<string, unknown>) => void;
  layerId: string;
  layers: readonly Readonly<{ displayName?: string; id: string; kind?: string; name?: string; parentGroupId?: string; visible: boolean }>[];
  params: Readonly<Record<string, unknown>>;
  spec: AnimationSpec;
}>): React.JSX.Element {
  const press = (edge: Exclude<AlignEdge, "center">): void => {
    const next = alignLayer(edge, spec, layers, layerId, params, area);
    // A Floating preset on the layer keeps to the room it has left on the artboard.
    if (next) dispatch({ label: "Align layer", target: ANIMATION_PARAMS_TARGET, type: "controls.setValue", value: limitFloats(next, spec, layers, [layerId], area) });
  };
  return (
    <div className={styles.alignGroup}>
      <Label className={styles.alignLabel}>Alignment</Label>
      <div className={styles.align}>
        {ALIGNMENTS.map((item) => (
        <Button aria-label={item.label} className={styles.alignButton} key={item.edge} onClick={() => press(item.edge)} size="icon" title={item.label} type="button" variant="ghost">
          {item.icon}
        </Button>
        ))}
      </div>
    </div>
  );
}
