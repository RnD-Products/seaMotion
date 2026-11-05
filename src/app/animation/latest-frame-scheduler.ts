export type LatestFrameSample = Readonly<{
  renderMs: number;
  skipped: boolean;
  timeSeconds: number;
}>;

export type LatestFrameStats = Readonly<{
  delivered: number;
  // Pictures that failed or took longer than the watchdog allows, and the last reason.
  failed: number;
  lastError: string;
  maxPending: number;
  maxRenderMs: number;
  replacedPending: number;
  skippedStale: number;
  started: number;
  submitted: number;
  totalRenderMs: number;
}>;

type ScheduledFrame<TFrame, TResult> = Readonly<{
  frame: TFrame;
  onResult: (result: TResult) => void;
  onSettled?: (sample: LatestFrameSample) => void;
  revision: number;
  timeSeconds: number;
}>;

// Runs one render and retains only one replaceable pending frame. A finished result is
// discarded when a newer frame arrived while it was rendering, so elapsed-time playback
// never flashes an obsolete scroll position.
export class LatestFrameScheduler<TFrame, TResult> {
  private disposed = false;
  private latest: ScheduledFrame<TFrame, TResult> | null = null;
  private nextRevision = 1;
  private running = false;
  private stats: LatestFrameStats = {
    delivered: 0,
    failed: 0,
    lastError: "",
    maxPending: 0,
    maxRenderMs: 0,
    replacedPending: 0,
    skippedStale: 0,
    started: 0,
    submitted: 0,
    totalRenderMs: 0,
  };

  constructor(
    private readonly render: (frame: TFrame) => Promise<TResult>,
    private readonly release: (result: TResult) => void,
    private readonly now: () => number = () => performance.now(),
    // A picture that has not come back after this long is given up (the preview never waits on one forever), and `onFailure`
    // hears why so it can repair what the picture depends on.
    private readonly timeoutMs: number = 6000,
    private readonly onFailure?: (reason: string) => void,
  ) {}

  schedule(
    frame: TFrame,
    timeSeconds: number,
    onResult: (result: TResult) => void,
    onSettled?: (sample: LatestFrameSample) => void,
  ): void {
    if (this.disposed) return;
    const revision = this.nextRevision;
    this.nextRevision += 1;
    this.stats = {
      ...this.stats,
      maxPending: 1,
      replacedPending: this.stats.replacedPending + (this.latest ? 1 : 0),
      submitted: this.stats.submitted + 1,
    };
    this.latest = { frame, onResult, onSettled, revision, timeSeconds };
    if (!this.running) void this.drain();
  }

  getStats(): LatestFrameStats {
    return { ...this.stats };
  }

  dispose(): void {
    this.disposed = true;
    this.latest = null;
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.latest && !this.disposed) {
        const current = this.latest;
        this.latest = null;
        this.stats = { ...this.stats, started: this.stats.started + 1 };
        const startedAt = this.now();
        const attempt = this.render(current.frame);
        let result: TResult;
        try {
          result = await this.withWatchdog(attempt);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.stats = { ...this.stats, failed: this.stats.failed + 1, lastError: reason };
          // A picture that comes back after it was given up is never shown.
          void attempt.then((late) => this.release(late), () => undefined);
          try {
            this.onFailure?.(reason);
          } catch {
            // Repairing is best effort.
          }
          current.onSettled?.({ renderMs: Math.max(0, this.now() - startedAt), skipped: true, timeSeconds: current.timeSeconds });
          continue;
        }
        const renderMs = Math.max(0, this.now() - startedAt);
        this.stats = {
          ...this.stats,
          maxRenderMs: Math.max(this.stats.maxRenderMs, renderMs),
          totalRenderMs: this.stats.totalRenderMs + renderMs,
        };
        const skipped = this.disposed || this.hasNewerRevision(current.revision);
        if (skipped) {
          this.stats = { ...this.stats, skippedStale: this.stats.skippedStale + 1 };
          this.release(result);
        } else {
          this.stats = { ...this.stats, delivered: this.stats.delivered + 1 };
          current.onResult(result);
        }
        current.onSettled?.({ renderMs, skipped, timeSeconds: current.timeSeconds });
      }
    } catch {
      // Anything unexpected leaves the previous picture on screen; a newer pending frame retries.
    } finally {
      this.running = false;
      if (this.latest && !this.disposed) void this.drain();
    }
  }

  private withWatchdog(attempt: Promise<TResult>): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => reject(new Error(`A picture took longer than ${this.timeoutMs} ms.`)), this.timeoutMs);
      attempt.then(
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

  private hasNewerRevision(revision: number): boolean {
    return this.latest !== null && this.latest.revision > revision;
  }
}
