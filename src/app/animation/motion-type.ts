export type MotionType = "animation" | "animation2" | "app" | "dashboard" | "interaction" | "landing" | "lottie";

export const MOTION_TYPE_TARGET = "motion.type";

export const MOTION_TYPES: readonly Readonly<{ label: string; locked: boolean; value: MotionType }>[] = [
  { label: "Animation", locked: false, value: "animation" },
  { label: "Interaction Animation", locked: false, value: "interaction" },
  // The type a new project starts with. The Interaction Animation settings as they are now (Motion Plan with cursor and slide-in cards, Reactor, sticky and design background, default scenes on an empty canvas). The scenes strip and the Overview/scene timeline are shared by every motion type.
  { label: "Animation_v2", locked: false, value: "animation2" },
  { label: "Landing Page", locked: false, value: "landing" },
  { label: "Lottie Animation", locked: false, value: "lottie" },
  { label: "Dashboard", locked: true, value: "dashboard" },
  { label: "App", locked: true, value: "app" },
];

// The types that play scenes with a Motion Plan (Interaction Animation and Animation_v2 work the same way).
export const isSceneMotionType = (type: MotionType): boolean => type === "interaction" || type === "animation2";

// A project that has no type yet (older files) is a plain animation; locked types fall back to it.
export function readMotionType(value: unknown): MotionType {
  const found = MOTION_TYPES.find((type) => type.value === value && !type.locked);
  return found ? found.value : "animation";
}

export type LandingMockup = "browser" | "device" | "fill" | "image" | "none";

export const LANDING_MOCKUP_TARGET = "landing.mockup";

export const LANDING_MOCKUPS: readonly Readonly<{ label: string; locked: boolean; value: LandingMockup }>[] = [
  { label: "None", locked: false, value: "none" },
  { label: "Fill", locked: false, value: "fill" },
  { label: "Browser mock", locked: false, value: "browser" },
  { label: "Image", locked: false, value: "image" },
  { label: "Device", locked: true, value: "device" },
];

export function readLandingMockup(value: unknown): LandingMockup {
  const found = LANDING_MOCKUPS.find((mockup) => mockup.value === value && !mockup.locked);
  return found ? found.value : "none";
}
