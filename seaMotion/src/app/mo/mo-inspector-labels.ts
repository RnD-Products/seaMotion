import * as React from "react";

const APP_SELECTOR = '[data-slot="toolcraft-runtime-app"]';
const INSPECTOR_BUTTONS = '[data-panel-type="controls"] button';

// The settings buttons are Toolcraft's own, with fixed labels, so the new wording is applied
// to the rendered buttons. Save State as Default is hidden.
const RENAMES: Readonly<Record<string, string>> = {
  "Export Settings": "Export project",
  "Import Settings": "Import project",
};
const HIDDEN = "Save State as Default";

function relabel(button: HTMLButtonElement, from: string, to: string): void {
  const walker = button.ownerDocument.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.trim() === from) node.nodeValue = to;
  }
  if (button.getAttribute("aria-label") === from) button.setAttribute("aria-label", to);
}

const PANEL_SECTIONS = '[data-panel-type="controls"] section';

// The framework's Setup (the Open/Export project buttons and Settings) belongs to the Project info
// tab. It is hidden on the other tabs, and the tab selector is kept first in the panel.
// Settings controls the ratio bar and the canvas make redundant: Aspect ratio (with its Ratio W/H
// fields) and the Infinity canvas switch.
const HIDDEN_SETTINGS = [
  '[data-toolcraft-control-target="canvas.aspectRatio"]',
  '[data-toolcraft-control-target="canvas.infinity"]',
  // Background moved to the Modifier tab's BG Setting section; it edits the same values.
  'section:has([data-toolcraft-control-target="export.includeBackground"]) [data-toolcraft-control-target="export.includeBackground"]',
  'section:has([data-toolcraft-control-target="export.includeBackground"]) [data-toolcraft-control-target="appearance.background"]',
];
const CONTROL_ITEM = "[data-control-list] > *";
const MESSAGE_ROWS = '[data-toolcraft-control-target="render.status"]';

// The tabs stay at the top of the panel while the sections scroll, and the scroll bar starts below them: the tab
// section is taken out of the scrolling column and sits in the panel just above it. (It is the first section and is
// always present, so the framework never inserts or removes anything beside it.)
function pinTabs(section: HTMLElement, dividerColor: string): void {
  const scroller = section.parentElement;
  const panel = scroller?.parentElement;
  if (scroller && panel && getComputedStyle(scroller).overflowY === "auto") panel.insertBefore(section, scroller);
  if (section.parentElement?.contains(section) && section.style.flexShrink !== "0") section.style.flexShrink = "0";
  if (dividerColor) section.style.borderBottom = `1px solid ${dividerColor}`;
}

// Lottie: the Export button sits at the end of the Render and Export section. It is a copy of the footer's button (which stays
// hidden) and a click on it presses that one, so the framework still runs the export.
const PROXY_MARK = "data-mo-export-proxy";

function placeExportButton(section: HTMLElement | null, source: HTMLButtonElement | null): void {
  const existing = section?.querySelector<HTMLElement>(`[${PROXY_MARK}]`) ?? null;
  if (!section || !source) {
    existing?.remove();
    return;
  }
  const copy = existing?.querySelector<HTMLButtonElement>("button") ?? null;
  if (copy) {
    copy.disabled = source.disabled;
    return;
  }
  const holder = document.createElement("div");
  holder.setAttribute(PROXY_MARK, "");
  holder.style.padding = "0 16px 16px";
  const button = source.cloneNode(true) as HTMLButtonElement;
  button.removeAttribute(EXPORT_MARK);
  button.style.width = "100%";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    source.click();
  });
  holder.append(button);
  section.append(holder);
}

// The segments the tab selector offers: what is selected decides them (nothing: Project; the artboard: Artboard; a layer: Modifier and Motion).
// The kit rounds only the first and last segment of the list, and the hidden ones still count, so the corners are set here on the ones shown.
function showSegments(root: ParentNode, visible: readonly string[]): void {
  const shown: HTMLElement[] = [];
  for (const trigger of root.querySelectorAll<HTMLElement>('[data-panel-type="controls"] [data-slot="tabs-trigger"]')) {
    const label = trigger.textContent?.trim() ?? "";
    const known = label === "Project" || label === "Artboard" || label === "Modifier" || label === "Motion";
    if (!known) continue;
    const show = visible.includes(label);
    const display = show ? "" : "none";
    if (trigger.style.display !== display) trigger.style.display = display;
    if (show) shown.push(trigger);
  }
  shown.forEach((trigger, index) => {
    const radius = `${index === 0 ? "6px" : "0"} ${index === shown.length - 1 ? "6px" : "0"} ${index === shown.length - 1 ? "6px" : "0"} ${index === 0 ? "6px" : "0"}`;
    if (trigger.style.borderRadius !== radius) trigger.style.borderRadius = radius;
    // The kit draws the stroke between segments as a left line on each one and the closing right line on the last of all four, which
    // is hidden, so the last one shown gets its right line and the first one its left line here.
    const line = getComputedStyle(trigger).borderLeftColor;
    if (index === 0 && trigger.style.borderLeftWidth !== "1px") {
      trigger.style.borderLeftStyle = "solid";
      trigger.style.borderLeftWidth = "1px";
      trigger.style.borderLeftColor = line;
    }
    if (index === shown.length - 1 && trigger.style.borderRightWidth !== "1px") {
      trigger.style.borderRightStyle = "solid";
      trigger.style.borderRightWidth = "1px";
      trigger.style.borderRightColor = line;
    }
  });
}

function applyTabs(root: ParentNode, tab: string, exporting: boolean, visible: readonly string[]): void {
  showSegments(root, visible);
  for (const selector of HIDDEN_SETTINGS) {
    for (const control of root.querySelectorAll<HTMLElement>(`[data-panel-type="controls"] ${selector}`)) {
      if (control.style.display !== "none") control.style.display = "none";
    }
  }
  // A double divider sets the bottom sticky item apart from the top one.
  const bottomItem = root.querySelector<HTMLElement>('[data-toolcraft-control-target="sticky.bottom.type"]')?.closest<HTMLElement>(CONTROL_ITEM);
  if (bottomItem && bottomItem.dataset.stickyDivider === undefined) {
    bottomItem.dataset.stickyDivider = "";
    bottomItem.style.borderTop = "3px double color-mix(in oklab, var(--foreground) 14%, transparent)";
    bottomItem.style.paddingTop = "14px";
    bottomItem.style.marginTop = "4px";
  }
  // A list item whose controls are all hidden would still take a row and a gap, so it is hidden too.
  for (const item of root.querySelectorAll<HTMLElement>(`[data-panel-type="controls"] ${CONTROL_ITEM}`)) {
    const controls = [...item.querySelectorAll<HTMLElement>("[data-toolcraft-control-target]")];
    if (controls.length > 0 && controls.every((control) => control.style.display === "none") && item.style.display !== "none") {
      item.style.display = "none";
    }
  }
  // Message rows (the last render's result) are empty until there is something to say; an empty one would
  // still take a row and a gap above the footer buttons.
  for (const control of root.querySelectorAll<HTMLElement>(`[data-panel-type="controls"] ${MESSAGE_ROWS}`)) {
    const item = control.closest<HTMLElement>(CONTROL_ITEM) ?? control.parentElement;
    if (!item) continue;
    const empty = (control.textContent ?? "").trim() === "";
    const display = empty ? "none" : "";
    if (item.style.display !== display) item.style.display = display;
  }
  let dividerColor = "";
  // The "Motion Controller" title row is gone: the tabs take its place at the top of the panel.
  for (const header of root.querySelectorAll<HTMLElement>('[data-panel-type="controls"] [data-slot="properties-panel-header"]')) {
    const shell = header.parentElement?.classList.contains("properties-panel-header-shell") ? header.parentElement : header;
    shell.style.display = "none";
    // The body's top border sat under that title row; with the row gone it would be a stray edge above the tabs.
    const body = root.querySelector<HTMLElement>('[data-panel-type="controls"] div[class*="border-t"]');
    if (body) {
      const color = getComputedStyle(body).borderTopColor;
      if (body.style.borderTopWidth !== "0px") {
        body.dataset.dividerColor = color;
        body.style.borderTopWidth = "0px";
      }
      dividerColor = body.dataset.dividerColor ?? color;
    }
  }
  let exportButton: HTMLButtonElement | null = null;
  let exportSection: HTMLElement | null = null;
  for (const section of root.querySelectorAll<HTMLElement>(PANEL_SECTIONS)) {
    const headerRow = section.firstElementChild instanceof HTMLElement && section.firstElementChild.classList.contains("h-9")
      ? section.firstElementChild
      : null;
    const header = headerRow?.textContent?.trim() ?? "";
    if (header === "Inspector") {
      section.style.order = "-1";
      // It is first on screen now, so it takes the first section's place without a top border.
      section.style.borderTopWidth = "0px";
      // Its control list keeps the 24px bottom padding of an ordinary section; the tabs need less.
      const list = section.querySelector<HTMLElement>("[data-control-list]");
      if (list) {
        // The segment sits 13px from the left, right, top and bottom edges of the panel (the left and right are the panel's own padding).
        list.style.paddingTop = "12px";
        list.style.paddingBottom = "12px";
      }
      // The tab selector is the section's whole content, so its title row is redundant.
      if (headerRow) headerRow.style.display = "none";
      pinTabs(section, dividerColor);
      continue;
    }
    const text = section.textContent ?? "";
    const isSetup = header === "Settings" || (header === "" && text.includes("Import project"));
    if (isSetup) section.style.display = tab === "project" ? "" : "none";
    // A divider separates the tabs from the Import project and Export project buttons.
    if (header === "" && text.includes("Import project") && dividerColor) section.style.borderTop = `1px solid ${dividerColor}`;
    // The sticky Render button is part of Project info too. The framework merges the sticky actions
    // and ignores their applicability, so it is hidden here with its action bar.
    const isRenderBar =
      header === "" &&
      !text.includes("Import project") &&
      section.querySelector('[data-slot="panel-actions"]') !== null &&
      [...section.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Render" || button.hasAttribute(EXPORT_MARK));
    if (isRenderBar) {
      const bar = section.parentElement?.children.length === 1 ? section.parentElement : section;
      // A Lottie export has its button inside the Render and Export section (below), so the footer bar stays hidden.
      bar.style.display = tab === "artboard" && !exporting ? "" : "none";
      exportButton = section.querySelector<HTMLButtonElement>(`button[${EXPORT_MARK}]`);
    }
    if (header === "Render and Export") exportSection = section;
  }
  placeExportButton(exportSection, exporting ? exportButton : null);
}

// The footer's Render button reads Export while Render and Export's Format is Lottie (it then exports the
// Lottie file). Marked so only that button is turned back.
const EXPORT_MARK = "data-mo-render-export";

function applyRenderLabel(button: HTMLButtonElement, label: string, exporting: boolean): void {
  if (exporting && label === "Render" && button.closest('[data-slot="panel-actions"]')) {
    relabel(button, "Render", "Export");
    button.setAttribute(EXPORT_MARK, "");
  } else if (!exporting && button.hasAttribute(EXPORT_MARK)) {
    relabel(button, "Export", "Render");
    button.removeAttribute(EXPORT_MARK);
  }
}

function apply(root: ParentNode, tab: string, exporting: boolean, visible: readonly string[]): void {
  applyTabs(root, tab, exporting, visible);
  for (const button of root.querySelectorAll<HTMLButtonElement>(INSPECTOR_BUTTONS)) {
    const label = button.textContent?.trim() ?? "";
    applyRenderLabel(button, label, exporting);
    const renamed = RENAMES[label];
    if (renamed) relabel(button, label, renamed);
    if (label === HIDDEN || button.getAttribute("aria-label") === HIDDEN) {
      // Hide its whole row so no empty gap is left.
      const row = button.closest<HTMLElement>('[data-slot="panel-actions"]') ?? button;
      row.style.display = "none";
    }
  }
}

// A double click on a section header opens a collapsed section and closes an open one. The title is
// itself the "Toggle" button, so the two clicks of a double click have toggled it twice already; the
// double click then toggles it once more, which leaves it flipped from where it started.
export function useSectionDoubleClickExpand(): void {
  React.useEffect(() => {
    const onDoubleClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return;
      const section = event.target.closest<HTMLElement>('[data-panel-type="controls"] section');
      const header = section?.firstElementChild;
      if (!section || !(header instanceof HTMLElement) || !header.contains(event.target)) return;
      // The reset and collapse buttons are left alone.
      const button = event.target.closest("button");
      if (button && !(button.getAttribute("aria-label") ?? "").startsWith("Toggle")) return;
      header.querySelector<HTMLButtonElement>('button[aria-label^="Toggle"]')?.click();
    };
    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, []);
}

// The section a view is about opens when the view opens: Settings in the Settings view, Artboard setting in the Artboard view.
function openMainSection(tab: string): void {
  const title = tab === "project" ? "Settings" : tab === "artboard" ? "Artboard setting" : null;
  if (!title) return;
  for (const section of document.querySelectorAll<HTMLElement>(PANEL_SECTIONS)) {
    const header = section.firstElementChild instanceof HTMLElement ? section.firstElementChild.textContent?.trim() ?? "" : "";
    if (header.toLowerCase() !== title.toLowerCase()) continue;
    const toggle = section.querySelector<HTMLButtonElement>('button[aria-label^="Toggle"][aria-expanded]');
    if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
  }
}

export function useInspectorLabels(tab: string, exporting = false, visible: readonly string[] = ["Project", "Artboard", "Modifier", "Motion"]): void {
  const visibleKey = visible.join("|");
  React.useEffect(() => {
    const timer = window.setTimeout(() => openMainSection(tab), 250);
    return () => window.clearTimeout(timer);
  }, [tab]);
  React.useEffect(() => {
    // The whole page is watched (the app may not be drawn yet when this runs), so the inspector is adjusted whenever it is drawn.
    const root: ParentNode = document;
    let frame = 0;
    // A timeout, not an animation frame: frames are paused while the page is in a background tab or a hidden pane.
    const schedule = (): void => {
      window.clearTimeout(frame);
      frame = window.setTimeout(() => apply(root, tab, exporting, visible), 16);
    };
    apply(root, tab, exporting, visible);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // The framework draws parts of the inspector a moment later and in steps; the page is also checked on a short timer.
    const timer = window.setInterval(schedule, 400);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(frame);
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, exporting, visibleKey]);
}
