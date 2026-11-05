import type { AnimationSandbox, DesignBounds } from "./animation-sandbox";
import { getRenderSize, resolveParams, type AnimationSpec } from "./animation-spec";
import { createInteraction, type InteractionItem } from "./interactions";

const STEP_SECONDS = 0.1;
const SAMPLE_SCALE = 0.25;
// The cursor tip must move more than this (design units per step) to count as moving.
const MOVE_THRESHOLD = 2;
const MIN_MOVE_STEPS = 2;
const MIN_DWELL_SECONDS = 0.3;

type Sample = "move" | "none" | "still";

// Reads the animation's own cursor over the loop and makes one kit item per segment of its motion: a
// Cursor item for each stretch where the cursor travels, and a Tap item for each stretch where it
// rests on the page. The cursor layer is drawn alone at each moment and its position is measured.
export async function createItemsFromMotion(
  sandbox: AnimationSandbox,
  spec: AnimationSpec,
  options: Readonly<{
    canvas: Readonly<{ height: number; width: number }>;
    cursorLayerId: string;
    durationSeconds: number;
    params: unknown;
  }>,
): Promise<InteractionItem[]> {
  const drawSize = getRenderSize(spec, options.canvas);
  const params = resolveParams(spec, options.params);
  const count = Math.floor(options.durationSeconds / STEP_SECONDS) + 1;
  const points: (DesignBounds | null)[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push(
      await sandbox.measureBounds({
        durationSeconds: options.durationSeconds,
        height: drawSize.height,
        layerStack: [options.cursorLayerId],
        params,
        pixelHeight: Math.max(1, Math.ceil(drawSize.height * SAMPLE_SCALE)),
        pixelScale: SAMPLE_SCALE,
        pixelWidth: Math.max(1, Math.ceil(drawSize.width * SAMPLE_SCALE)),
        timeSeconds: index * STEP_SECONDS,
        width: drawSize.width,
      }),
    );
  }
  const states: Sample[] = points.map((point, index) => {
    if (!point) return "none";
    const before = points[index - 1];
    const after = points[index + 1];
    const near = (other: DesignBounds | null | undefined): number | null =>
      other ? Math.hypot(other.x - point.x, other.y - point.y) : null;
    const back = near(before);
    const forward = near(after);
    return (back !== null && back > MOVE_THRESHOLD) || (forward !== null && forward > MOVE_THRESHOLD) ? "move" : "still";
  });

  const items: InteractionItem[] = [];
  let index = 0;
  while (index < states.length) {
    const state = states[index] ?? "none";
    let end = index;
    while (end + 1 < states.length && states[end + 1] === state) end += 1;
    const length = end - index + 1;
    const start = index * STEP_SECONDS;
    if (state === "move" && length >= MIN_MOVE_STEPS) {
      items.push(createInteraction("cursor", { duration: Math.max(STEP_SECONDS * 2, length * STEP_SECONDS), start }));
    } else if (state === "still" && length * STEP_SECONDS >= MIN_DWELL_SECONDS) {
      items.push(createInteraction("tap", { duration: length * STEP_SECONDS, start }));
    }
    index = end + 1;
  }
  return items;
}
