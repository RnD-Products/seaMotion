import type { AnimationSpec } from "./animation-spec";
import type { CameraArea, CameraPose, SceneCamera } from "./camera";
import { placedGroupBox, type LayerLike } from "./group-box";
import { readGroupStyles } from "./group-style";

// The camera works on the design's layer named "Camera" (a group): that group's box is the frame the camera zooms inside, and
// the focus points are measured inside that box (0% is its left or top edge, 100% its right or bottom edge). A project without a
// "Camera" group keeps the camera's own frame and focus in percent of the picture.
export function findCameraGroup(layers: readonly LayerLike[]): LayerLike | null {
  return layers.find((layer) => layer.kind === "group" && /^camera$/i.test((layer.displayName ?? layer.name ?? "").trim())) ?? null;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// The frame the camera works in: the Camera group's box in percent of the picture, and the corner radius (design units) of
// the group or of the nearest group around it that clips (a design's Container), so the camera's window has the same corners.
export type GroupArea = Omit<CameraArea, "radius" | "radii"> & Readonly<{ radii: readonly [number, number, number, number]; radius: number; radiusGroup: string | null }>;

function clipRadius(layers: readonly LayerLike[], groupId: string, params: Readonly<Record<string, unknown>>): Readonly<{ group: string | null; radii: readonly [number, number, number, number]; radius: number }> {
  const styles = readGroupStyles(params);
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const seen = new Set<string>();
  for (let layer = byId.get(groupId); layer && !seen.has(layer.id); layer = layer.parentGroupId ? byId.get(layer.parentGroupId) : undefined) {
    seen.add(layer.id);
    const style = styles[layer.id];
    if (style?.clip) return { group: layer.id, radii: [style.radius[0], style.radius[1], style.radius[2], style.radius[3]], radius: Math.max(...style.radius) };
  }
  return { group: null, radii: [0, 0, 0, 0], radius: 0 };
}

// The Camera group's frame, or null when there is no such group.
export function cameraGroupArea(
  spec: AnimationSpec | null,
  layers: readonly LayerLike[],
  params: Readonly<Record<string, unknown>>,
  picture: Readonly<{ height: number; width: number }>,
): GroupArea | null {
  if (!spec || !spec.design) return null;
  const group = findCameraGroup(layers);
  if (!group) return null;
  const box = placedGroupBox(spec, layers, group.id, params);
  if (!box || !(picture.width > 0) || !(picture.height > 0)) return null;
  const rounded = clipRadius(layers, group.id, params);
  const x = clamp((box.x / picture.width) * 100, 0, 95);
  const y = clamp((box.y / picture.height) * 100, 0, 95);
  return {
    height: clamp((box.h / picture.height) * 100, 5, 100 - y),
    radii: rounded.radii,
    radius: rounded.radius,
    radiusGroup: rounded.group,
    width: clamp((box.w / picture.width) * 100, 5, 100 - x),
    x,
    y,
  };
}

// The scene's camera with its frame taken from the Camera group, and every focus point turned from group percent into picture
// percent (what the drawing uses).
export function cameraOnGroup(camera: SceneCamera | undefined, area: GroupArea | null): SceneCamera | undefined {
  if (!camera || !area) return camera;
  const fx = (value: number): number => clamp(area.x + (value / 100) * area.width, 0, 100);
  const fy = (value: number): number => clamp(area.y + (value / 100) * area.height, 0, 100);
  const pose = (own: CameraPose): CameraPose => ({
    ...own,
    ...(own.focusX === undefined ? {} : { focusX: fx(own.focusX) }),
    ...(own.focusY === undefined ? {} : { focusY: fy(own.focusY) }),
  });
  return {
    ...camera,
    area: { height: area.height, ...(area.radius > 0 ? { radii: area.radii } : {}), radius: area.radius > 0 ? area.radius : (camera.area?.radius ?? 0), width: area.width, x: area.x, y: area.y },
    focusX: fx(camera.focusX),
    focusY: fy(camera.focusY),
    from: pose(camera.from),
    to: pose(camera.to),
  };
}
