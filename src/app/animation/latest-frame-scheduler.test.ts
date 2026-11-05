import { describe, expect, it } from "vitest";

import { LatestFrameScheduler } from "./latest-frame-scheduler";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps one latest pending frame and never delivers stale work under load", async () => {
  const renders: number[] = [];
  const results = new Map<number, ReturnType<typeof deferred<string>>>();
  const delivered: string[] = [];
  const released: string[] = [];
  const skipped: boolean[] = [];
  const scheduler = new LatestFrameScheduler<number, string>(
    (frame) => {
      renders.push(frame);
      const result = deferred<string>();
      results.set(frame, result);
      return result.promise;
    },
    (result) => released.push(result),
    () => 100,
  );

  scheduler.schedule(1, 0.1, (result) => delivered.push(result), (sample) => skipped.push(sample.skipped));
  scheduler.schedule(2, 0.2, (result) => delivered.push(result));
  scheduler.schedule(3, 0.3, (result) => delivered.push(result), (sample) => skipped.push(sample.skipped));
  expect(renders).toEqual([1]);

  results.get(1)?.resolve("frame-1");
  await Promise.resolve();
  await Promise.resolve();
  expect(renders).toEqual([1, 3]);
  expect(delivered).toEqual([]);
  expect(released).toEqual(["frame-1"]);

  results.get(3)?.resolve("frame-3");
  await Promise.resolve();
  await Promise.resolve();
  expect(delivered).toEqual(["frame-3"]);
  expect(skipped).toEqual([true, false]);
  expect(scheduler.getStats()).toEqual({
    delivered: 1,
    failed: 0,
    lastError: "",
    maxPending: 1,
    maxRenderMs: 0,
    replacedPending: 1,
    skippedStale: 1,
    started: 2,
    submitted: 3,
    totalRenderMs: 0,
  });
});

describe("the watchdog", () => {
  it("gives up a picture that never comes back, tells the repairer, and goes on with the next frame", async () => {
    const reasons: string[] = [];
    const delivered: string[] = [];
    const released: string[] = [];
    const settled: boolean[] = [];
    const hung = deferred<string>();
    let calls = 0;
    const scheduler = new LatestFrameScheduler<number, string>(
      (frame) => {
        calls += 1;
        return frame === 1 ? hung.promise : Promise.resolve(`frame-${frame}`);
      },
      (result) => released.push(result),
      () => 0,
      20,
      (reason) => reasons.push(reason),
    );
    scheduler.schedule(1, 0.1, (result) => delivered.push(result), (sample) => settled.push(sample.skipped));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reasons).toHaveLength(1);
    expect(settled).toEqual([true]);
    expect(scheduler.getStats().failed).toBe(1);
    expect(scheduler.getStats().lastError).toContain("took longer");
    // The next frame is drawn although the first never came back.
    scheduler.schedule(2, 0.2, (result) => delivered.push(result));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(delivered).toEqual(["frame-2"]);
    // The picture that finally arrives is thrown away, never shown.
    hung.resolve("frame-1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(released).toEqual(["frame-1"]);
    expect(delivered).toEqual(["frame-2"]);
    expect(calls).toBe(2);
  });

  it("counts a picture that fails and keeps going", async () => {
    const delivered: string[] = [];
    const scheduler = new LatestFrameScheduler<number, string>(
      (frame) => (frame === 1 ? Promise.reject(new Error("no picture")) : Promise.resolve(`frame-${frame}`)),
      () => undefined,
      () => 0,
    );
    scheduler.schedule(1, 0.1, (result) => delivered.push(result));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(scheduler.getStats().lastError).toBe("no picture");
    scheduler.schedule(2, 0.2, (result) => delivered.push(result));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(delivered).toEqual(["frame-2"]);
  });
});
