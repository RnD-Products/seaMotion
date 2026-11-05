import type * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { FieldDescription } from "@/toolcraft/ui";

import { NO_ANIMATION } from "../animation/animation-spec";

// A blank project has no motion: the Animation plan section says so. Open a project to load its animation.
export function MoMotionPickerControl({ value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  if (value !== NO_ANIMATION) return null;
  return <FieldDescription>No animation yet. Open a project above to load its animation.</FieldDescription>;
}
