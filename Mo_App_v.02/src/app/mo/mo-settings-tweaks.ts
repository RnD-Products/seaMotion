import * as React from "react";

const CONTROLS = '[data-panel-type="controls"]';
const ADVANCED_ATTR = "data-mo-advanced";

// The Timeline switch is not shown (the timeline stays on), and the Resolution scale slider sits in an "Advanced" fold at the end of the
// Settings section. Both are the framework's own controls, so the page is adjusted after they are drawn: the rows are found by their labels.
let advancedOpen = false;

function rowOf(label: Element, list: Element): HTMLElement | null {
  let at: Element | null = label;
  while (at && at.parentElement !== list) at = at.parentElement;
  return at instanceof HTMLElement ? at : null;
}

function labelsWith(section: Element, text: string): Element[] {
  return [...section.querySelectorAll("*")].filter((element) => element.children.length === 0 && element.textContent?.trim() === text);
}

function buildAdvanced(onToggle: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.setAttribute(ADVANCED_ATTR, "");
  // Pulled up under the Workspace field and down toward the section's end: the list's own gaps are too wide for a single closed row.
  wrap.style.cssText = "margin:-18px 0 -18px;";
  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText =
    "display:flex;width:100%;align-items:center;justify-content:space-between;height:24px;padding:0 12px;border:0;box-sizing:border-box;background:none;color:var(--muted-foreground);font-size:12px;cursor:pointer;";
  const label = document.createElement("span");
  label.textContent = "Advanced";
  const caret = document.createElement("span");
  caret.dataset.caret = "";
  caret.style.cssText = "font-size:10px;";
  button.append(label, caret);
  button.addEventListener("click", onToggle);
  wrap.append(button);
  return wrap;
}

function sync(): void {
  const panel = document.querySelector(CONTROLS);
  if (!panel) return;
  const section = [...panel.querySelectorAll("section")].find((item) => /^settings/i.test(item.textContent?.trim() ?? ""));
  if (!section) return;
  const timeline = labelsWith(section, "Timeline")[0];
  const scale = labelsWith(section, "Resolution scale")[0];
  const anchor = timeline ?? scale;
  if (!anchor) return;
  // The list the rows are in: the nearest ancestor that lists several controls.
  let list: Element | null = anchor.parentElement;
  while (list && !(list.className.toString().includes("flex-col") && list.children.length > 2)) list = list.parentElement;
  if (!list) return;
  const timelineRow = timeline ? rowOf(timeline, list) : null;
  if (timelineRow) timelineRow.style.display = "none";
  const scaleRow = scale ? rowOf(scale, list) : null;
  if (!scaleRow) return;
  let fold = list.querySelector<HTMLElement>(`[${ADVANCED_ATTR}]`);
  if (!fold) {
    fold = buildAdvanced(() => {
      advancedOpen = !advancedOpen;
      sync();
    });
    list.insertBefore(fold, scaleRow);
  } else if (fold.nextElementSibling !== scaleRow) {
    list.insertBefore(fold, scaleRow);
  }
  const caret = fold.querySelector<HTMLElement>("[data-caret]");
  if (caret) caret.textContent = advancedOpen ? "▲" : "▼";
  scaleRow.style.display = advancedOpen ? "" : "none";
}

// Keeps those changes in place while the inspector is drawn again.
export function useSettingsTweaks(): void {
  React.useEffect(() => {
    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
}
