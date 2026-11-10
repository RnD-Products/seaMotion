import type { AnimationSpec } from "../animation/animation-spec";
import { getProbeSandbox } from "../animation/layer-texts";
import { designFonts, fontKey, isItalicStyle, weightOfStyle, withMissingFonts, type FigmaFont } from "./figma-paste-import";

// The app's saved fonts live in a folder next to the projects (~/Documents/seaMotion/Fonts), kept by the auto-save
// helper. A design that needs one of them gets it automatically; a font added for one design is there for all.
const AUTOSAVE_URL = "http://127.0.0.1:3011";

export type SavedFont = Readonly<{ family: string; file: string; italic: boolean; style: string; weight: number }>;

export const FONT_FILE_ACCEPT = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";

export async function listSavedFonts(): Promise<readonly SavedFont[]> {
  try {
    const response = await fetch(`${AUTOSAVE_URL}/fonts`);
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: SavedFont[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

async function readSavedFont(file: string): Promise<string | null> {
  try {
    const response = await fetch(`${AUTOSAVE_URL}/fonts/file?name=${encodeURIComponent(file)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { dataUrl?: string };
    return typeof body.dataUrl === "string" ? body.dataUrl : null;
  } catch {
    return null;
  }
}

// Saves a font file for every project. Resolves false when the helper is not running (the font still goes into
// the open project).
export async function saveFontForApp(font: FigmaFont, fileName: string, dataUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${AUTOSAVE_URL}/fonts/save`, {
      body: JSON.stringify({ dataUrl, family: font.family, fileName, italic: isItalicStyle(font.style), style: font.style, weight: font.weight }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

// Checks the font file really is a font before it is used: the browser must be able to load it.
export async function checkFontFile(family: string, dataUrl: string): Promise<void> {
  try {
    await new FontFace(`mo-check-${family}`, `url(${dataUrl})`).load();
  } catch {
    throw new Error("That file is not a font this browser can read. Use a .ttf, .otf, .woff or .woff2 file.");
  }
}

// The animation carrying this font file (the design script loads it), replacing an earlier file for the same font.
export function withCarriedFont(spec: AnimationSpec, font: FigmaFont, dataUrl: string): AnimationSpec {
  const asset = `font-${fontKey(font).replace(/[^a-z0-9]+/g, "-")}`;
  const style = isItalicStyle(font.style) ? "italic" : "normal";
  const weight = String(font.weight || weightOfStyle(font.style));
  const fonts = spec.fonts.filter((own) => own.asset !== asset);
  return {
    ...spec,
    assets: { ...spec.assets, [asset]: dataUrl },
    fonts: [...fonts, { asset, family: font.family, style, weight }],
    version: spec.version + 1,
  };
}

const SAMPLE = "mmmmmmmmmmlli1WQ@#&gjy";
let measureContext: CanvasRenderingContext2D | null = null;

// Without a drawing to ask, the app's own page measures; the app's web fonts are not on the drawing's page, so
// they do not count.
function pageHasFamily(family: string): boolean {
  const webFonts = new Set([...document.fonts].map((face) => face.family.replace(/["']/g, "").toLowerCase()));
  if (webFonts.has(family.toLowerCase())) return false;
  measureContext ??= document.createElement("canvas").getContext("2d");
  const context = measureContext;
  if (!context) return true;
  return ["monospace", "serif", "sans-serif"].some((generic) => {
    context.font = `72px ${generic}`;
    const plain = context.measureText(SAMPLE).width;
    context.font = `72px "${family.replace(/"/g, "")}", ${generic}`;
    return Math.abs(context.measureText(SAMPLE).width - plain) > 0.01;
  });
}

// Which of these families this computer can draw with.
export async function checkFamilies(families: readonly string[]): Promise<Record<string, boolean>> {
  const sandbox = getProbeSandbox();
  if (sandbox) {
    try {
      return await sandbox.checkFonts(families);
    } catch {
      // The drawing is being replaced; measure on the page instead.
    }
  }
  return Object.fromEntries(families.map((family) => [family, pageHasFamily(family)]));
}

// The design with every font it can get: fonts saved in the app are added to it, and texts whose font is still
// missing are marked (they show as their picture until the font is added).
export async function resolveDesignFonts(spec: AnimationSpec): Promise<AnimationSpec> {
  const fonts = designFonts(spec);
  if (fonts.length === 0) return spec;
  let next = spec;
  const carried = (font: FigmaFont): boolean =>
    next.fonts.some((own) => own.family.toLowerCase() === font.family.toLowerCase() && Number(own.weight) === font.weight && (own.style === "italic") === isItalicStyle(font.style));
  const families = [...new Set(fonts.map((font) => font.family))];
  const available = await checkFamilies(families);
  const saved = await listSavedFonts();
  for (const font of fonts) {
    if (carried(font) || available[font.family]) continue;
    const match = saved.find((item) => fontKey(item) === fontKey(font));
    const dataUrl = match ? await readSavedFont(match.file) : null;
    if (dataUrl) next = withCarriedFont(next, font, dataUrl);
  }
  return withMissingFonts(next, (family) => available[family] === true);
}

// Fonts that can be picked for a text: the design's own (when present), the app's saved fonts and common fonts this
// computer has.
const COMMON_FAMILIES = [
  "Inter",
  "SF Pro Display",
  "SF Pro Text",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Avenir",
  "Avenir Next",
  "Futura",
  "Gill Sans",
  "Georgia",
  "Times New Roman",
  "Menlo",
  "Courier New",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Lato",
  "DM Sans",
  "Manrope",
  "Instrument Sans",
  "Instrument Serif",
];

export async function pickableFamilies(spec: AnimationSpec): Promise<string[]> {
  const saved = await listSavedFonts();
  const candidates = [...new Set([...designFonts(spec).map((font) => font.family), ...spec.fonts.map((font) => font.family), ...saved.map((font) => font.family), ...COMMON_FAMILIES])];
  const available = await checkFamilies(candidates);
  const carried = new Set(spec.fonts.map((font) => font.family));
  const savedFamilies = new Set(saved.map((font) => font.family));
  return candidates.filter((family) => available[family] || carried.has(family) || savedFamilies.has(family)).sort((a, b) => a.localeCompare(b));
}

// A saved font for this family and style, added to the animation; null when the app has none.
export async function carrySavedFont(spec: AnimationSpec, font: FigmaFont): Promise<AnimationSpec | null> {
  const match = (await listSavedFonts()).find((item) => fontKey(item) === fontKey(font));
  const dataUrl = match ? await readSavedFont(match.file) : null;
  return dataUrl ? withCarriedFont(spec, font, dataUrl) : null;
}

export const STANDARD_STYLES = ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black", "Italic", "Bold Italic"];
