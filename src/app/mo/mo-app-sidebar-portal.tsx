import * as React from "react";
import { createPortal } from "react-dom";

import { MoAppSidebar } from "./mo-app-sidebar";

// The project sidebar lives outside the zoomed canvas world, inside the runtime app element so
// it inherits the same theme tokens as the inspector.
export function MoAppSidebarPortal({
  canvasRef,
}: {
  canvasRef: React.RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    setHost(canvasRef.current?.closest<HTMLElement>('[data-slot="toolcraft-runtime-app"]') ?? null);
  }, [canvasRef]);
  return host ? createPortal(<MoAppSidebar />, host) : null;
}
