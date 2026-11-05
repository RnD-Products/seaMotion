import * as React from "react";

import {
  getMoRenderStatus,
  subscribeMoRenderStatus,
} from "./mo-render-status";
import styles from "./mo-render-status-control.module.css";

// Shows the result of the last render directly above the sticky Render button.
export function MoRenderStatusControl(): React.ReactNode {
  const status = React.useSyncExternalStore(
    subscribeMoRenderStatus,
    getMoRenderStatus,
    getMoRenderStatus,
  );
  if (!status) return null;
  return (
    <p
      className={status.kind === "error" ? styles.error : styles.status}
      data-mo-render-status={status.kind}
      role={status.kind === "error" ? "alert" : "status"}
    >
      {status.message}
    </p>
  );
}
