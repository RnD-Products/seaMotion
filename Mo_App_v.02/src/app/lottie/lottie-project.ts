import { ANIMATION_FRAME_TARGET, type AnimationSpec } from "../animation/animation-spec";
import { MOTION_TYPE_TARGET } from "../animation/motion-type";
import type { ProjectFile } from "../mo/mo-projects";
import { lottieInfo, lottieLayers, type LottieData } from "./lottie-data";

// A Lottie file opened as a new Lottie Animation project: the canvas takes the animation's size, the
// timeline its length, every top-level Lottie layer becomes a design layer, and the frame draws nothing
// around it (so the preview shows what the Lottie file shows).
export function buildProjectFromLottie(data: LottieData, fileName: string): ProjectFile {
  const info = lottieInfo(data);
  const name = fileName.replace(/\.json$/i, "").trim() || info.name.trim() || "Lottie animation";
  const layers = lottieLayers(data);
  const spec: AnimationSpec = {
    assets: {},
    code: "// Lottie Animation: drawn by the app's Lottie player from `lottie`.",
    controls: [],
    fonts: [],
    id: `lottie-${Date.now().toString(36)}`,
    imageAssets: [],
    layers,
    lottie: data,
    name,
    size: { height: info.height, width: info.width },
    version: 1,
  };
  return {
    animation: spec,
    canvas: { mode: "finite", size: { height: info.height, width: info.width } },
    durationSeconds: info.durationSeconds,
    id: null,
    layers: layers.map((layer) => ({ id: layer.id, kind: "layer", name: layer.name, visible: true })),
    name,
    params: {},
    values: {
      [ANIMATION_FRAME_TARGET]: { clip: false, fill: false, stroke: false },
      [MOTION_TYPE_TARGET]: "lottie",
    },
  };
}
