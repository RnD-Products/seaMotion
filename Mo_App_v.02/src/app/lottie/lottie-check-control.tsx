import * as React from "react";
import { useToolcraftSelector } from "@/toolcraft/runtime/react";

import { getActiveAnimation } from "../animation/animation-spec";
import styles from "./lottie-check-control.module.css";
import { lottieInfo } from "./lottie-data";
import { getLottieExportStatus, LOTTIE_FORMAT_TARGET, readLottieFormat, subscribeLottieExportStatus, toDotLottie } from "./lottie-export";
import { checkLottieExport, getProjectLottie, type LottieIssue } from "./lottie-support";

const WHERE_LIMIT = 3;

function describeWhere(where: readonly string[] | undefined): string {
  if (!where || where.length === 0) return "";
  const shown = where.slice(0, WHERE_LIMIT).join(", ");
  return where.length > WHERE_LIMIT ? `${shown} and ${where.length - WHERE_LIMIT} more` : shown;
}

function useLottieIssues(): readonly LottieIssue[] {
  const values = useToolcraftSelector((state) => state.values);
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  return React.useMemo(() => checkLottieExport(values, durationSeconds), [values, durationSeconds]);
}

// Everything the Lottie file cannot carry, in red, with why and what to do; or a short line saying the
// whole project exports.
function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// The size the file will have for the chosen file type (the animation as the project holds it; a hidden layer or a background layer
// changes it a little).
function useFileSize(data: ReturnType<typeof getProjectLottie>, format: ReturnType<typeof readLottieFormat>, on: boolean): number | null {
  return React.useMemo(() => {
    if (!on || !data) return null;
    const plain = data as Record<string, unknown>;
    return format === "lottie" ? toDotLottie(plain, "animation").byteLength : new TextEncoder().encode(JSON.stringify(plain)).byteLength;
  }, [data, format, on]);
}

function LottieIssues({ issues, showSize = false }: Readonly<{ issues: readonly LottieIssue[]; showSize?: boolean }>): React.ReactNode {
  const values = useToolcraftSelector((state) => state.values);
  const data = getProjectLottie(getActiveAnimation(values));
  const info = data ? lottieInfo(data) : null;
  const format = readLottieFormat(values[LOTTIE_FORMAT_TARGET]);
  const size = useFileSize(data, format, showSize && issues.length === 0);
  if (issues.length === 0) {
    return (
      <p className={styles.ok} data-lottie-check="ok">
        Everything in this project exports to Lottie
        {info ? ` (${info.width}×${info.height}, ${info.fps} fps, ${info.durationSeconds.toFixed(2)} s).` : "."}
        {size === null ? null : ` File size: about ${formatBytes(size)} as ${format === "lottie" ? "dotLottie" : "JSON"}.`}
      </p>
    );
  }
  return (
    <ul aria-label="Not supported in Lottie" className={styles.check} data-lottie-check="issues">
      {issues.map((issue) => {
        const where = describeWhere(issue.where);
        return (
          <li className={styles.issue} data-lottie-issue={issue.id} key={issue.id} role="alert">
            <span className={styles.title}>{issue.title}{issue.blocking ? " (cannot export)" : " (left out)"}:</span> {issue.why}{" "}
            <span className={styles.title}>What to do:</span> {issue.fix}
            {where ? <span className={styles.where}>In: {where}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// Under Motion Type: the check only.
export function LottieCheckControl(): React.ReactNode {
  return <LottieIssues issues={useLottieIssues()} />;
}

// Render and Export with Format Lottie: the check and the result of the last export. The footer's
// Render button reads Export then and runs the export (app-composition.tsx).
export function LottieExportControl(): React.ReactNode {
  const issues = useLottieIssues();
  const status = React.useSyncExternalStore(subscribeLottieExportStatus, getLottieExportStatus, getLottieExportStatus);
  return (
    <div className={styles.export}>
      <LottieIssues issues={issues} showSize />
      {status ? (
        <p className={status.kind === "error" ? styles.error : styles.status} data-lottie-export-status={status.kind} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
