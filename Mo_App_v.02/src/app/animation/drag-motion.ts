import type { AnimationSandbox } from "./animation-sandbox";
import { getRenderSize, resolveParams, type AnimationSpec } from "./animation-spec";
import { getCursorLayerId, type InteractionItem } from "./interactions";

// How the animation's cursor really moves during each Reactor Drag: its speed and direction, sampled from the
// cursor layer, so a drag sound (a reel, a swish, ticks) speeds up with fast movement and goes quiet at the
// turnarounds instead of following a fixed curve.
export type DragPath = Readonly<{
  // Direction of travel at each sample: 1 forward (right or down), -1 back, 0 still.
  dir: readonly number[];
  // Cursor speed at each sample, in design px per second.
  speed: readonly number[];
  start: number;
  step: number;
}>;
export type DragPaths = Readonly<Record<string, DragPath>>;

const STEP_SECONDS = 1 / 30;
const SAMPLE_SCALE = 0.5;

// What the sampled paths depend on, to reuse them until one of these changes.
export function dragPathsKey(spec: AnimationSpec | null, params: unknown, items: readonly InteractionItem[], durationSeconds: number): string {
  const drags = items.filter((item) => item.type === "drag");
  if (!spec || drags.length === 0) return "";
  return JSON.stringify([spec.id, spec.version, params ?? null, Math.round(durationSeconds * 1000), drags.map((item) => [item.id, item.start, item.duration])]);
}

export async function sampleDragPaths(
  sandbox: AnimationSandbox,
  spec: AnimationSpec,
  options: Readonly<{
    canvas: Readonly<{ height: number; width: number }>;
    durationSeconds: number;
    items: readonly InteractionItem[];
    params: unknown;
  }>,
): Promise<DragPaths> {
  const cursorLayerId = getCursorLayerId(spec.layers);
  if (!cursorLayerId) return {};
  const drawSize = getRenderSize(spec, options.canvas);
  const params = resolveParams(spec, options.params);
  const paths: Record<string, DragPath> = {};
  for (const item of options.items) {
    if (item.type !== "drag" || !(item.duration > 0)) continue;
    const count = Math.max(2, Math.ceil(item.duration / STEP_SECONDS) + 1);
    const points: ({ height: number; width: number; x: number; y: number } | null)[] = [];
    for (let index = 0; index < count; index += 1) {
      const bounds = await sandbox.measureBounds({
        durationSeconds: options.durationSeconds,
        height: drawSize.height,
        layerStack: [cursorLayerId],
        params,
        pixelHeight: Math.max(1, Math.ceil(drawSize.height * SAMPLE_SCALE)),
        pixelScale: SAMPLE_SCALE,
        pixelWidth: Math.max(1, Math.ceil(drawSize.width * SAMPLE_SCALE)),
        timeSeconds: Math.min(item.start + item.duration - 0.001, item.start + index * STEP_SECONDS + 0.001),
        width: drawSize.width,
      });
      points.push(bounds ? { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y } : null);
    }
    // Speed from neighbouring samples, then smoothed over five samples so pixel steps do not flicker.
    const raw: number[] = [];
    const dirs: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(count - 1, index + 1)];
      const span = (Math.min(count - 1, index + 1) - Math.max(0, index - 1)) * STEP_SECONDS;
      // A change of the cursor's shape (arrow to hand and back) moves its box without any movement: not speed.
      const reshaped = before && after && (Math.abs(after.width - before.width) > 3 || Math.abs(after.height - before.height) > 3);
      if (!before || !after || span <= 0 || reshaped) {
        raw.push(0);
        dirs.push(0);
        continue;
      }
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      raw.push(Math.hypot(dx, dy) / span);
      const main = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      dirs.push(Math.abs(main) < 0.5 ? 0 : Math.sign(main));
    }
    const speed = raw.map((_, index) => {
      let sum = 0;
      let n = 0;
      for (let k = index - 2; k <= index + 2; k += 1) {
        const value = raw[k];
        if (value !== undefined) {
          sum += value;
          n += 1;
        }
      }
      return n > 0 ? sum / n : 0;
    });
    paths[item.id] = { dir: dirs, speed, start: item.start, step: STEP_SECONDS };
  }
  return paths;
}

// The speed (0..1 of the fastest drag in the project) and direction at a time inside a path.
export function pathAt(path: DragPath, time: number, fastest: number): { dir: number; speed: number } {
  const position = (time - path.start) / path.step;
  const index = Math.max(0, Math.min(path.speed.length - 1, Math.floor(position)));
  const next = Math.min(path.speed.length - 1, index + 1);
  const mix = Math.max(0, Math.min(1, position - index));
  const speed = (path.speed[index] ?? 0) * (1 - mix) + (path.speed[next] ?? 0) * mix;
  return { dir: path.dir[mix < 0.5 ? index : next] ?? 0, speed: fastest > 0 ? Math.min(1, speed / fastest) : 0 };
}

// The reference speed for a project: a little under its fastest drag, so the fastest moments reach full speed.
export function fastestSpeed(paths: DragPaths): number {
  let top = 0;
  for (const path of Object.values(paths)) for (const value of path.speed) top = Math.max(top, value);
  return top * 0.85;
}
