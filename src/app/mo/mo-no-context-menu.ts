import * as React from "react";

// The browser's right-click menu (Copy, Select All) is not used by the app: it is turned off everywhere except in a text field, where Copy,
// Paste and the like are wanted.
export function useNoContextMenu(): void {
  React.useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
}
