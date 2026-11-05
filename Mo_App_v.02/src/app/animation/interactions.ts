// Interaction kit items: small animated icons (cursor, touch, drag, move, pinch, resize, typing, loading)
// placed on the timeline over the design. An item follows the animation's own cursor motion (the
// default, so it takes the cursor's motion) or sits at a position you set when the design has no cursor. They are stored in control values, so they travel in project
// files, and they are drawn by the same code for the live canvas and for Render.
export type InteractionType = "cursor" | "drag" | "loading" | "move" | "pinch" | "resize" | "tap" | "typing";
export type InteractionDevice = "desktop" | "phone" | "tablet";
export type LoadingStyle = "bar" | "dots" | "spinner";
export type PinchDirection = "in" | "out";

export type InteractionItem = Readonly<{
  color: string;
  device: InteractionDevice;
  direction: PinchDirection;
  duration: number;
  // Seconds the item stays on its last moment after its duration (it is still shown, then the next one takes over).
  hold: number;
  id: string;
  // Linked to the item above it in the list: it moves when that one gets longer, shorter or is removed.
  linked: boolean;
  loading: LoadingStyle;
  size: number;
  start: number;
  text: string;
  toX: number;
  toY: number;
  type: InteractionType;
  x: number;
  y: number;
}>;

export type InteractionsValue = Readonly<{ items: readonly InteractionItem[]; seeded: boolean; selected: string | null }>;

export const INTERACTIONS_ENABLED_TARGET = "interactions.enabled";
export const INTERACTIONS_LIST_TARGET = "interactions.list";
export const EMPTY_INTERACTIONS: InteractionsValue = { items: [], seeded: false, selected: null };

export const INTERACTION_LABELS: Readonly<Record<InteractionType, string>> = {
  cursor: "Cursor",
  drag: "Drag",
  loading: "Loading",
  move: "Move",
  pinch: "Pinch zoom",
  resize: "Resize",
  tap: "Tap",
  typing: "Typing",
};
export const INTERACTION_TYPES = Object.keys(INTERACTION_LABELS) as InteractionType[];

// Which settings each type uses.
export const TYPE_HAS_END: Readonly<Record<InteractionType, boolean>> = {
  cursor: true, drag: true, loading: false, move: true, pinch: false, resize: true, tap: false, typing: false,
};
export const TYPE_HAS_DEVICE: Readonly<Record<InteractionType, boolean>> = {
  cursor: true, drag: true, loading: false, move: true, pinch: false, resize: false, tap: true, typing: false,
};

let counter = 0;
export function createInteraction(type: InteractionType, overrides: Partial<InteractionItem> = {}): InteractionItem {
  counter += 1;
  return {
    color: "#111111",
    device: "desktop",
    direction: "out",
    duration: 1.5,
    hold: 0,
    id: `it-${Date.now().toString(36)}-${counter}`,
    linked: true,
    loading: "spinner",
    size: 56,
    start: 0,
    text: "Hello Mo_App",
    toX: 60,
    toY: 60,
    type,
    x: 40,
    y: 40,
    ...overrides,
  };
}

const TYPES = new Set<string>(INTERACTION_TYPES);
const num = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

export function readInteractionsValue(value: unknown): InteractionsValue {
  if (typeof value !== "object" || value === null) return EMPTY_INTERACTIONS;
  const record = value as { items?: unknown; seeded?: unknown; selected?: unknown };
  const items: InteractionItem[] = [];
  if (Array.isArray(record.items)) {
    for (const raw of record.items) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as Record<string, unknown>;
      const type = str(item.type, "");
      if (!TYPES.has(type) || typeof item.id !== "string") continue;
      const base = createInteraction(type as InteractionType, { id: item.id });
      items.push({
        color: /^#[0-9a-f]{6}$/i.test(str(item.color, "")) ? str(item.color, base.color) : base.color,
        device: (["desktop", "phone", "tablet"] as const).includes(item.device as InteractionDevice) ? (item.device as InteractionDevice) : base.device,
        direction: item.direction === "in" ? "in" : "out",
        duration: Math.max(0.1, num(item.duration, base.duration)),
        hold: Math.max(0, num(item.hold, base.hold)),
        id: item.id,
        linked: item.linked !== false,
        loading: (["bar", "dots", "spinner"] as const).includes(item.loading as LoadingStyle) ? (item.loading as LoadingStyle) : base.loading,
        size: Math.max(8, num(item.size, base.size)),
        start: Math.max(0, num(item.start, base.start)),
        text: str(item.text, base.text),
        toX: num(item.toX, base.toX),
        toY: num(item.toY, base.toY),
        type: type as InteractionType,
        x: num(item.x, base.x),
        y: num(item.y, base.y),
      });
    }
  }
  return { items, seeded: record.seeded === true, selected: typeof record.selected === "string" ? record.selected : null };
}

export function readInteractions(values: Readonly<Record<string, unknown>>): readonly InteractionItem[] {
  if (values[INTERACTIONS_ENABLED_TARGET] !== true) return [];
  return readInteractionsValue(values[INTERACTIONS_LIST_TARGET]).items;
}

// The layer that carries the animation's cursor, found by name; designs without one have nothing to follow.
export function getCursorLayerId(layers: readonly Readonly<{ id: string; name: string }>[]): string | null {
  return layers.find((layer) => /cursor/i.test(layer.id) || /cursor/i.test(layer.name))?.id ?? null;
}

// Whether the kit is on. While it is, the animation's own cursor is not drawn: the kit icons take its motion.
export function isInteractionsOn(values: Readonly<Record<string, unknown>>): boolean {
  return values[INTERACTIONS_ENABLED_TARGET] === true;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// When an item is over: its duration plus its hold.
export function interactionEnd(item: InteractionItem): number {
  return item.start + item.duration + item.hold;
}

// Moves the items linked below `index` (the chain stops at the first unlinked item) by `shift` seconds.
function shiftChain(items: InteractionItem[], index: number, shift: number): InteractionItem[] {
  if (shift === 0) return items;
  for (let next = index + 1; next < items.length; next += 1) {
    const item = items[next];
    if (!item?.linked) break;
    items[next] = { ...item, start: Math.max(0, Math.round((item.start + shift) * 1000) / 1000) };
  }
  return items;
}

// Items with the same start, duration and hold (as the list shows them, to 0.1 s) play together on the same point
// and are listed as one row.
export function sameTiming(a: InteractionItem, b: InteractionItem): boolean {
  const shown = (item: InteractionItem): string => [item.start, item.duration, item.hold].map((value) => value.toFixed(1)).join("|");
  return shown(a) === shown(b);
}

// Keeps items that play together next to each other in the list (an item that now matches an earlier row moves
// up beside it, linked), so each list row is one run of neighbours.
export function gatherTogether(items: readonly InteractionItem[]): InteractionItem[] {
  const list: InteractionItem[] = [];
  for (const item of items) {
    let at = -1;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const other = list[index];
      if (other && sameTiming(other, item)) {
        at = index;
        break;
      }
    }
    if (at < 0 || at === list.length - 1) list.push(item);
    else list.splice(at + 1, 0, { ...item, linked: true });
  }
  return list;
}

// Changes one item, or every item of one row; when the duration or hold changes, the items linked below move by
// the same amount, so they keep their spacing. An unlinked item (and everything after it) stays where it is.
export function patchInteraction(items: readonly InteractionItem[], id: string | readonly string[], changes: Partial<InteractionItem>): InteractionItem[] {
  const ids = typeof id === "string" ? [id] : id;
  const indexes = items.flatMap((item, index) => (ids.includes(item.id) ? [index] : []));
  const target = items[indexes[0] ?? -1];
  const last = indexes[indexes.length - 1] ?? -1;
  if (!target) return [...items];
  const shift = changes.duration !== undefined || changes.hold !== undefined ? interactionEnd({ ...target, ...changes }) - interactionEnd(target) : 0;
  const list = items.map((item) => (ids.includes(item.id) ? { ...item, ...changes } : item));
  return gatherTogether(shiftChain(list, last, shift));
}

// Removes one item; the items linked below it move up so the first of them starts where the removed one started.
export function removeInteraction(items: readonly InteractionItem[], id: string): InteractionItem[] {
  const index = items.findIndex((item) => item.id === id);
  const removed = items[index];
  if (!removed) return [...items];
  const list = [...items];
  const after = list[index + 1];
  if (after?.linked) shiftChain(list, index, removed.start - after.start);
  list.splice(index, 1);
  return list;
}

const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const lerp = (from: number, to: number, p: number): number => from + (to - from) * p;

type Ctx = CanvasRenderingContext2D;

// `scale` shrinks the arrow about its tip (1 = normal size).
function arrowCursor(ctx: Ctx, x: number, y: number, s: number, color: string, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, s * 0.98);
  ctx.lineTo(s * 0.25, s * 0.76);
  ctx.lineTo(s * 0.42, s * 1.16);
  ctx.lineTo(s * 0.57, s * 1.1);
  ctx.lineTo(s * 0.41, s * 0.72);
  ctx.lineTo(s * 0.72, s * 0.72);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();
  ctx.restore();
}

// A closed (grabbing) hand, the desktop cursor while dragging. (x, y) is the top-left of its drawing box; the
// same shape is drawn by animations that carry their own cursor, so the Reactor's hand lands exactly on theirs.
export const GRAB_HAND_MIN = { x: 0.015, y: 0.185 }; // its painted top-left, in sizes, before the outline
export const GRAB_HAND_ANCHOR = { x: 0.4, y: 0.42 }; // the point it holds, in sizes
function grabHand(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  const lw = Math.max(1.5, s * 0.07);
  const shapes = (): void => {
    ctx.beginPath();
    ctx.roundRect(x + 0.1 * s, y + 0.26 * s, 0.62 * s, 0.46 * s, 0.16 * s);
    for (const kx of [0.2, 0.355, 0.51, 0.64]) {
      ctx.moveTo(x + (kx + 0.085) * s, y + 0.27 * s);
      ctx.arc(x + kx * s, y + 0.27 * s, 0.085 * s, 0, Math.PI * 2);
    }
    ctx.moveTo(x + 0.185 * s, y + 0.46 * s);
    ctx.ellipse(x + 0.1 * s, y + 0.46 * s, 0.085 * s, 0.14 * s, 0, 0, Math.PI * 2);
  };
  ctx.save();
  ctx.lineJoin = "round";
  shapes();
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill("nonzero");
  ctx.lineCap = "round";
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  for (const gx of [0.2775, 0.4325, 0.575]) {
    ctx.moveTo(x + gx * s, y + 0.23 * s);
    ctx.lineTo(x + gx * s, y + 0.36 * s);
  }
  ctx.stroke();
  ctx.restore();
}

// The hand with its held point at (x, y), or (following an animation's cursor) with its painted top-left there.
export const GRAB_HAND_SCALE = 1.35; // the hand is drawn a little larger than the arrow of the same size
// `press` shrinks the hand about the point it holds (1 = normal size).
function dragHand(ctx: Ctx, x: number, y: number, size: number, color: string, fromTopLeft: boolean, press = 1): void {
  const s = size * GRAB_HAND_SCALE;
  const lw = Math.max(1.5, s * 0.07);
  const left = fromTopLeft ? x - GRAB_HAND_MIN.x * s + lw : x - GRAB_HAND_ANCHOR.x * s;
  const top = fromTopLeft ? y - GRAB_HAND_MIN.y * s + lw : y - GRAB_HAND_ANCHOR.y * s;
  const holdX = left + GRAB_HAND_ANCHOR.x * s;
  const holdY = top + GRAB_HAND_ANCHOR.y * s;
  ctx.save();
  ctx.translate(holdX, holdY);
  ctx.scale(press, press);
  ctx.translate(-holdX, -holdY);
  grabHand(ctx, left, top, s, color);
  ctx.restore();
}

// Press feedback: a quick dip in size and back. A tap dips more than the start of a drag.
const bump = (u: number): number => (u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0);
const TAP_PRESS = 0.16;
const DRAG_PRESS = 0.07;
const DRAG_PRESS_SECONDS = 0.3;

function touchDot(ctx: Ctx, x: number, y: number, s: number, color: string, pressed: boolean): void {
  const radius = s * (pressed ? 0.42 : 0.34);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.globalAlpha *= pressed ? 0.55 : 0.4;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = Math.min(1, ctx.globalAlpha * 2);
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function ripple(ctx: Ctx, x: number, y: number, s: number, color: string, p: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, s * lerp(0.25, 1.1, p), 0, Math.PI * 2);
  ctx.globalAlpha *= 1 - p;
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function arrowHead(ctx: Ctx, x: number, y: number, angle: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.7);
  ctx.lineTo(-size * 0.6, -size * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function fourWay(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.lineCap = "round";
  const reach = s * 0.55;
  for (let index = 0; index < 4; index += 1) {
    const angle = (index * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * reach * 0.8, y + Math.sin(angle) * reach * 0.8);
    ctx.stroke();
    arrowHead(ctx, x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, angle, s * 0.14);
  }
  ctx.restore();
}

function resizeHandle(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.lineCap = "round";
  const reach = s * 0.5;
  const d = reach / Math.SQRT2;
  ctx.beginPath();
  ctx.moveTo(x - d, y - d);
  ctx.lineTo(x + d, y + d);
  ctx.stroke();
  arrowHead(ctx, x + d, y + d, Math.PI / 4, s * 0.14);
  arrowHead(ctx, x - d, y - d, Math.PI / 4 + Math.PI, s * 0.14);
  ctx.restore();
}

function spinner(ctx: Ctx, x: number, y: number, s: number, color: string, t: number): void {
  ctx.save();
  ctx.lineWidth = Math.max(3, s * 0.12);
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.globalAlpha *= 0.2;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha *= 5;
  const angle = t * Math.PI * 2 * 1.1;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.4, angle, angle + Math.PI * 1.35);
  ctx.stroke();
  ctx.restore();
}

function dots(ctx: Ctx, x: number, y: number, s: number, color: string, t: number): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let index = 0; index < 3; index += 1) {
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.4 - index * 0.9);
    ctx.globalAlpha *= 1;
    ctx.beginPath();
    ctx.arc(x + (index - 1) * s * 0.3, y, s * (0.07 + 0.06 * pulse), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function pointer(ctx: Ctx, device: InteractionDevice, x: number, y: number, s: number, color: string, pressed: boolean, scale = pressed ? 0.88 : 1): void {
  if (device === "desktop") arrowCursor(ctx, x, y, s, color, scale);
  else touchDot(ctx, x, y, device === "tablet" ? s * 1.2 : s, color, pressed);
}

function progressBar(ctx: Ctx, x: number, y: number, s: number, color: string, p: number): void {
  const width = s * 1.6;
  const height = Math.max(6, s * 0.14);
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha *= 0.2;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.globalAlpha *= 5;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, Math.max(height, width * p), height, height / 2);
  ctx.fill();
  ctx.restore();
}

function typingBox(ctx: Ctx, item: InteractionItem, x: number, y: number, s: number, p: number, t: number): void {
  const fontSize = s * 0.7;
  ctx.save();
  ctx.font = `500 ${fontSize}px Inter, "Helvetica Neue", Arial, sans-serif`;
  const shown = item.text.slice(0, Math.floor(p * item.text.length + 0.0001));
  const full = ctx.measureText(item.text).width;
  const boxWidth = full + s * 0.9;
  const boxHeight = s * 1.3;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.strokeStyle = "rgba(17,17,17,0.18)";
  ctx.lineWidth = Math.max(1.5, s * 0.03);
  ctx.beginPath();
  ctx.roundRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, s * 0.22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = item.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const left = x - boxWidth / 2 + s * 0.45;
  ctx.fillText(shown, left, y);
  if (Math.floor(t * 2) % 2 === 0) {
    const caretX = left + ctx.measureText(shown).width + s * 0.04;
    ctx.fillRect(caretX, y - fontSize * 0.55, Math.max(2, s * 0.04), fontSize * 1.1);
  }
  ctx.restore();
}

// Items drawn as the pointer itself. Higher wins when two start together (within TOGETHER seconds, the list's rounding).
const TOGETHER = 0.06;
const POINTER_RANK: Partial<Record<InteractionType, number>> = { cursor: 1, drag: 3, tap: 2 };

// Until when an item is shown: its duration and hold, cut short where a later pointer item takes over (so two
// overlapping pointer items never show at once).
function shownEnd(item: InteractionItem, items: readonly InteractionItem[]): number {
  let end = interactionEnd(item);
  if (POINTER_RANK[item.type] === undefined) return end;
  for (const other of items) {
    if (other !== item && POINTER_RANK[other.type] !== undefined && other.start > item.start + TOGETHER && other.start < end) end = other.start;
  }
  return end;
}

// Whether a pointer (cursor, tap or drag) is on screen at `time`: the next scene's pointer then carries on from it instead of fading in.
export function isPointerShownAt(items: readonly InteractionItem[], time: number): boolean {
  return items.some((item) => POINTER_RANK[item.type] !== undefined && time >= item.start && time <= shownEnd(item, items));
}

// Draws every item that is on screen at `time`. `width` and `height` are the artboard in canvas pixels,
// `scale` the pixels per design unit, and `cursor` where the animation's cursor is now (canvas pixels).
// Items use the cursor point when there is one; otherwise X / Y are percentages of the artboard.
export function drawInteractions(
  ctx: Ctx,
  items: readonly InteractionItem[],
  time: number,
  width: number,
  height: number,
  scale: number,
  cursor: Readonly<{ x: number; y: number }> | null,
  // `carriesOn`: the scene before this one ended with a pointer on screen, so a pointer starting at 0 appears at once.
  // `leadsOnAt`: the scene ends at that time and the next one starts with a pointer, so a pointer reaching the end never fades out.
  // `place`: where a point given in percent of the design lands on the canvas (the design is laid on the artboard by the frame, so at another
  // artboard ratio it is not the whole canvas); without it the percent is of the canvas.
  options: Readonly<{ carriesOn?: boolean; leadsOnAt?: number; place?: (xPercent: number, yPercent: number) => { x: number; y: number } }> = {},
): void {
  for (const item of items) {
    const until = shownEnd(item, items);
    const cut = until < interactionEnd(item) - 0.001;
    // At the moment a later item takes over, only that one is drawn.
    if (time < item.start || time > until || (cut && time >= until)) continue;
    // Pointer items starting together (Cursor & Tap) sit on the same point: only the strongest draws.
    const rank = POINTER_RANK[item.type];
    if (
      rank !== undefined &&
      items.some((other, index) => {
        const otherRank = POINTER_RANK[other.type];
        if (other === item || otherRank === undefined || Math.abs(other.start - item.start) > TOGETHER || time > shownEnd(other, items)) return false;
        return otherRank > rank || (otherRank === rank && index < items.indexOf(item));
      })
    ) {
      continue;
    }
    const raw = (time - item.start) / item.duration;
    // Items take the animation's cursor motion; a design with no cursor uses the item's own position.
    const following = cursor !== null;
    const p = clamp01(raw);
    // An item that takes over from another (or hands over to one, also when they overlap) does not fade there,
    // so a cursor running through several items in a row never blinks or shows twice.
    const handIn = items.some((other) => other !== item && Math.abs(shownEnd(other, items) - item.start) < 0.05);
    const handOut =
      cut ||
      items.some((other) => other !== item && Math.abs(other.start - until) < 0.05) ||
      (options.leadsOnAt !== undefined && POINTER_RANK[item.type] !== undefined && until >= options.leadsOnAt - 0.05);
    const fadeOut = clamp01((time - item.start) / Math.max(0.001, until - item.start));
    const carried = options.carriesOn === true && item.start <= 0.001 && POINTER_RANK[item.type] !== undefined;
    // A short pointer carried over from the scene before (at most 0.6 s) is one that leaves: it fades out smoothly over its whole time,
    // as when a zoom starts.
    const leaving = carried && until - item.start <= 0.6;
    const leave = leaving ? 1 - fadeOut * fadeOut * (3 - 2 * fadeOut) : (1 - fadeOut) / 0.12;
    const fade = Math.min(1, handIn || carried ? 1 : p / 0.12, handOut ? 1 : leave);
    const s = item.size * scale;
    const place = (xPercent: number, yPercent: number): { x: number; y: number } => (options.place ? options.place(xPercent, yPercent) : { x: (xPercent / 100) * width, y: (yPercent / 100) * height });
    const from = following ? cursor : place(item.x, item.y);
    const to = following ? cursor : place(item.toX, item.toY);
    const fromX = from.x;
    const fromY = from.y;
    const toX = to.x;
    const toY = to.y;
    const travel = ease(p);
    const x = lerp(fromX, toX, travel);
    const y = lerp(fromY, toY, travel);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    switch (item.type) {
      case "cursor":
        pointer(ctx, item.device, x, y, s, item.color, false);
        break;
      case "tap":
        // The arrow dips and springs back as it taps (a smooth pulse), in time with the ripple.
        pointer(ctx, item.device, fromX, fromY, s, item.color, p > 0.25 && p < 0.7, 1 - TAP_PRESS * bump((p - 0.15) / 0.5));
        if (p > 0.25) ripple(ctx, fromX, fromY, s, item.color, clamp01((p - 0.25) / 0.75));
        break;
      case "drag":
        if (!following) {
          ctx.save();
          ctx.globalAlpha *= 0.35;
          ctx.strokeStyle = item.color;
          ctx.lineWidth = Math.max(2, s * 0.08);
          ctx.lineCap = "round";
          ctx.setLineDash([s * 0.14, s * 0.2]);
          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.restore();
        }
        // Dragging on a desktop shows a grabbing hand instead of the arrow.
        // As it takes hold, the hand dips very slightly and springs back.
        if (item.device === "desktop") dragHand(ctx, x, y, s, item.color, following, 1 - DRAG_PRESS * bump((time - item.start) / DRAG_PRESS_SECONDS));
        else pointer(ctx, item.device, x, y, s, item.color, true);
        break;
      case "move":
        fourWay(ctx, x, y, s, item.color);
        break;
      case "pinch": {
        const gap = lerp(item.direction === "out" ? 0.35 : 1.15, item.direction === "out" ? 1.15 : 0.35, travel) * s * 0.5;
        const dx = Math.cos(Math.PI / 4) * gap;
        const dy = Math.sin(Math.PI / 4) * gap;
        touchDot(ctx, fromX - dx, fromY - dy, s * 0.8, item.color, true);
        touchDot(ctx, fromX + dx, fromY + dy, s * 0.8, item.color, true);
        ctx.save();
        ctx.strokeStyle = item.color;
        ctx.globalAlpha *= 0.5;
        ctx.lineWidth = Math.max(2, s * 0.05);
        ctx.setLineDash([s * 0.1, s * 0.12]);
        ctx.beginPath();
        ctx.moveTo(fromX - dx, fromY - dy);
        ctx.lineTo(fromX + dx, fromY + dy);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "resize":
        resizeHandle(ctx, x, y, s, item.color);
        break;
      case "typing":
        typingBox(ctx, item, fromX, fromY, s, ease(p), time);
        break;
      case "loading":
        if (item.loading === "dots") dots(ctx, fromX, fromY, s, item.color, time);
        else if (item.loading === "bar") progressBar(ctx, fromX, fromY, s, item.color, p);
        else spinner(ctx, fromX, fromY, s, item.color, time);
        break;
    }
    ctx.restore();
  }
}

// Where a point of the animation's picture lands on the canvas, given the frame's placement.
export function mapDesignPoint(
  point: Readonly<{ x: number; y: number }>,
  renderSize: Readonly<{ height: number; width: number }>,
  transform: Readonly<{ rotation: number; scale: number; x: number; y: number }>,
  canvas: Readonly<{ height: number; width: number }>,
  pixelsPerUnit: number,
): { x: number; y: number } {
  const dx = (point.x - renderSize.width / 2) * pixelsPerUnit;
  const dy = (point.y - renderSize.height / 2) * pixelsPerUnit;
  const k = transform.scale / 100;
  const a = (transform.rotation * Math.PI) / 180;
  return {
    x: canvas.width / 2 + transform.x * pixelsPerUnit + k * (dx * Math.cos(a) - dy * Math.sin(a)),
    y: canvas.height / 2 + transform.y * pixelsPerUnit + k * (dx * Math.sin(a) + dy * Math.cos(a)),
  };
}
