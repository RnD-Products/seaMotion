import { expect, it } from "vitest";

import { getPreviewMemoryHistory, recordPreviewMemorySample } from "./preview-memory";

it("keeps a bounded session history across playback, scrubbing, and reopen samples", () => {
  const phases = ["playing", "scrubbing", "reopen"] as const;
  for (let index = 0; index < 125; index += 1) {
    recordPreviewMemorySample({
      averageRenderMs: index,
      budgetBytes: 160,
      cacheBytes: index,
      effectBytes: 0,
      evictions: 0,
      heapBytes: null,
      maxRenderMs: index,
      peakBytes: index,
      phase: phases[index % phases.length]!,
      sampledAt: index,
      totalBytes: index,
    });
  }
  const history = getPreviewMemoryHistory();
  expect(history).toHaveLength(120);
  expect(history[0]?.sampledAt).toBe(5);
  expect(new Set(history.map((sample) => sample.phase))).toEqual(new Set(phases));
});
