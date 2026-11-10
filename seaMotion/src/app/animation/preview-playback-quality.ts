import type { LatestFrameSample } from "./latest-frame-scheduler";

export type PreviewPlaybackQuality = Readonly<{
  factor: 0.5 | 0.75 | 1;
  slowSamples: number;
  targetFps: 30 | 60;
}>;

export const FULL_PREVIEW_QUALITY: PreviewPlaybackQuality = {
  factor: 1,
  slowSamples: 0,
  targetFps: 60,
};

const SLOW_FRAME_MS = 34;
const SLOW_SAMPLES_BEFORE_REDUCING = 6;

// Quality only steps down during one playback run. Pausing restores full quality. This
// one-way policy prevents a borderline device from continually switching resolutions.
export function nextPreviewPlaybackQuality(
  current: PreviewPlaybackQuality,
  isPlaying: boolean,
  sample?: LatestFrameSample,
): PreviewPlaybackQuality {
  if (!isPlaying) return FULL_PREVIEW_QUALITY;
  if (!sample) return current;
  const slow = sample.skipped || sample.renderMs > SLOW_FRAME_MS;
  // Let isolated good frames reduce pressure gradually instead of erasing a sustained
  // backlog signal. This still ignores occasional spikes but reacts to a busy renderer.
  const slowSamples = slow ? current.slowSamples + 1 : Math.max(0, current.slowSamples - 1);
  if (slowSamples < SLOW_SAMPLES_BEFORE_REDUCING || current.factor === 0.5) {
    return slowSamples === current.slowSamples ? current : { ...current, slowSamples };
  }
  return {
    factor: current.factor === 1 ? 0.75 : 0.5,
    slowSamples: 0,
    targetFps: 30,
  };
}

export function shouldSubmitPreviewFrame(lastSubmittedMs: number, nowMs: number, targetFps: 30 | 60): boolean {
  return lastSubmittedMs < 0 || nowMs - lastSubmittedMs >= 1000 / targetFps - 1;
}
