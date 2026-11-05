// Aligning a layer (or a group) to the edges or the centre of the design: left, right and centre set where it sits across, top,
// bottom and centre where it sits down. Kept as a setting (`__layerAlign`: layer id -> { h, v }); the drawing script moves the layer
// so that the box around what it draws touches that edge, picture after picture.
export const LAYER_ALIGN_KEY = "__layerAlign";

export type AlignH = "center" | "left" | "right";
export type AlignV = "bottom" | "middle" | "top";
export type LayerAlign = Readonly<{ h: AlignH | null; v: AlignV | null }>;

export const NO_ALIGN: LayerAlign = Object.freeze({ h: null, v: null });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function readLayerAlign(value: unknown): LayerAlign {
  if (!isRecord(value)) return NO_ALIGN;
  const h = value.h === "left" || value.h === "center" || value.h === "right" ? value.h : null;
  const v = value.v === "top" || value.v === "middle" || value.v === "bottom" ? value.v : null;
  return { h, v };
}

export function readLayerAligns(params: Readonly<Record<string, unknown>>): Readonly<Record<string, LayerAlign>> {
  const raw = params[LAYER_ALIGN_KEY];
  if (!isRecord(raw)) return {};
  const out: Record<string, LayerAlign> = {};
  for (const [id, value] of Object.entries(raw)) out[id] = readLayerAlign(value);
  return out;
}

// "hcenter" centres across only, "vcenter" centres down only (Figma's two centre icons); "center" sets both.
export type AlignEdge = "bottom" | "center" | "hcenter" | "left" | "right" | "top" | "vcenter";

// The alignment after pressing an icon: the same icon pressed again lets go of it.
export function pressAlign(current: LayerAlign, edge: AlignEdge): LayerAlign {
  if (edge === "left") return { ...current, h: current.h === "left" ? null : "left" };
  if (edge === "right") return { ...current, h: current.h === "right" ? null : "right" };
  if (edge === "hcenter") return { ...current, h: current.h === "center" ? null : "center" };
  if (edge === "vcenter") return { ...current, v: current.v === "middle" ? null : "middle" };
  if (edge === "top") return { ...current, v: current.v === "top" ? null : "top" };
  if (edge === "bottom") return { ...current, v: current.v === "bottom" ? null : "bottom" };
  const centred = current.h === "center" && current.v === "middle";
  return centred ? NO_ALIGN : { h: "center", v: "middle" };
}
