import * as React from "react";

import { getRenderedPreviewStatus, subscribeRenderedPreview } from "./rendered-preview";
import { getPreviewMemoryHistory, getPreviewMemorySample, subscribePreviewMemory } from "./preview-memory";
import styles from "../mo/mo-render-status-control.module.css";

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

export function RenderedPreviewStatusControl(): React.ReactNode {
  const status = React.useSyncExternalStore(subscribeRenderedPreview, getRenderedPreviewStatus, getRenderedPreviewStatus);
  const memory = React.useSyncExternalStore(subscribePreviewMemory, getPreviewMemorySample, getPreviewMemorySample);
  const history = React.useSyncExternalStore(subscribePreviewMemory, getPreviewMemoryHistory, getPreviewMemoryHistory);
  return (
    <div>
      {memory ? (
        <p className={styles.status} data-preview-memory-phase={memory.phase} data-preview-memory-samples={history.length}>
          Preview cache {mb(memory.totalBytes)}{memory.budgetBytes ? ` / ${mb(memory.budgetBytes)}` : ""} · peak {mb(memory.peakBytes)} · {memory.evictions} evictions
          {` · render avg ${memory.averageRenderMs.toFixed(1)} ms`}
          {memory.heapBytes !== null ? ` · JS heap ${mb(memory.heapBytes)}` : ""}
        </p>
      ) : null}
      {status ? (
        <p className={status.kind === "error" ? styles.error : styles.status} data-rendered-preview-status={status.kind} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
