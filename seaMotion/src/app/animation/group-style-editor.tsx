import type * as React from "react";
import { Switch } from "@/toolcraft/ui";

import { ANIMATION_PARAMS_TARGET } from "./animation-spec";
import { CornerRadiusFields } from "./corner-radius-fields";
import { GROUP_STYLE_KEY, NO_GROUP_STYLE, readGroupStyles, type GroupStyle, type Radii } from "./group-style";

// A group layer's own settings: Clip content, and the corner radius of that clip, for all four corners together or one corner at a time.
export function GroupStyleEditor({
  dispatch,
  fallback,
  groupId,
  params,
}: Readonly<{
  dispatch: (command: Record<string, unknown>) => void;
  // What the group has before anything is set here: a frame pasted from Figma comes with its own clip and corner radii.
  fallback?: GroupStyle;
  groupId: string;
  params: Readonly<Record<string, unknown>>;
}>): React.JSX.Element {
  const base: GroupStyle = fallback ?? NO_GROUP_STYLE;
  const style: GroupStyle = readGroupStyles(params)[groupId] ?? base;
  const write = (next: GroupStyle, historyGroup?: string): void => {
    const map = { ...((params[GROUP_STYLE_KEY] ?? {}) as Record<string, unknown>) };
    // Back at what it started as: nothing is stored.
    if (next.clip === base.clip && next.radius.every((value, index) => value === base.radius[index])) delete map[groupId];
    else map[groupId] = next;
    const { [GROUP_STYLE_KEY]: _old, ...others } = params;
    dispatch({
      historyGroup,
      label: "Group style",
      target: ANIMATION_PARAMS_TARGET,
      type: "controls.setValue",
      value: Object.keys(map).length > 0 ? { ...others, [GROUP_STYLE_KEY]: map } : others,
    });
  };
  return (
    <>
      <Switch checked={style.clip} name="Clip content" onCheckedChange={(clip) => write({ ...style, clip })} />
      <CornerRadiusFields
        onChange={(next, historyGroup) => write({ ...style, radius: (Array.isArray(next) ? next : [next, next, next, next]) as unknown as Radii }, historyGroup)}
        radius={style.radius}
      />
    </>
  );
}
