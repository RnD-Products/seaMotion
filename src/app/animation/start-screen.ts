// What a Landing Page shows during its Start: a preloader that covers the page for a while, or an
// intro transition that brings the page in. Drawn by the app on top of / around the page picture, so
// every imported page has all of them.
export type StartPreset =
  | "bar"
  | "blur"
  | "center"
  | "counter"
  | "dots"
  | "fade"
  | "pulse"
  | "ring"
  | "slide"
  | "spinner"
  | "thumbnail"
  | "wipe"
  | "zoom";

export type StartGroup = "Intro" | "Preloader" | "Thumbnail";

export const START_PRESETS: readonly Readonly<{ group: StartGroup; id: StartPreset; label: string }>[] = [
  { group: "Thumbnail", id: "thumbnail", label: "Page top (still)" },
  { group: "Preloader", id: "spinner", label: "Spinner" },
  { group: "Preloader", id: "bar", label: "Progress bar" },
  { group: "Preloader", id: "dots", label: "Bouncing dots" },
  { group: "Preloader", id: "ring", label: "Progress ring" },
  { group: "Preloader", id: "counter", label: "Percent counter" },
  { group: "Preloader", id: "pulse", label: "Pulse" },
  { group: "Intro", id: "fade", label: "Fade in" },
  { group: "Intro", id: "slide", label: "Slide up" },
  { group: "Intro", id: "zoom", label: "Zoom in" },
  { group: "Intro", id: "blur", label: "Blur in" },
  { group: "Intro", id: "wipe", label: "Wipe across" },
  { group: "Intro", id: "center", label: "Open from the centre" },
];

export const DEFAULT_START_PRESET: StartPreset = "spinner";
export const DEFAULT_START_COLOR = "#5B5CF6";

export function readStartPreset(value: unknown): StartPreset | undefined {
  return START_PRESETS.find((item) => item.id === value)?.id;
}

export function isIntro(preset: string): boolean {
  return START_PRESETS.find((item) => item.id === preset)?.group === "Intro";
}

// Preloaders cover the page; a thumbnail leaves the page as it is (its top view held still).
export function isPreloader(preset: string): boolean {
  return START_PRESETS.find((item) => item.id === preset)?.group === "Preloader";
}

// Where the Start is: progress runs 0..1 over its duration, time is the timeline second.
// `progress` is within the part being shown and `index` is which part of the Start it is.
export type StartDraw = Readonly<{ color: string; index: number; preset: string; progress: number; time: number }>;

export type PixelRect = Readonly<{ height: number; width: number; x: number; y: number }>;

const easeOutCubic = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

// Sets the drawing up for an intro transition, before the page picture is drawn.
export function applyIntro(context: CanvasRenderingContext2D, start: StartDraw, rect: PixelRect, scale: number): void {
  const p = easeOutCubic(start.progress);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  switch (start.preset) {
    case "fade":
      context.globalAlpha *= p;
      break;
    case "slide":
      context.globalAlpha *= p;
      context.translate(0, (1 - p) * rect.height * 0.07);
      break;
    case "zoom":
      context.globalAlpha *= p;
      context.translate(cx, cy);
      context.scale(1.12 - 0.12 * p, 1.12 - 0.12 * p);
      context.translate(-cx, -cy);
      break;
    case "blur":
      context.globalAlpha *= Math.min(1, p * 1.6);
      context.filter = `blur(${((1 - p) * 16 * scale).toFixed(2)}px)`;
      break;
    case "wipe":
      context.beginPath();
      context.rect(rect.x, rect.y, rect.width * p, rect.height);
      context.clip();
      break;
    case "center": {
      const width = rect.width * p;
      context.beginPath();
      context.rect(rect.x + (rect.width - width) / 2, rect.y, width, rect.height);
      context.clip();
      break;
    }
    default:
      break;
  }
}

// Draws a preloader over the page: a flat screen with the chosen loader, fading away at the end.
export function drawPreloader(context: CanvasRenderingContext2D, start: StartDraw, rect: PixelRect, scale: number, fill: string): void {
  const { color, preset, progress, time } = start;
  // It fades in when it follows another part (a thumbnail, say), and out at its end.
  const fadeIn = start.index > 0 ? Math.min(1, progress / 0.1) : 1;
  const alpha = Math.min(fadeIn, progress < 0.88 ? 1 : Math.max(0, 1 - (progress - 0.88) / 0.12));
  if (alpha <= 0) return;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const u = scale;
  context.save();
  context.globalAlpha *= alpha;
  context.fillStyle = fill;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.lineCap = "round";
  const faint = `${color}2e`;
  switch (preset) {
    case "bar": {
      const w = 220 * u;
      context.fillStyle = faint;
      context.beginPath();
      context.roundRect(cx - w / 2, cy - 3 * u, w, 6 * u, 3 * u);
      context.fill();
      context.fillStyle = color;
      context.beginPath();
      context.roundRect(cx - w / 2, cy - 3 * u, Math.max(6 * u, w * progress), 6 * u, 3 * u);
      context.fill();
      break;
    }
    case "dots": {
      context.fillStyle = color;
      for (let index = 0; index < 3; index += 1) {
        const phase = (((time * 2.2 - index * 0.18) % 1) + 1) % 1;
        const lift = Math.sin(phase * Math.PI);
        context.globalAlpha = alpha * (0.35 + 0.65 * lift);
        context.beginPath();
        context.arc(cx + (index - 1) * 22 * u, cy - lift * 8 * u, 6 * u, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case "ring": {
      context.lineWidth = 5 * u;
      context.strokeStyle = faint;
      context.beginPath();
      context.arc(cx, cy, 30 * u, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = color;
      context.beginPath();
      context.arc(cx, cy, 30 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, progress));
      context.stroke();
      context.fillStyle = color;
      context.font = `600 ${13 * u}px ${FONT}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`${Math.round(progress * 100)}%`, cx, cy + 0.5 * u);
      break;
    }
    case "counter": {
      context.fillStyle = color;
      context.font = `700 ${64 * u}px ${FONT}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`${Math.round(progress * 100)}%`, cx, cy);
      break;
    }
    case "pulse": {
      const phase = (time * 1.1) % 1;
      context.strokeStyle = color;
      context.lineWidth = 3 * u;
      context.globalAlpha = alpha * (1 - phase);
      context.beginPath();
      context.arc(cx, cy, (10 + phase * 34) * u, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.beginPath();
      context.arc(cx, cy, 9 * u, 0, Math.PI * 2);
      context.fill();
      break;
    }
    default: {
      const turn = time * 5;
      context.lineWidth = 4 * u;
      context.strokeStyle = faint;
      context.beginPath();
      context.arc(cx, cy, 22 * u, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = color;
      context.beginPath();
      context.arc(cx, cy, 22 * u, turn, turn + Math.PI * 1.3);
      context.stroke();
    }
  }
  context.restore();
}
