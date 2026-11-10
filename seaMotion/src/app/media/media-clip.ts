import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from "mediabunny";

export type MediaKind = "gif" | "video";

// A video or GIF that gives the picture at any time of its own (it loops). MP4 and WebM are decoded with
// mediabunny (WebCodecs); GIF with the browser's ImageDecoder. One request is decoded at a time.
export interface MediaClip {
  readonly duration: number;
  readonly height: number;
  readonly kind: MediaKind;
  readonly width: number;
  // The picture at `seconds` (wrapped into the clip's length); the caller closes it.
  // `maxWidth`: a smaller copy is enough (the live preview); the picture keeps its shape.
  frameAt(seconds: number, maxWidth?: number): Promise<ImageBitmap | null>;
  // Gets the pictures just before `seconds` ready for playing backwards from there (a no-op for clips that cannot).
  prepareBackwards?(seconds: number, maxWidth?: number): Promise<void>;
  dispose(): void;
}

type Queue = { run<T>(task: () => Promise<T>): Promise<T> };

// A decode that does not answer must never hold up every picture after it: it is given up after `ms`.
const DECODE_TIMEOUT_MS = 4000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("The video did not answer in time.")), ms);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(task, task);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

// A copy of a picture for the caller to keep and close; at most `maxWidth` wide when that is smaller than the picture.
function copyOf(source: ImageBitmap | VideoFrame, maxWidth?: number): Promise<ImageBitmap> {
  const width = source instanceof ImageBitmap ? source.width : source.displayWidth;
  if (maxWidth && maxWidth >= 16 && maxWidth < width) return createImageBitmap(source, { resizeQuality: "medium", resizeWidth: Math.round(maxWidth) });
  return createImageBitmap(source);
}

function wrap(seconds: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const local = seconds % duration;
  return local < 0 ? local + duration : local;
}

async function openVideo(blob: Blob): Promise<MediaClip> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("That file has no video track.");
  if (!(await track.canDecode())) throw new Error("This browser cannot decode that video's codec.");
  const duration = await input.computeDuration();
  const start = await track.getFirstTimestamp();
  const sink = new CanvasSink(track, { poolSize: 2 });
  const queue = createQueue();
  // Playback asks for the next pictures in order. Seeking to each one costs a decode from the nearest key frame
  // (about 55 ms for a 1080p clip); reading the frames in order costs about 1 ms. So one reader stays open and moves
  // forward; a jump back (the loop) or far ahead (scrubbing) opens a new one at the requested time.
  const NEAR_AHEAD_SECONDS = 1;
  let reader: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  let last: { bitmap: ImageBitmap; end: number; time: number } | null = null;
  const closeReader = (): void => {
    const done = reader;
    reader = null;
    void done?.return().catch(() => undefined);
  };
  // The decoded picture that is on screen at `time`, advancing the open reader when it is just ahead.
  const pull = async (time: number): Promise<WrappedCanvas | null> => {
    const ahead = last !== null && time >= last.end && time - last.end <= NEAR_AHEAD_SECONDS;
    if (!reader || !ahead) {
      closeReader();
      reader = sink.canvases(time);
    }
    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      if (time < next.value.timestamp + next.value.duration) return next.value;
    }
    closeReader();
    return (await sink.getCanvas(time)) ?? (await sink.getCanvas(start));
  };
  // Playing backwards (a clip run in reverse) would cost a decode from a key frame for every single picture. So when the pictures are
  // asked for in falling order, the second before the asked time is decoded once, in order, and kept to hand out backwards; the second
  // before that, and the one before that, are decoded one after another in the background while this one is handed out, so the pictures
  // never wait (a decode from a key frame can take longer than the second it covers).
  const BACK_SECONDS = 1;
  const BACK_WIDTH = 960;
  const BACK_DEPTH = 2;
  type Chunk = { frames: { bitmap: ImageBitmap; end: number; time: number }[]; from: number; maxWidth: number | undefined; to: number };
  let back: Chunk | null = null;
  let ahead: { chunk: Promise<Chunk>; from: number; to: number }[] = [];
  let requested: number | null = null;
  let downRun = 0;
  let reversing = false;
  const RECENT_FRAMES = 40;
  const RECENT_WIDTH = 1280;
  const recent: { bitmap: ImageBitmap; end: number; time: number }[] = [];
  const closeChunk = (chunk: Chunk | null): void => {
    for (const frame of chunk?.frames ?? []) frame.bitmap.close();
  };
  const dropBack = (): void => {
    closeChunk(back);
    back = null;
    const pending = ahead;
    ahead = [];
    for (const item of pending) void item.chunk.then(closeChunk, () => undefined);
  };
  const decodeChunk = async (time: number, maxWidth: number | undefined): Promise<Chunk> => {
    const from = Math.max(start, time - BACK_SECONDS);
    const width = Math.min(maxWidth ?? BACK_WIDTH, BACK_WIDTH);
    const frames: Chunk["frames"] = [];
    const run = sink.canvases(from, time + 0.05);
    try {
      for (;;) {
        const next = await run.next();
        if (next.done) break;
        const source = next.value.canvas;
        const bitmap = width >= 16 && width < source.width ? await createImageBitmap(source, { resizeQuality: "medium", resizeWidth: Math.round(width) }) : await createImageBitmap(source);
        frames.push({ bitmap, end: next.value.timestamp + next.value.duration, time: next.value.timestamp });
      }
    } finally {
      void run.return().catch(() => undefined);
    }
    return { frames, from, maxWidth, to: time + 0.05 };
  };
  const fillBack = async (time: number, maxWidth: number | undefined): Promise<void> => {
    dropBack();
    back = await decodeChunk(time, maxWidth);
  };
  const fromBack = (time: number, maxWidth: number | undefined): Promise<ImageBitmap> | null => {
    if (!back || back.maxWidth !== maxWidth) return null;
    const hit = back.frames.find((frame) => time >= frame.time && time < frame.end);
    if (!hit) return null;
    // As soon as this second is handed out, the seconds before it start decoding in the background, one after another.
    while (ahead.length < BACK_DEPTH) {
      const to = ahead.length > 0 ? (ahead[ahead.length - 1] as (typeof ahead)[number]).from : back.from;
      if (to <= start + 0.01) break;
      const previous = ahead.length > 0 ? (ahead[ahead.length - 1] as (typeof ahead)[number]).chunk.catch(() => undefined) : Promise.resolve();
      const chunk = previous.then(() => decodeChunk(to - 0.001, maxWidth));
      ahead.push({ chunk, from: Math.max(start, to - 0.001 - BACK_SECONDS), to });
      chunk.catch(() => {
        ahead = [];
      });
    }
    return createImageBitmap(hit.bitmap);
  };
  // The picture for `time` when it is just before what is kept: the chunk decoded in the background takes over.
  const advanceBack = async (time: number, maxWidth: number | undefined): Promise<boolean> => {
    const pending = ahead[0];
    if (!pending || !back || time >= back.from || time < pending.from - 0.05) return false;
    const chunk = await pending.chunk;
    if (ahead[0] !== pending) {
      closeChunk(chunk);
      return false;
    }
    ahead.shift();
    closeChunk(back);
    back = chunk;
    return back.maxWidth === maxWidth;
  };
  return {
    duration,
    height: track.displayHeight,
    kind: "video",
    width: track.displayWidth,
    prepareBackwards(seconds, maxWidth) {
      return queue.run(async () => {
        const time = start + wrap(seconds, duration - start);
        if (back && back.maxWidth === maxWidth && time >= back.from && time <= back.to) return;
        try {
          await withTimeout(fillBack(time, maxWidth), DECODE_TIMEOUT_MS * 2);
        } catch {
          dropBack();
        }
      });
    },
    frameAt(seconds, maxWidth) {
      return queue.run(async () => {
        const time = start + wrap(seconds, duration - start);
        // Backwards means falling several times in a row; one request a little earlier than the one before (pictures asked for slightly out
        // of order) is not.
        if (requested !== null && Math.abs(time - requested) >= 1) {
          downRun = 0;
          reversing = false;
        } else if (requested !== null && time > requested + 1e-4) {
          downRun = 0;
          if (time > requested + 0.02) reversing = false;
        } else if (requested !== null && time < requested - 1e-4) {
          downRun += 1;
          if (downRun >= 3) reversing = true;
        }
        const falling = reversing;
        requested = time;
        // A picture shown a moment ago (the last second or two) is kept, so a short jump back (a looped scene) needs no new decode.
        const seen = recent.find((frame) => time >= frame.time && time < frame.end);
        if (seen && !falling) return copyOf(seen.bitmap, maxWidth);
        // Backwards: pictures come from the half second decoded ahead of time.
        if (falling || back) {
          const cached = fromBack(time, maxWidth);
          if (cached) return cached;
          if (falling) {
            try {
              if (await withTimeout(advanceBack(time, maxWidth), DECODE_TIMEOUT_MS * 2)) {
                const advanced = fromBack(time, maxWidth);
                if (advanced) return advanced;
              }
              await withTimeout(fillBack(time, maxWidth), DECODE_TIMEOUT_MS * 2);
              const filled = fromBack(time, maxWidth);
              if (filled) return filled;
            } catch {
              dropBack();
            }
          } else {
            dropBack();
          }
        }
        // The same source picture stays on screen for several preview frames.
        if (last && time >= last.time && time < last.end) return copyOf(last.bitmap, maxWidth);
        let wrapped: WrappedCanvas | null;
        try {
          wrapped = await withTimeout(pull(time), DECODE_TIMEOUT_MS);
        } catch {
          // The in-order reader is stuck: drop it and read this picture by itself; failing that, keep the last picture shown.
          closeReader();
          try {
            wrapped = await withTimeout(sink.getCanvas(time), DECODE_TIMEOUT_MS);
          } catch {
            return last ? copyOf(last.bitmap, maxWidth) : null;
          }
        }
        if (!wrapped) return null;
        const bitmap = await createImageBitmap(wrapped.canvas);
        last?.bitmap.close();
        last = { bitmap, end: wrapped.timestamp + wrapped.duration, time: wrapped.timestamp };
        // Kept for a short jump back: at most RECENT_FRAMES pictures at no more than RECENT_WIDTH wide.
        if (!recent.some((frame) => frame.time === wrapped.timestamp)) {
          const small = await copyOf(bitmap, RECENT_WIDTH);
          recent.push({ bitmap: small, end: wrapped.timestamp + wrapped.duration, time: wrapped.timestamp });
          while (recent.length > RECENT_FRAMES) recent.shift()?.bitmap.close();
        }
        return copyOf(bitmap, maxWidth);
      });
    },
    dispose() {
      closeReader();
      dropBack();
      for (const frame of recent.splice(0)) frame.bitmap.close();
      last?.bitmap.close();
      last = null;
      input.dispose();
    },
  };
}

type GifDecoder = {
  close(): void;
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
};
type GifDecoderConstructor = new (init: { data: ArrayBuffer; type: string }) => GifDecoder;

async function openGif(blob: Blob): Promise<MediaClip> {
  const Decoder = (globalThis as { ImageDecoder?: GifDecoderConstructor }).ImageDecoder;
  if (!Decoder) throw new Error("This browser cannot decode GIF animations.");
  const decoder = new Decoder({ data: await blob.arrayBuffer(), type: "image/gif" });
  await decoder.tracks.ready;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
  // Each frame's start time; GIF frames often carry 0 or 1 cs delays that browsers play at 10 cs.
  const starts: number[] = [];
  let total = 0;
  let width = 0;
  let height = 0;
  for (let index = 0; index < count; index += 1) {
    const { image } = await decoder.decode({ frameIndex: index });
    if (index === 0) {
      width = image.displayWidth;
      height = image.displayHeight;
    }
    const seconds = (image.duration ?? 0) / 1e6;
    starts.push(total);
    total += seconds > 0.015 ? seconds : 0.1;
    image.close();
  }
  const queue = createQueue();
  return {
    duration: total,
    height,
    kind: "gif",
    width,
    frameAt(seconds, maxWidth) {
      return queue.run(async () => {
        const time = wrap(seconds, total);
        let index = 0;
        while (index + 1 < starts.length && (starts[index + 1] ?? Infinity) <= time) index += 1;
        const { image } = await decoder.decode({ frameIndex: index });
        try {
          return await copyOf(image, maxWidth);
        } finally {
          image.close();
        }
      });
    },
    dispose() {
      decoder.close();
    },
  };
}

export function openMediaClip(blob: Blob, kind: MediaKind): Promise<MediaClip> {
  return kind === "gif" ? openGif(blob) : openVideo(blob);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
