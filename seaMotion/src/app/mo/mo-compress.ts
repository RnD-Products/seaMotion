// Pictures that come in with a pasted design (a blurred shape, a text as picture, a single layer) are PNG files the plugin
// exported at 2x. They are re-encoded here without any visible loss: WebP at its top quality (and the browser's own PNG),
// whichever is smallest and clearly smaller. A WebP is taken only when it is checked against the original: the same
// transparency, and every color within 1.5 of 255 once drawn on its transparency (not visible); otherwise the PNG stays.
// Photos and other files are left alone.

const MIN_BYTES = 3 * 1024;
const MIN_GAIN = 0.08;

const byteLength = (dataUrl: string): number => Math.max(0, Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4));

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function encode(canvas: OffscreenCanvas, type: string, quality?: number): Promise<string | null> {
  try {
    const blob = await canvas.convertToBlob(quality === undefined ? { type } : { quality, type });
    // A browser that cannot encode the type falls back to PNG; only the asked type counts.
    return blob.type === type ? await toDataUrl(blob) : null;
  } catch {
    return null;
  }
}

// True when the candidate shows the same picture: identical transparency, colors within 1.5/255 as drawn.
function sameLook(a: ImageData, b: ImageData): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const x = a.data;
  const y = b.data;
  for (let i = 0; i < x.length; i += 4) {
    const alphaA = x[i + 3] ?? 0;
    const alphaB = y[i + 3] ?? 0;
    if (alphaA !== alphaB) return false;
    if (alphaA === 0) continue;
    for (let k = 0; k < 3; k += 1) {
      if (Math.abs(((x[i + k] ?? 0) * alphaA) / 255 - ((y[i + k] ?? 0) * alphaB) / 255) > 1.5) return false;
    }
  }
  return true;
}

async function look(url: string): Promise<ImageData | null> {
  try {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

export type CompressResult = Readonly<{ assets: Record<string, string>; before: number; after: number }>;

// Recompresses the PNG pictures among `keys` of `assets`; returns the assets and the bytes before and after.
export async function compressPictures(assets: Readonly<Record<string, string>>, keys: readonly string[]): Promise<CompressResult> {
  const next: Record<string, string> = { ...assets };
  let before = 0;
  let after = 0;
  if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") return { after, assets: next, before };
  for (const key of keys) {
    const source = assets[key];
    if (typeof source !== "string" || !source.startsWith("data:image/png;base64,")) continue;
    const size = byteLength(source);
    if (size < MIN_BYTES) continue;
    try {
      const blob = await (await fetch(source)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) {
        bitmap.close();
        continue;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const original = context.getImageData(0, 0, canvas.width, canvas.height);
      const candidates = (await Promise.all([encode(canvas, "image/webp", 1), encode(canvas, "image/png")])).filter((url): url is string => url !== null);
      let best = source;
      let bestSize = size;
      for (const url of candidates.sort((p, q) => byteLength(p) - byteLength(q))) {
        const candidateSize = byteLength(url);
        if (candidateSize >= bestSize) break;
        const decoded = await look(url);
        if (decoded && sameLook(original, decoded)) {
          best = url;
          bestSize = candidateSize;
          break;
        }
      }
      before += size;
      if (bestSize <= size * (1 - MIN_GAIN)) {
        next[key] = best;
        after += bestSize;
      } else {
        after += size;
      }
    } catch {
      // A picture that cannot be decoded stays as it is.
    }
  }
  return { after, assets: next, before };
}

export const formatSize = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
