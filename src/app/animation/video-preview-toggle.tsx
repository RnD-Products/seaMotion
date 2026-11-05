import * as React from "react";
import { useToolcraftSelector } from "@/toolcraft/runtime/react";
import { Segmented } from "@/toolcraft/ui";

import { getActiveAnimation } from "./animation-spec";
import { setVideoStill, useVideoStill } from "./timeline-view";

// Preview only: the videos of the project show one still picture (nothing is decoded while it plays or is scrubbed) or play.
export function VideoPreviewToggle(): React.ReactNode {
  const still = useVideoStill();
  const values = useToolcraftSelector((state) => state.values);
  const spec = getActiveAnimation(values);
  if (!spec || Object.keys(spec.assetMedia ?? {}).length + Object.keys(spec.media ?? {}).length === 0) return null;
  return (
    <Segmented
      name="Video preview"
      onValueChange={(next) => setVideoStill(next === "still")}
      options={[
        { label: "Static", value: "still" },
        { label: "Playable", value: "play" },
      ]}
      value={still ? "still" : "play"}
    />
  );
}

