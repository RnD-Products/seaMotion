// What sits behind the design on the artboard: an optional mockup image, and a top and a bottom
// sticky item (an image or a line of text). All of it is stored in control values, so it travels in
// project files, and it is drawn by the same code for the live canvas and for Render.
export type StickyAlign = "center" | "left" | "right";
export type StickyType = "image" | "off" | "text";
export type BackgroundMode = "design" | "fill" | "mockup" | "transparent";

export type StickySettings = Readonly<{
  align: StickyAlign;
  image: string;
  imageSize: number;
  offset: number;
  text: string;
  textColor: string;
  textSize: number;
  type: StickyType;
}>;

// The artboard's Fill: one color, or a linear gradient from `from` to `to` (angle in degrees, 180 = top to bottom).
export type BackgroundFill = Readonly<{ angle: number; from: string; gradient: boolean; to: string }>;

export type BackdropSettings = Readonly<{
  bottom: StickySettings;
  fill: BackgroundFill;
  mockup: string;
  mode: BackgroundMode;
  top: StickySettings;
}>;

export const BG_MODE_TARGET = "bg.mode";
export const STICKY_RATIOS_TARGET = "sticky.ratios";
export const BG_MOCKUP_TARGET = "bg.mockup";
export const stickyTarget = (side: "bottom" | "top", field: string): string => `sticky.${side}.${field}`;

// A picture control holds several pictures and shows the selected one. Older projects stored the one
// picture as a plain string, which still reads as a single selected picture.
export type ImageSlotValue = Readonly<{ items: readonly string[]; selected: number }>;

export function readImageSlot(value: unknown): ImageSlotValue {
  if (typeof value === "string") return { items: value ? [value] : [], selected: 0 };
  if (typeof value === "object" && value !== null) {
    const record = value as { items?: unknown; selected?: unknown };
    const items = Array.isArray(record.items) ? record.items.filter((item): item is string => typeof item === "string" && item !== "") : [];
    const selected = typeof record.selected === "number" && record.selected >= 0 && record.selected < items.length ? record.selected : 0;
    return { items, selected };
  }
  return { items: [], selected: 0 };
}

export const getSelectedImage = (value: unknown): string => {
  const { items, selected } = readImageSlot(value);
  return items[selected] ?? "";
};

const HEX = /^#[0-9a-f]{6}$/i;
const SIDE_PADDING = 40;
// A sticky picture at 100% scale is this tall, in design units.
const IMAGE_BASE_HEIGHT = 80;

const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;

function readSticky(values: Readonly<Record<string, unknown>>, side: "bottom" | "top"): StickySettings {
  const read = (field: string): unknown => values[stickyTarget(side, field)];
  const color = read("textColor");
  return {
    align: oneOf(read("align"), ["left", "center", "right"], "left"),
    image: getSelectedImage(read("image")),
    imageSize: num(read("imageSize"), 100),
    offset: num(read("offset"), 24),
    text: text(read("text"), ""),
    textColor: typeof color === "string" && HEX.test(color) ? color : "#111111",
    textSize: num(read("textSize"), 36),
    type: oneOf(read("type"), ["off", "image", "text"], "off"),
  };
}

const hexOr = (value: unknown, fallback: string): string => (typeof value === "string" && HEX.test(value) ? value : fallback);

export function readBackdrop(values: Readonly<Record<string, unknown>>): BackdropSettings {
  return {
    bottom: readSticky(values, "bottom"),
    fill: {
      angle: num(values["bg.fillAngle"], 180),
      from: hexOr(values["appearance.background"], "#DFDFDF"),
      gradient: values["bg.fillType"] === "gradient",
      to: hexOr(values["bg.fillTo"], "#FFFFFF"),
    },
    mockup: getSelectedImage(values[BG_MOCKUP_TARGET]),
    // The old "Design background" option is gone; a project that still has it uses Fill.
    mode: oneOf(values[BG_MODE_TARGET], ["fill", "mockup", "transparent"], "fill"),
    top: readSticky(values, "top"),
  };
}

// The pictures the current settings draw.
export function getBackdropSources(settings: BackdropSettings): string[] {
  const sources: string[] = [];
  if (settings.mode === "mockup" && settings.mockup) sources.push(settings.mockup);
  for (const sticky of [settings.top, settings.bottom]) {
    if (sticky.type === "image" && sticky.image) sources.push(sticky.image);
  }
  return [...new Set(sources)];
}

export type BackdropImages = ReadonlyMap<string, HTMLImageElement>;

export type MockupViewport = Readonly<{ height: number; topBleed: number; width: number; x: number; y: number }>;

// This MacBook composition has a photographed bezel, camera and menu bar above its replaceable
// display area. Probe those features so the same image works after PNG/WebP re-encoding.
const MACBOOK_DISPLAY = { x: 338, y: 204, width: 919, height: 580 } as const;
// The photographed Safari separator overlaps the detected page boundary by a few source pixels.
// Perspective content may bleed into that strip so a top pin can meet the menu bar cleanly, while
// the fixed mask still protects the camera and the rest of the bezel.
const MACBOOK_DISPLAY_TOP_BLEED = 3;
const viewportMatches = new WeakMap<HTMLImageElement, boolean>();

function isMacbookMockup(image: HTMLImageElement): boolean {
  const cached = viewportMatches.get(image);
  if (cached !== undefined) return cached;
  let matched = false;
  if (image.naturalWidth === 1600 && image.naturalHeight === 1200) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 5;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        const points = [[330, 400], [1260, 400], [800, 190], [200, 400], [800, 400]] as const;
        points.forEach(([x, y], index) => context.drawImage(image, x, y, 1, 1, index, 0, 1, 1));
        const pixels = context.getImageData(0, 0, 5, 1).data;
        const brightness = (index: number): number => (pixels[index * 4] + pixels[index * 4 + 1] + pixels[index * 4 + 2]) / 3;
        matched = brightness(0) < 90 && brightness(1) < 90 && brightness(2) < 90 && brightness(3) > 180 && brightness(4) > 150;
      }
    } catch {
      // An unreadable cross-origin image keeps the ordinary background behavior.
    }
  }
  viewportMatches.set(image, matched);
  return matched;
}

export function getMockupViewport(
  settings: BackdropSettings,
  images: BackdropImages,
  size: Readonly<{ height: number; width: number }>,
): MockupViewport | null {
  if (settings.mode !== "mockup") return null;
  const image = images.get(settings.mockup);
  if (!image || !isMacbookMockup(image)) return null;
  const fit = Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight);
  const x = (size.width - image.naturalWidth * fit) / 2;
  const y = (size.height - image.naturalHeight * fit) / 2;
  return {
    x: x + MACBOOK_DISPLAY.x * fit,
    y: y + MACBOOK_DISPLAY.y * fit,
    width: MACBOOK_DISPLAY.width * fit,
    height: MACBOOK_DISPLAY.height * fit,
    topBleed: MACBOOK_DISPLAY_TOP_BLEED * fit,
  };
}

export async function loadBackdropImages(sources: readonly string[]): Promise<BackdropImages> {
  const entries = await Promise.all(
    sources.map(
      (source) =>
        new Promise<[string, HTMLImageElement] | null>((resolve) => {
          const image = new Image();
          image.onload = () => resolve([source, image]);
          image.onerror = () => resolve(null);
          image.src = source;
        }),
    ),
  );
  return new Map(entries.flatMap((entry) => (entry ? [entry] : [])));
}

function drawSticky(
  context: CanvasRenderingContext2D,
  sticky: StickySettings,
  side: "bottom" | "top",
  images: BackdropImages,
  size: Readonly<{ height: number; width: number }>,
  scale: number,
): void {
  const pad = SIDE_PADDING * scale;
  const edge = sticky.offset * scale;
  const anchor = (width: number): number =>
    sticky.align === "left" ? pad : sticky.align === "right" ? size.width - pad - width : (size.width - width) / 2;
  if (sticky.type === "image") {
    const image = images.get(sticky.image);
    if (!image || image.naturalHeight === 0) return;
    const height = ((IMAGE_BASE_HEIGHT * sticky.imageSize) / 100) * scale;
    const width = (image.naturalWidth / image.naturalHeight) * height;
    context.drawImage(image, anchor(width), side === "top" ? edge : size.height - edge - height, width, height);
  } else if (sticky.type === "text" && sticky.text.trim() !== "") {
    context.save();
    context.font = `600 ${sticky.textSize * scale}px Inter, "Helvetica Neue", Arial, sans-serif`;
    context.fillStyle = sticky.textColor;
    context.textBaseline = side === "top" ? "top" : "bottom";
    const width = context.measureText(sticky.text).width;
    context.textAlign = "left";
    context.fillText(sticky.text, anchor(width), side === "top" ? edge : size.height - edge);
    context.restore();
  }
}

// The design's own background (its lowest layer that covers the whole picture: a colour or a linear gradient), used as the artboard's
// background in the "Design background" mode, so it fills the artboard where the design does not reach.
export type DesignBackground = Readonly<{ stops: readonly Readonly<{ alpha: number; color: string; position: number }>[]; transform: readonly (readonly number[])[] | null }>;

type DesignLike = Readonly<{ blocks?: readonly Readonly<{ height: number; items: readonly Readonly<Record<string, unknown>>[]; width: number }>[] }> | undefined;

export function readDesignBackground(design: DesignLike): DesignBackground | null {
  const block = design?.blocks?.[0];
  if (!block) return null;
  for (let index = block.items.length - 1; index >= 0; index -= 1) {
    const item = block.items[index];
    if (!item || item.kind !== "shape" || Number(item.x) !== 0 || Number(item.y) !== 0 || Number(item.w) < block.width || Number(item.h) < block.height) continue;
    const fill = Array.isArray(item.fills) ? (item.fills[0] as Record<string, unknown> | undefined) : undefined;
    if (!fill) continue;
    if (fill.type === "SOLID" && typeof fill.color === "string") return { stops: [{ alpha: 1, color: fill.color, position: 0 }], transform: null };
    if (fill.type === "GRADIENT_LINEAR" && Array.isArray(fill.stops)) {
      return { stops: (fill.stops as DesignBackground["stops"]).map((stop) => ({ alpha: stop.alpha ?? 1, color: stop.color, position: stop.position })), transform: Array.isArray(fill.transform) ? (fill.transform as number[][]) : null };
    }
  }
  return null;
}

const withAlpha = (hex: string, alpha: number): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match || alpha >= 1) return hex;
  const n = Number.parseInt(match[1] ?? "000000", 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Draws the mockup picture onto the artboard, under the design. `size` is the artboard in canvas pixels.
export function drawMockup(
  context: CanvasRenderingContext2D,
  settings: BackdropSettings,
  images: BackdropImages,
  size: Readonly<{ height: number; width: number }>,
  designBackground?: DesignBackground | null,
): void {
  if (settings.mode === "design" && designBackground) {
    // The gradient runs across the whole artboard the way it runs across the design (Figma's gradient transform, in 0..1 of the box).
    const [row] = designBackground.transform ?? [[1, 0, 0]];
    const a = row?.[0] ?? 1;
    const b = row?.[1] ?? 0;
    const c = row?.[2] ?? 0;
    const length = a * a + b * b || 1;
    const x0 = (-c * a) / length;
    const y0 = (-c * b) / length;
    const gradient = context.createLinearGradient(x0 * size.width, y0 * size.height, (x0 + a / length) * size.width, (y0 + b / length) * size.height);
    for (const stop of designBackground.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.position)), withAlpha(stop.color, stop.alpha));
    context.fillStyle = designBackground.stops.length > 1 ? gradient : withAlpha(designBackground.stops[0]?.color ?? "#ffffff", designBackground.stops[0]?.alpha ?? 1);
    context.fillRect(0, 0, size.width, size.height);
    return;
  }
  if (settings.mode === "fill" && settings.fill.gradient) {
    // CSS angles: 180 runs top to bottom, 90 left to right; the line is as long as the artboard is along that direction.
    const radians = (settings.fill.angle * Math.PI) / 180;
    const dx = Math.sin(radians);
    const dy = -Math.cos(radians);
    const half = (Math.abs(size.width * dx) + Math.abs(size.height * dy)) / 2;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const gradient = context.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    gradient.addColorStop(0, settings.fill.from);
    gradient.addColorStop(1, settings.fill.to);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size.width, size.height);
    return;
  }
  if (settings.mode !== "mockup") return;
  const image = images.get(settings.mockup);
  if (image && image.naturalWidth > 0) {
    // Cover: fills the artboard, cropping the overflow.
    const fit = Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight);
    const width = image.naturalWidth * fit;
    const height = image.naturalHeight * fit;
    context.drawImage(image, (size.width - width) / 2, (size.height - height) / 2, width, height);
  }
}

// Draws the top and bottom sticky items onto the artboard, over the design, so no ratio hides them.
// `scale` is the pixels per design unit.
export function drawStickies(
  context: CanvasRenderingContext2D,
  settings: BackdropSettings,
  images: BackdropImages,
  size: Readonly<{ height: number; width: number }>,
  scale: number,
): void {
  drawSticky(context, settings.top, "top", images, size, scale);
  drawSticky(context, settings.bottom, "bottom", images, size, scale);
}

// The ratios the sticky items can be limited to: the framework's presets, the design's original size
// and any other size.
export const RATIO_KEYS = ["original", "1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16", "custom"] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];
export const RATIO_LABELS: Readonly<Record<RatioKey, string>> = {
  "1:1": "1:1",
  "16:9": "16:9",
  "2:3": "2:3",
  "3:2": "3:2",
  "3:4": "3:4",
  "4:3": "4:3",
  "9:16": "9:16",
  custom: "Custom",
  original: "Original",
};

// Which ratio the artboard is at now: a preset, the design's original size, or custom.
export function getRatioKey(
  values: Readonly<Record<string, unknown>>,
  size: Readonly<{ height: number; width: number }>,
  originalSize: Readonly<{ height: number; width: number }> | undefined,
): RatioKey {
  if (originalSize && originalSize.width === size.width && originalSize.height === size.height) return "original";
  const aspect = values["canvas.aspectRatio"];
  if (typeof aspect === "object" && aspect !== null) {
    const { mode, value } = aspect as { mode?: unknown; value?: unknown };
    if (mode === "preset" && typeof value === "string" && (RATIO_KEYS as readonly string[]).includes(value)) return value as RatioKey;
  }
  return "custom";
}

// Sticky items show on every ratio unless the user has switched some off.
export function areStickiesShown(
  values: Readonly<Record<string, unknown>>,
  size: Readonly<{ height: number; width: number }>,
  originalSize: Readonly<{ height: number; width: number }> | undefined,
): boolean {
  const stored = values[STICKY_RATIOS_TARGET];
  if (!Array.isArray(stored)) return true;
  return stored.includes(getRatioKey(values, size, originalSize));
}
