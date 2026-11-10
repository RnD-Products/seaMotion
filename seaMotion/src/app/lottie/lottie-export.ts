import { strToU8, zipSync } from "fflate";
import { defineToolcraftCustomControlType, type ToolcraftState } from "@/toolcraft/runtime";

import { ANIMATION_PARAMS_TARGET, LAYER_STYLE_KEY, getActiveAnimation, getLayerStack } from "../animation/animation-spec";
import { MO_PROJECTS_TARGET, readMoProjects } from "../mo/mo-projects";
import { lottieLayers, prepareLottie, type LottieLayerStyle } from "./lottie-data";
import { checkLottieExport, getProjectLottie, isLottieExportBlocked } from "./lottie-support";

export const lottieCheckControl = defineToolcraftCustomControlType("lottieCheck");
export const lottieExportControl = defineToolcraftCustomControlType("lottieExport");
export const LOTTIE_FORMAT_TARGET = "lottie.format";
export const LOTTIE_BACKGROUND_TARGET = "lottie.background";

export type LottieExportFormat = "json" | "lottie";

export type LottieExportResult = Readonly<{ byteLength: number; fileName: string; leftOut: number }>;

// The result of the last export, shown under the check.
export type LottieExportStatus = Readonly<{ kind: "error" | "success"; message: string }> | null;

let status: LottieExportStatus = null;
const listeners = new Set<() => void>();

export function getLottieExportStatus(): LottieExportStatus {
  return status;
}

export function setLottieExportStatus(next: LottieExportStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

export function subscribeLottieExportStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readLottieFormat(value: unknown): LottieExportFormat {
  return value === "lottie" ? "lottie" : "json";
}

// The Lottie file of the open project: the layers the Layers panel shows, the Layer section's blend and
// opacity, and a Background layer when asked for.
export function buildLottieExport(state: ToolcraftState): Readonly<{ data: Record<string, unknown>; leftOut: number }> {
  const values = state.values;
  const issues = checkLottieExport(values, state.timeline.durationSeconds);
  const blocking = issues.find((issue) => issue.blocking === true);
  if (isLottieExportBlocked(issues) && blocking) throw new Error(`${blocking.title}: ${blocking.why} ${blocking.fix}`);
  const spec = getActiveAnimation(values);
  const source = getProjectLottie(spec);
  if (!spec || !source) throw new Error("This project has no Lottie animation.");
  const shown = new Set(getLayerStack(spec, state.layers));
  const params = values[ANIMATION_PARAMS_TARGET];
  const styles = (typeof params === "object" && params !== null ? (params as Record<string, unknown>)[LAYER_STYLE_KEY] : undefined) ?? {};
  const background = values[LOTTIE_BACKGROUND_TARGET] === true && typeof values["appearance.background"] === "string" ? (values["appearance.background"] as string) : null;
  const data = prepareLottie(source, {
    background,
    hidden: lottieLayers(source).map((layer) => layer.id).filter((id) => !shown.has(id)),
    styles: styles as Record<string, LottieLayerStyle>,
  });
  return { data, leftOut: issues.length };
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A dotLottie (version 1) file: a zip with a manifest and the animation JSON.
export function toDotLottie(data: Record<string, unknown>, id: string): Uint8Array {
  const manifest = {
    animations: [{ autoplay: true, id, loop: true, speed: 1 }],
    generator: "seaMotion",
    version: "1",
  };
  return zipSync({
    "animations/": {},
    [`animations/${id}.json`]: strToU8(JSON.stringify(data)),
    "manifest.json": strToU8(JSON.stringify(manifest)),
  });
}

export function exportLottie(state: ToolcraftState): LottieExportResult {
  const { data, leftOut } = buildLottieExport(state);
  const projects = readMoProjects(state.values[MO_PROJECTS_TARGET]);
  const projectName = projects.items.find((item) => item.id === projects.currentId)?.name ?? "Lottie";
  const safeName = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim() || "Lottie";
  const format = readLottieFormat(state.values[LOTTIE_FORMAT_TARGET]);
  const id = safeName.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "animation";
  const bytes = format === "lottie" ? toDotLottie(data, id) : strToU8(JSON.stringify(data));
  const fileName = `${safeName}.${format === "lottie" ? "lottie" : "json"}`;
  download(new Blob([bytes as BlobPart], { type: format === "lottie" ? "application/zip" : "application/json" }), fileName);
  return { byteLength: bytes.byteLength, fileName, leftOut };
}
