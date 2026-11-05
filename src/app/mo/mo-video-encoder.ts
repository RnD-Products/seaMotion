export type MoVideoFormat = "mp4" | "webm";
export type MoVideoCodec = "avc" | "hevc" | "vp8" | "vp9";

export type MoVideoEncoder = Readonly<{
  // Whether the file carries the soundtrack that was asked for.
  hasAudio: boolean;
  addFrame: (timeSeconds: number, durationSeconds: number, keyFrame: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  codec: MoVideoCodec;
  finalize: () => Promise<Blob>;
  format: MoVideoFormat;
}>;

type Candidate = Readonly<{ codec: MoVideoCodec; format: MoVideoFormat }>;

// H.264 tops out below 4K on a 4:3 canvas, so MP4 falls through to H.265
// before giving up the container the user asked for.
const MP4_CANDIDATES: readonly Candidate[] = [
  { codec: "avc", format: "mp4" },
  { codec: "hevc", format: "mp4" },
];
const WEBM_CANDIDATES: readonly Candidate[] = [
  { codec: "vp9", format: "webm" },
  { codec: "vp8", format: "webm" },
];

function getBitrate(width: number, height: number, frameRate: number): number {
  const ceiling = 12_000_000 * (frameRate / 30);
  return Math.max(2_000_000, Math.min(ceiling, Math.round(width * height * frameRate * 0.05)));
}

// Audio encoders pad their last block (AAC by up to ~64 ms), which made files run past the last video frame and players
// showed black there. The soundtrack is cut this much before the video's end, with a short fade so it does not click.
const AUDIO_END_MARGIN_SECONDS = 0.1;
const AUDIO_END_FADE_SECONDS = 0.03;

export function fitAudioToVideo(audio: AudioBuffer, videoSeconds: number): AudioBuffer {
  const keep = Math.max(1, Math.min(audio.length, Math.floor((videoSeconds - AUDIO_END_MARGIN_SECONDS) * audio.sampleRate)));
  const fitted = new AudioBuffer({ length: keep, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate });
  const fade = Math.min(keep, Math.round(AUDIO_END_FADE_SECONDS * audio.sampleRate));
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const data = audio.getChannelData(channel).slice(0, keep);
    for (let i = 0; i < fade; i += 1) data[keep - 1 - i] *= i / fade;
    fitted.copyToChannel(data, channel);
  }
  return fitted;
}

// Cuts a soundtrack into one-second pieces, fed to the encoder alongside the frames.
function audioPieces(audio: AudioBuffer): AudioBuffer[] {
  const pieces: AudioBuffer[] = [];
  const step = audio.sampleRate;
  for (let from = 0; from < audio.length; from += step) {
    const length = Math.min(step, audio.length - from);
    const piece = new AudioBuffer({ length, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate });
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      piece.copyToChannel(audio.getChannelData(channel).subarray(from, from + length), channel);
    }
    pieces.push(piece);
  }
  return pieces;
}

export async function createMoVideoEncoder(
  request: Readonly<{
    canvas: HTMLCanvasElement;
    // Encode the canvas alpha channel; only WebM can carry it.
    alpha?: boolean;
    // A set video bitrate (bits per second), for a file under a size; otherwise one is chosen from the frame size.
    bitrate?: number;
    // A soundtrack to put in the file (interaction sounds and music), from time 0.
    audio?: AudioBuffer | null;
    // How long the video is; the soundtrack is fitted inside it (see fitAudioToVideo).
    durationSeconds?: number;
    frameRate: number;
    requestedFormat: MoVideoFormat;
    signal: AbortSignal;
  }>,
): Promise<MoVideoEncoder> {
  const { canvas, signal } = request;
  signal.throwIfAborted();
  const mediabunny = await import("mediabunny");
  signal.throwIfAborted();
  // A size limit only ever lowers the usual bitrate, so a short video under the limit keeps full quality.
  const usual = getBitrate(canvas.width, canvas.height, request.frameRate);
  const bitrate = request.bitrate !== undefined ? Math.max(50_000, Math.min(usual, Math.round(request.bitrate))) : usual;
  const alpha = request.alpha === true ? "keep" : "discard";
  const candidates =
    alpha === "keep"
      ? WEBM_CANDIDATES
      : request.requestedFormat === "mp4"
        ? [...MP4_CANDIDATES, ...WEBM_CANDIDATES]
        : [...WEBM_CANDIDATES, ...MP4_CANDIDATES];
  let selected: Candidate | undefined;
  for (const candidate of candidates) {
    const supported = await mediabunny.canEncodeVideo(candidate.codec, {
      alpha,
      bitrate,
      height: canvas.height,
      width: canvas.width,
    });
    signal.throwIfAborted();
    if (supported) {
      selected = candidate;
      break;
    }
  }
  if (!selected) {
    throw new Error(
      alpha === "keep"
        ? `This browser cannot encode transparent video at ${canvas.width}×${canvas.height}.`
        : `This browser cannot encode video at ${canvas.width}×${canvas.height}.`,
    );
  }

  const target = new mediabunny.BufferTarget();
  const output = new mediabunny.Output({
    format:
      selected.format === "mp4" ? new mediabunny.Mp4OutputFormat() : new mediabunny.WebMOutputFormat(),
    target,
  });
  const source = new mediabunny.CanvasSource(canvas, {
    alpha,
    bitrate,
    codec: selected.codec,
    keyFrameInterval: 2,
  });
  // The soundtrack: AAC in MP4 (Opus when the browser has no AAC encoder), Opus in WebM. A browser that can encode
  // neither renders the video without sound.
  let audioSource: InstanceType<typeof mediabunny.AudioBufferSource> | null = null;
  if (request.audio) {
    const audioCodecs = selected.format === "mp4" ? (["aac", "opus"] as const) : (["opus"] as const);
    for (const codec of audioCodecs) {
      if (await mediabunny.canEncodeAudio(codec, { numberOfChannels: request.audio.numberOfChannels, sampleRate: request.audio.sampleRate })) {
        audioSource = new mediabunny.AudioBufferSource({ codec, quality: mediabunny.QUALITY_HIGH });
        break;
      }
    }
    signal.throwIfAborted();
  }
  const fittedAudio = request.audio && request.durationSeconds ? fitAudioToVideo(request.audio, request.durationSeconds) : request.audio;
  const pieces = audioSource && fittedAudio ? audioPieces(fittedAudio) : [];
  let nextPiece = 0;
  const feedAudio = async (untilSeconds: number): Promise<void> => {
    while (audioSource && nextPiece < pieces.length && nextPiece <= untilSeconds) {
      const piece = pieces[nextPiece];
      nextPiece += 1;
      if (piece) await audioSource.add(piece);
    }
  };
  try {
    output.addVideoTrack(source, { frameRate: request.frameRate });
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    signal.throwIfAborted();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }

  let finalized = false;
  const mediaType = selected.format === "mp4" ? "video/mp4" : "video/webm";
  return Object.freeze({
    addFrame: async (timeSeconds, durationSeconds, keyFrame) => {
      signal.throwIfAborted();
      await feedAudio(timeSeconds + 1);
      await source.add(timeSeconds, durationSeconds, { keyFrame });
    },
    cancel: async () => {
      if (!finalized) await output.cancel();
    },
    codec: selected.codec,
    hasAudio: audioSource !== null,
    finalize: async () => {
      signal.throwIfAborted();
      await feedAudio(Number.POSITIVE_INFINITY);
      audioSource?.close();
      source.close();
      await output.finalize();
      finalized = true;
      if (!target.buffer) throw new Error("Video encoding produced no file.");
      return new Blob([target.buffer], { type: mediaType });
    },
    format: selected.format,
  });
}
