import * as React from "react";

import type { LandingPlan } from "./landing-plan";

// A plan being nudged with the arrow keys. It is only shown on the canvas while the keys are held;
// nothing is saved until the keys have rested, so the preview stays smooth. Session-only.
let draft: LandingPlan | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setDraftPlan(plan: LandingPlan | null): void {
  if (draft === plan) return;
  draft = plan;
  for (const listener of listeners) listener();
}

export function useDraftPlan(): LandingPlan | null {
  return React.useSyncExternalStore(subscribe, () => draft);
}
