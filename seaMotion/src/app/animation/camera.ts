// A scene's camera: a zoom onto a point with a small angle, moving from one pose to another while the scene plays (a push in, or a
// pull back out). The scene is drawn as usual, then the picture is placed in 3D (zoomed about the focus point, turned a little
// sideways and forward, with perspective) inside the frame: the frame never moves and the picture always covers it (it is moved a few
// pixels, never given less angle or zoom, when an edge would show).
export type CameraPose = Readonly<{
  // The point the camera looks at in this pose, in percent of the picture (the camera's own point when not set), so a move can also
  // pan from one place to another.
  focusX?: number;
  focusY?: number;
  // Tilt forward in degrees.
  pitch: number;
  // Turn about the vertical axis in degrees (negative: the right side comes towards the camera).
  yaw: number;
  zoom: number;
}>;

// A pose with its focus point settled.
export type CameraView = Readonly<{ focusX: number; focusY: number; pitch: number; yaw: number; zoom: number }>;

// The part of the picture the camera works inside (the frame of the design, for example its Container), in percent of the picture and
// the corner radius in design units; without it the camera works inside the whole picture.
export type CameraArea = Readonly<{ height: number; radius: number; radii?: readonly [number, number, number, number]; width: number; x: number; y: number }>;

export type SceneCamera = Readonly<{
  area?: CameraArea;
  // Seconds after the scene starts that the move starts, and how long it takes.
  delay: number;
  duration: number;
  // How the move speeds up and slows down: smooth (slow at both ends, the default) or linear (the same speed all the way).
  ease?: "linear" | "smooth";
  // The point the camera looks at, in percent of the picture.
  focusX: number;
  focusY: number;
  from: CameraPose;
  to: CameraPose;
  // The soft dark edge towards the corners of the window (on unless this is false).
  vignette?: boolean;
}>;

export const NO_POSE: CameraPose = Object.freeze({ pitch: 0, yaw: 0, zoom: 1 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readPose(value: unknown): CameraPose {
  const raw = isRecord(value) ? value : {};
  return {
    ...(typeof raw.focusX === "number" ? { focusX: num(raw.focusX, 50, 0, 100) } : {}),
    ...(typeof raw.focusY === "number" ? { focusY: num(raw.focusY, 50, 0, 100) } : {}),
    pitch: num(raw.pitch, 0, -45, 45),
    yaw: num(raw.yaw, 0, -45, 45),
    zoom: num(raw.zoom, 1, 1, 6),
  };
}

export function readCamera(value: unknown): SceneCamera | undefined {
  if (!isRecord(value)) return undefined;
  const area = isRecord(value.area)
    ? { height: num(value.area.height, 100, 5, 100), radius: num(value.area.radius, 0, 0, 400), width: num(value.area.width, 100, 5, 100), x: num(value.area.x, 0, 0, 95), y: num(value.area.y, 0, 0, 95) }
    : undefined;
  return {
    ...(area ? { area } : {}),
    delay: num(value.delay, 0, 0, 60),
    duration: num(value.duration, 1, 0.05, 60),
    ...(value.ease === "linear" ? { ease: "linear" as const } : {}),
    focusX: num(value.focusX, 50, 0, 100),
    focusY: num(value.focusY, 50, 0, 100),
    from: readPose(value.from),
    to: readPose(value.to),
    ...(value.vignette === false ? { vignette: false } : {}),
  };
}

const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// The camera's pose `seconds` after the scene started, or null when it looks straight at the whole picture (nothing to do).
export function poseAt(camera: SceneCamera | undefined, seconds: number): CameraView | null {
  if (!camera) return null;
  const progress = clamp01((seconds - camera.delay) / camera.duration);
  const e = camera.ease === "linear" ? progress : ease(progress);
  const pose = {
    focusX: lerp(camera.from.focusX ?? camera.focusX, camera.to.focusX ?? camera.focusX, e),
    focusY: lerp(camera.from.focusY ?? camera.focusY, camera.to.focusY ?? camera.focusY, e),
    pitch: lerp(camera.from.pitch, camera.to.pitch, e),
    yaw: lerp(camera.from.yaw, camera.to.yaw, e),
    // The zoom is mixed in log space, so a push in feels as even as the pan and the angle that move with it.
    zoom: Math.exp(lerp(Math.log(camera.from.zoom), Math.log(camera.to.zoom), e)),
  };
  const flat = Math.abs(pose.zoom - 1) < 0.004 && Math.abs(pose.yaw) < 0.05 && Math.abs(pose.pitch) < 0.05;
  // A camera with rounded corners keeps drawing through its window even when it looks straight at the picture: the window is
  // what rounds the corners, so they must not change when the camera moves in or out.
  if (flat && !(camera.area && camera.area.radius > 0)) return null;
  return pose;
}

type Point = readonly [number, number];

// Draws the source triangle `s` of `image` into the destination triangle `d` (an affine map).
function triangle(ctx: CanvasRenderingContext2D, image: CanvasImageSource, s: readonly [Point, Point, Point], d: readonly [Point, Point, Point]): void {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(den) < 1e-9) return;
  const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / den;
  const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / den;
  const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / den;
  const dd = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / den;
  const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
  const f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
  // The triangle is drawn a little larger so no seam shows between neighbours.
  const cx = (d0[0] + d1[0] + d2[0]) / 3;
  const cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p: Point): Point => [p[0] + (p[0] - cx) * 0.02, p[1] + (p[1] - cy) * 0.02];
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0[0], g0[1]);
  ctx.lineTo(g1[0], g1[1]);
  ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

export type CameraWindow = Readonly<{ height: number; radius: number; radii?: readonly [number, number, number, number]; vignette?: boolean; width: number; x: number; y: number }>;

// The window the camera works in: the camera's area inside the picture (`base`, the whole canvas when there is no better), or the picture.
export function cameraWindow(camera: SceneCamera, base: CameraWindow | null, canvas: Readonly<{ height: number; width: number }>, scale: number): CameraWindow | null {
  const picture = base ?? { height: canvas.height, radius: 0, width: canvas.width, x: 0, y: 0 };
  const vignette = camera.vignette !== false;
  if (!camera.area) return vignette ? base : { ...picture, vignette };
  return {
    height: (picture.height * camera.area.height) / 100,
    radius: camera.area.radius * scale,
    ...(camera.area.radii ? { radii: camera.area.radii.map((value) => value * scale) as [number, number, number, number] } : {}),
    vignette,
    width: (picture.width * camera.area.width) / 100,
    x: picture.x + (picture.width * camera.area.x) / 100,
    y: picture.y + (picture.height * camera.area.y) / 100,
  };
}

// Where a point of the picture lands: first the zoom about (pivotX, pivotY), which keeps the focus where it is, then the angle and
// tilt about the middle of the window, so the picture looks turned by the same amount wherever the camera looks.
function projector(
  distance: number,
  pivotX: number,
  pivotY: number,
  centerX: number,
  centerY: number,
  pose: CameraPose,
  zoom: number,
): (x: number, y: number) => Point {
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (pose.pitch * Math.PI) / 180;
  return (x, y) => {
    const vx = pivotX + (x - pivotX) * zoom - centerX;
    const vy = pivotY + (y - pivotY) * zoom - centerY;
    const x1 = vx * Math.cos(yaw);
    const z1 = -vx * Math.sin(yaw);
    const y2 = vy * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = vy * Math.sin(pitch) + z1 * Math.cos(pitch);
    const k = distance / (distance - z2);
    return [centerX + x1 * k, centerY + y2 * k];
  };
}

function corners(win: CameraWindow): readonly Point[] {
  return [[win.x, win.y], [win.x + win.width, win.y], [win.x + win.width, win.y + win.height], [win.x, win.y + win.height]];
}

// Whether the picture, seen like this, still covers the whole window (the frame never shows what is behind the picture).
function covers(quad: readonly Point[], win: CameraWindow): boolean {
  const sign = (a: Point, b: Point, p: Point): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return corners(win).every((point) => {
    const signs = quad.map((corner, index) => sign(corner, quad[(index + 1) % quad.length] as Point, point));
    return signs.every((value) => value >= 0) || signs.every((value) => value <= 0);
  });
}

// How far the picture has to be moved so that, turned like this, it still covers the whole window: nothing when it already does, a
// few pixels (away from the corner the camera looks at) when the angle would let its edge in. The angle is never given up and the zoom
// never changed for it, so the tilt looks the same wherever the camera looks.
function coverShift(win: CameraWindow, pivotX: number, pivotY: number, pose: CameraPose): Point {
  const project = projector(1.7 * win.width, pivotX, pivotY, win.x + win.width / 2, win.y + win.height / 2, pose, pose.zoom);
  const quad = corners(win).map(([x, y]) => project(x, y));
  const window = corners(win);
  let dx = 0;
  let dy = 0;
  for (let round = 0; round < 120; round += 1) {
    const moved = quad.map(([x, y]): Point => [x + dx, y + dy]);
    // The window corner that is furthest outside the picture, and the direction to move the picture to take it in.
    let worst = 0;
    let move: Point = [0, 0];
    for (const point of window) {
      for (let index = 0; index < moved.length; index += 1) {
        const a = moved[index] as Point;
        const b = moved[(index + 1) % moved.length] as Point;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // The quad's inside is on the same side of every edge as its centre.
        const centreX = moved.reduce((sum, corner) => sum + corner[0], 0) / moved.length;
        const centreY = moved.reduce((sum, corner) => sum + corner[1], 0) / moved.length;
        const side = (q: Point): number => ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / length;
        const inside = Math.sign(side([centreX, centreY])) || 1;
        const distance = -side(point) * inside;
        if (distance > worst) {
          worst = distance;
          // Away from the quad's centre across this edge: the normal pointing out of the quad.
          const normal: Point = [(-(b[1] - a[1]) / length) * inside * -1, ((b[0] - a[0]) / length) * inside * -1];
          move = [normal[0] * distance, normal[1] * distance];
        }
      }
    }
    if (worst <= 0.01) break;
    // The picture moves towards the point that is out.
    dx += move[0];
    dy += move[1];
  }
  return [dx, dy];
}

// The shift (in pixels) the camera needs for the whole picture; see coverShift.
export function coveringShift(width: number, height: number, focusX: number, focusY: number, pose: CameraPose): Point {
  return coverShift({ height, radius: 0, width, x: 0, y: 0 }, (focusX / 100) * width, (focusY / 100) * height, pose);
}

const CELLS_X = 14;
const CELLS_Y = 10;

// Draws the `source` picture (what is on the canvas) seen through the camera `pose` into the window (the frame; the whole canvas
// when none is given). The window stays where it is and what is outside it is not touched: the picture is zoomed about the focus
// point (percent of the canvas; it does not move), turned a little with perspective, and always covers the window.
function drawCameraWindow(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & Readonly<{ height: number; width: number }>,
  pose: CameraPose,
  focusX: number,
  focusY: number,
  window?: CameraWindow | null,
): void {
  const win: CameraWindow = window ?? { height: source.height, radius: 0, width: source.width, x: 0, y: 0 };
  // The camera looks at the focus point, kept inside the window.
  const pivotX = Math.min(win.x + win.width, Math.max(win.x, (focusX / 100) * source.width));
  const pivotY = Math.min(win.y + win.height, Math.max(win.y, (focusY / 100) * source.height));
  const [shiftX, shiftY] = coverShift(win, pivotX, pivotY, pose);
  const zoom = pose.zoom;
  const turned = projector(1.7 * win.width, pivotX, pivotY, win.x + win.width / 2, win.y + win.height / 2, pose, zoom);
  const project = (x: number, y: number): Point => {
    const at = turned(x, y);
    return [at[0] + shiftX, at[1] + shiftY];
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  if (win.radius > 0) ctx.roundRect(win.x, win.y, win.width, win.height, win.radii ? [...win.radii] : win.radius);
  else ctx.rect(win.x, win.y, win.width, win.height);
  ctx.clip();
  // The window shows the picture only: what was in it is replaced.
  ctx.clearRect(win.x, win.y, win.width, win.height);
  const cellWidth = win.width / CELLS_X;
  const cellHeight = win.height / CELLS_Y;
  for (let j = 0; j < CELLS_Y; j += 1) {
    for (let i = 0; i < CELLS_X; i += 1) {
      const x0 = win.x + i * cellWidth;
      const x1 = x0 + cellWidth;
      const y0 = win.y + j * cellHeight;
      const y1 = y0 + cellHeight;
      const p00 = project(x0, y0);
      const p10 = project(x1, y0);
      const p01 = project(x0, y1);
      const p11 = project(x1, y1);
      triangle(ctx, source, [[x0, y0], [x1, y0], [x0, y1]], [p00, p10, p01]);
      triangle(ctx, source, [[x1, y0], [x1, y1], [x0, y1]], [p10, p11, p01]);
    }
  }
  // A soft edge: a little darker towards the corners of the window, more the closer and the more turned the camera is.
  if (win.vignette === false) {
    ctx.restore();
    return;
  }
  const strength = clamp01((zoom - 1) / 1.4 + (Math.abs(pose.yaw) + Math.abs(pose.pitch)) / 24);
  if (strength <= 0.001) {
    ctx.restore();
    return;
  }
  const centerX = win.x + win.width / 2;
  const centerY = win.y + win.height / 2;
  const vignette = ctx.createRadialGradient(centerX, centerY, win.height * 0.3, centerX, centerY, win.height * 0.95);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, `rgba(0,0,0,${(0.04 + 0.2 * strength).toFixed(3)})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(win.x, win.y, win.width, win.height);
  ctx.restore();
}

// Draws the camera view (see drawCameraWindow). `behind` repaints what lies behind the picture (the artboard's background) into
// the four corner cut-outs of a window with rounded corners, so the corners show the artboard, not the picture's square corners.
export function drawCameraView(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & Readonly<{ height: number; width: number }>,
  pose: CameraPose,
  focusX: number,
  focusY: number,
  window?: CameraWindow | null,
  behind?: (ctx: CanvasRenderingContext2D) => void,
): void {
  drawCameraWindow(ctx, source, pose, focusX, focusY, window);
  const win: CameraWindow = window ?? { height: source.height, radius: 0, width: source.width, x: 0, y: 0 };
  if (!behind || !(win.radius > 0)) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(win.x, win.y, win.width, win.height);
  ctx.roundRect(win.x, win.y, win.width, win.height, win.radii ? [...win.radii] : win.radius);
  ctx.clip("evenodd");
  behind(ctx);
  ctx.restore();
}
