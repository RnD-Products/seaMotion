import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";
import { Select } from "@/toolcraft/ui";

import { LANDING_MOCKUPS, MOTION_TYPES, readLandingMockup, readMotionType } from "./motion-type";

// Picks the kind of motion this project is. Dashboard and App are listed but cannot be chosen yet.
export function MotionTypeControl({ setValue, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  // Choosing a locked entry changes nothing; the new key makes the dropdown show the real value again.
  const [reset, setReset] = React.useState(0);
  return (
    <Select
      key={reset}
      name="Motion type"
      onValueChange={(next) => {
        if (MOTION_TYPES.some((type) => type.value === next && !type.locked)) setValue(next);
        else setReset((count) => count + 1);
      }}
      options={MOTION_TYPES.map((type) => ({ label: type.locked ? `${type.label} (soon)` : type.label, value: type.value }))}
      showLabel={false}
      value={readMotionType(value)}
    />
  );
}

// The frame a Landing Page is shown in. Device is listed but cannot be chosen yet.
export function LandingMockupControl({ setValue, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const [reset, setReset] = React.useState(0);
  return (
    <Select
      key={reset}
      name="Mockup"
      onValueChange={(next) => {
        if (LANDING_MOCKUPS.some((mockup) => mockup.value === next && !mockup.locked)) setValue(next);
        else setReset((count) => count + 1);
      }}
      showLabel={false}
      options={LANDING_MOCKUPS.map((mockup) => ({ label: mockup.locked ? `${mockup.label} (soon)` : mockup.label, value: mockup.value }))}
      value={readLandingMockup(value)}
    />
  );
}
