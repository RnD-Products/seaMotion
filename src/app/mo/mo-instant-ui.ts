import * as React from "react";

const STYLE_ID = "mo-app-instant-ui";

// Every switch, tab, section, menu and popup in the app changes at once: no transition, animation
// or delay. The framework styles all of those with CSS, so one rule covers them, including popups
// that render outside the app element.
const INSTANT_CSS = `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  scroll-behavior: auto !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
}
`;

export function useInstantUi(): void {
  React.useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = INSTANT_CSS;
    document.head.append(style);
    return () => style.remove();
  }, []);
}
