import { getActiveAnimation, type AnimationSpec } from "../animation/animation-spec";
import { readBackdrop } from "../animation/backdrop";
import { readFramePerspective, readFrameStyle, readFrameTransform } from "../animation/frame-transform";
import { isInteractionsOn } from "../animation/interactions";
import { MOTION_TYPE_TARGET, readMotionType } from "../animation/motion-type";
import { soundtrackRequest } from "../animation/sound";
import { isLottieData, lottieInfo, type LottieData } from "./lottie-data";

// One thing a Lottie export cannot carry: what it is, why, and what to do about it.
// `blocking` issues stop the export; the others are left out of the file.
export type LottieIssue = Readonly<{
  blocking?: boolean;
  fix: string;
  id: string;
  title: string;
  where?: readonly string[];
  why: string;
}>;

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// Features of the Lottie format that the common players (lottie-web, lottie-ios, lottie-android, dotLottie)
// do not all draw. Each entry is checked against every layer and shape of the animation.
const SHAPE_ISSUES: Readonly<Record<string, Omit<LottieIssue, "where">>> = {
  mm: {
    fix: "Draw the combined outline as one path instead of merging paths.",
    id: "merge-paths",
    title: "Merge Paths",
    why: "lottie-web (browser) ignores Merge Paths and Android draws them only on newer versions.",
  },
  op: {
    fix: "Bake the offset into the path itself.",
    id: "offset-paths",
    title: "Offset Paths",
    why: "Several players (older iOS and Android, some web players) do not draw Offset Paths.",
  },
  pb: {
    fix: "Bake the effect into the path's points.",
    id: "pucker-bloat",
    title: "Pucker & Bloat",
    why: "Pucker & Bloat is drawn by only a few players.",
  },
  tw: {
    fix: "Bake the twist into the path's points.",
    id: "twist",
    title: "Twist",
    why: "No common Lottie player draws Twist.",
  },
  zz: {
    fix: "Bake the zig zag into the path's points.",
    id: "zig-zag",
    title: "Zig Zag",
    why: "lottie-web (browser) and older mobile players ignore Zig Zag.",
  },
};

function layerName(layer: Json, index: number): string {
  return typeof layer.nm === "string" && layer.nm.trim() !== "" ? layer.nm : `Layer ${index + 1}`;
}

// True when any property in the tree carries an expression (an `x` string next to a value `k`).
function hasExpression(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExpression);
  if (!isRecord(value)) return false;
  if (typeof value.x === "string" && value.x.trim() !== "" && "k" in value) return true;
  return Object.values(value).some(hasExpression);
}

function walkShapes(shapes: unknown, visit: (shape: Json) => void): void {
  if (!Array.isArray(shapes)) return;
  for (const shape of shapes) {
    if (!isRecord(shape)) continue;
    visit(shape);
    if (shape.ty === "gr") walkShapes(shape.it, visit);
  }
}

// What in the Lottie data itself will not play the same everywhere.
export function checkLottieData(data: LottieData): LottieIssue[] {
  const found = new Map<string, { issue: Omit<LottieIssue, "where">; where: Set<string> }>();
  const add = (issue: Omit<LottieIssue, "where">, where: string): void => {
    const entry = found.get(issue.id) ?? { issue, where: new Set<string>() };
    entry.where.add(where);
    found.set(issue.id, entry);
  };
  const assets = Array.isArray(data.assets) ? data.assets.filter(isRecord) : [];
  const fonts = isRecord(data.fonts) && Array.isArray(data.fonts.list) ? data.fonts.list.filter(isRecord) : [];
  const hasGlyphs = Array.isArray(data.chars) && data.chars.length > 0;
  const lists: { layers: unknown[]; prefix: string }[] = [{ layers: data.layers as unknown[], prefix: "" }];
  for (const asset of assets) {
    if (Array.isArray(asset.layers)) lists.push({ layers: asset.layers, prefix: `${typeof asset.nm === "string" ? asset.nm : String(asset.id ?? "precomp")} › ` });
  }
  for (const { layers, prefix } of lists) {
    layers.forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const where = `${prefix}${layerName(raw, index)}`;
      if (raw.ddd === 1) add({ fix: "Turn 3D off for these layers and fake depth with scale and position.", id: "3d", title: "3D layers", why: "Most players draw 3D layers flat or not at all." }, where);
      if (raw.ty === 13) add({ fix: "Remove the camera and animate the layers' position and scale instead.", id: "camera", title: "Camera layer", why: "Lottie players do not use cameras." }, where);
      if (raw.ty === 6) add({ fix: "Remove the audio layer; play the sound beside the animation in your app.", id: "audio", title: "Audio layer", why: "Lottie players do not play sound." }, where);
      if (Array.isArray(raw.ef) && raw.ef.length > 0) add({ fix: "Remove the effects or bake them into shapes and colours.", id: "effects", title: "Layer effects", why: "Effects (blur, glow, drop shadow…) are ignored by iOS, Android and most web players." }, where);
      if (Array.isArray(raw.sy) && raw.sy.length > 0) add({ fix: "Remove the layer styles; draw the stroke or shadow as its own shape layer.", id: "layer-styles", title: "Layer styles", why: "Layer styles (stroke, shadow, glow) are not part of what players draw." }, where);
      if (raw.mb === true) add({ fix: "Turn motion blur off; it is not exported.", id: "motion-blur", title: "Motion blur", why: "No Lottie player draws motion blur." }, where);
      if (typeof raw.bm === "number" && raw.bm !== 0) add({ fix: "Use Normal blend, or bake the look into the colours.", id: "blend-modes", title: "Blend modes", why: "Android ignores blend modes and iOS supports only some." }, where);
      if (Array.isArray(raw.masksProperties)) {
        for (const mask of raw.masksProperties) {
          if (isRecord(mask) && typeof mask.mode === "string" && !["a", "s", "n"].includes(mask.mode)) {
            add({ fix: "Use Add or Subtract masks, or a track matte.", id: "mask-modes", title: "Mask modes", why: "Intersect, Lighten, Darken and Difference masks are not supported on every player." }, where);
          }
          if (isRecord(mask) && isRecord(mask.x) && (mask.x.a === 1 || (typeof mask.x.k === "number" && mask.x.k !== 0))) {
            add({ fix: "Draw the mask at its final size instead of using Mask Expansion.", id: "mask-expansion", title: "Mask expansion", why: "Mask expansion is ignored by iOS and Android." }, where);
          }
        }
      }
      if (raw.ty === 2) {
        const asset = assets.find((item) => item.id === raw.refId);
        const embedded = asset && typeof asset.p === "string" && asset.p.startsWith("data:");
        if (!embedded) add({ blocking: false, fix: "Embed the image in the file (a data: URL with e: 1).", id: "linked-images", title: "Linked images", why: "The image file is not inside the Lottie, so players show an empty layer." }, where);
      }
      if (raw.ty === 5) {
        const doc = isRecord(raw.t) && isRecord(raw.t.d) && Array.isArray(raw.t.d.k) ? raw.t.d.k : [];
        const fontName = doc.map((item) => (isRecord(item) && isRecord(item.s) ? item.s.f : undefined)).find((value) => typeof value === "string");
        const font = fonts.find((item) => item.fName === fontName);
        if (!hasGlyphs) {
          add({
            fix: "Convert the text to shapes (outlines) before exporting, or export with glyphs.",
            id: "font-text",
            title: "Live text without glyphs",
            why: `Canvas players (and this preview) draw text only from glyphs, and iOS / Android need the font file bundled${font && typeof font.fFamily === "string" ? ` (${font.fFamily})` : ""}.`,
          }, where);
        }
      }
      if (hasExpression(raw)) add({ fix: "Bake the expressions into keyframes.", id: "expressions", title: "Expressions", why: "Expressions run only in lottie-web; iOS, Android and dotLottie players ignore them." }, where);
      walkShapes(raw.shapes, (shape) => {
        const issue = typeof shape.ty === "string" ? SHAPE_ISSUES[shape.ty] : undefined;
        if (issue) add(issue, where);
      });
    });
  }
  return [...found.values()].map(({ issue, where }) => ({ ...issue, where: [...where] }));
}

// The Lottie data of a project, when the project has one.
export function getProjectLottie(spec: AnimationSpec | null): LottieData | null {
  return spec && isLottieData(spec.lottie) ? spec.lottie : null;
}

// Everything that will not be in the exported Lottie: the data's own unsupported features, and what the
// app adds on top of the animation (Reactor, sound, frame, backdrop).
export function checkLottieExport(values: Readonly<Record<string, unknown>>, durationSeconds: number): LottieIssue[] {
  const issues: LottieIssue[] = [];
  const spec = getActiveAnimation(values);
  const data = getProjectLottie(spec);
  if (readMotionType(values[MOTION_TYPE_TARGET]) !== "lottie") {
    issues.push({
      blocking: true,
      fix: "Set Motion Type to Lottie Animation.",
      id: "not-lottie",
      title: "Not a Lottie Animation project",
      why: "Only Lottie Animation projects export Lottie files.",
    });
  }
  if (!data) {
    issues.push({
      blocking: true,
      fix: "Open a Lottie .json with Open project › Browse files, or ask the agent to rebuild this motion as Lottie.",
      id: "no-lottie-data",
      title: spec ? "This motion is a drawing script" : "No animation yet",
      why: spec ? "Its motion is drawn by code, which a Lottie file cannot hold." : "There is nothing to export.",
    });
    return issues;
  }
  issues.push(...checkLottieData(data));
  const media = spec?.media ?? {};
  if (Object.keys(media).length > 0) {
    issues.push({
      fix: "Hide or delete the video and GIF layers, or render MP4 / WebM to keep them.",
      id: "media-layers",
      title: "Video and GIF layers",
      where: spec ? spec.layers.filter((layer) => layer.id in media).map((layer) => layer.name) : [],
      why: "A Lottie file cannot hold video; players would show nothing there.",
    });
  }
  const info = lottieInfo(data);
  if (Math.abs(durationSeconds - info.durationSeconds) > 0.05) {
    issues.push({
      fix: `Set the timeline to ${info.durationSeconds.toFixed(2)} s.`,
      id: "timeline-length",
      title: "Timeline length",
      why: `The timeline is ${durationSeconds.toFixed(2)} s but the Lottie animation is ${info.durationSeconds.toFixed(2)} s; the file keeps its own length.`,
    });
  }
  if (isInteractionsOn(values)) {
    issues.push({
      fix: "Turn the Reactor off, or ask the agent to add the cursor, taps and drags as Lottie layers.",
      id: "reactor",
      title: "Reactor",
      why: "The Reactor's cursor, taps and drags are drawn by the app over the animation, not inside it.",
    });
  }
  if (soundtrackRequest(values, durationSeconds)) {
    issues.push({
      fix: "Turn Sound off for the Lottie, or render MP4 / WebM to keep the sound.",
      id: "sound",
      title: "Sound",
      why: "Lottie files carry no sound that players play.",
    });
  }
  const style = readFrameStyle(values);
  const transform = readFrameTransform(values);
  const frameParts = [
    style.fill ? "fill" : "",
    style.stroke ? "stroke" : "",
    style.clip && style.radius > 0 ? "rounded corners" : "",
    transform.rotation !== 0 ? "rotation" : "",
    transform.opacity !== 100 ? "opacity" : "",
    readFramePerspective(values).enabled ? "perspective" : "",
  ].filter(Boolean);
  if (frameParts.length > 0) {
    issues.push({
      fix: "Turn these off in Frame Settings, or use Lottie export › Background for a solid colour behind the animation.",
      id: "frame",
      title: "Frame settings",
      why: `The frame's ${frameParts.join(", ")} ${frameParts.length > 1 ? "are" : "is"} drawn by the app around the animation.`,
    });
  }
  const backdrop = readBackdrop(values);
  if (backdrop.mode === "mockup" || backdrop.top.type !== "off" || backdrop.bottom.type !== "off") {
    issues.push({
      fix: "Turn the mockup and stickies off, or render MP4 / WebM to keep them.",
      id: "backdrop",
      title: "Mockup and stickies",
      why: "They are drawn by the app around the animation.",
    });
  }
  return issues;
}

export function isLottieExportBlocked(issues: readonly LottieIssue[]): boolean {
  return issues.some((issue) => issue.blocking === true);
}
