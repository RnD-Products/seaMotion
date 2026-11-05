import * as React from "react";

const STYLE_ID = "mo-app-layers-scroll";

// A deeply nested row used to be as wide as its name plus 20 px of indent per level, so the list scrolled sideways and the eye and
// trash buttons (at the right end of the row) were out of sight. Now every row is as wide as the panel: the indent shrinks with depth
// (14 px for the first three levels, 6 px after that) and a name that does not fit ends with "…" before the buttons (the full name is the
// row's tooltip). The buttons are always at the right edge.
const indentRules = (): string => {
  const rules: string[] = [];
  for (let depth = 1; depth <= 60; depth += 1) {
    const indent = 14 * Math.min(depth, 3) + 6 * Math.max(depth - 3, 0);
    rules.push(`li[data-template-layer-depth="${depth}"] [data-layer-row-surface] > div:first-child { margin-left: ${indent}px !important; }`);
  }
  return rules.join("\n");
};

// Tree lines: a thin vertical line under each open parent's arrow runs down through its children, so the parent of a row can be followed
// up the list. A row at depth d has one line for each level above it. Where the children of a group or frame end, the line does not run on:
// it ends at the last child with a rounded corner (paintTree sets each row's background).
const LINE = "rgba(255,255,255,0.22)";
const lineX = (level: number): number => 7 + (level === 1 ? 0 : 14 * Math.min(level - 1, 3) + 6 * Math.max(level - 4, 0)) + 6;
const indentAt = (depth: number): number => 14 * Math.min(depth, 3) + 6 * Math.max(depth - 3, 0);
const RADIUS = 5;

// The background of one row: for each level its line passes through (full height), or ends at (a rounded corner). Where a level's line
// starts (its first child) it starts a little below the row's top with a round cap, so no flat edge shows under the parent.
const START = 3;
function treeBackground(
  ends: ReadonlySet<number>,
  passes: ReadonlySet<number>,
  starts: ReadonlySet<number>,
  width: number,
  height: number,
): string {
  const layers: string[] = [];
  const cy = height / 2;
  let svg = "";
  const path = (d: string): string => `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="1" stroke-linecap="round" shape-rendering="geometricPrecision"/>`;
  for (const level of [...ends].sort((a, b) => a - b)) {
    const x = lineX(level) + 0.5;
    // The line curves into the row with a rounded corner (a quarter circle) and stops there with a round end.
    const r = Math.min(RADIUS, cy);
    svg += path(`M${x} ${starts.has(level) ? START : 0}V${cy - r}A${r} ${r} 0 0 0 ${x + r} ${cy}`);
  }
  const plain: number[] = [];
  for (const level of [...passes].sort((a, b) => a - b)) {
    if (starts.has(level)) svg += path(`M${lineX(level) + 0.5} ${START}V${height}`);
    else plain.push(level);
  }
  if (svg) layers.push(`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${svg}</svg>`)}") 0 0 / ${width}px ${height}px no-repeat`);
  for (const level of plain) layers.push(`linear-gradient(${LINE}, ${LINE}) ${lineX(level)}px 0 / 1px 100% no-repeat`);
  return layers.length ? layers.join(", ") : "none";
}

// Works out, for every row, which level lines pass through it and which end at it, and paints them.
function paintTree(): void {
  const rows = [...document.querySelectorAll<HTMLElement>("li[data-layer-id]")];
  const depths = rows.map((row) => Number(row.dataset.templateLayerDepth) || 0);
  rows.forEach((row, index) => {
    const depth = depths[index] ?? 0;
    const passes = new Set<number>();
    const ends = new Set<number>();
    const starts = new Set<number>();
    for (let level = 1; level <= depth; level += 1) {
      // The first child of a group or frame: the row above it is the parent.
      if (index > 0 && (depths[index - 1] ?? 0) === level - 1) starts.add(level);
      // The next row that is not inside this level's children: if it is another child (same depth) the line goes on, else the children ended.
      let next = index + 1;
      while (next < rows.length && (depths[next] ?? 0) > level) next += 1;
      const continues = next < rows.length && (depths[next] ?? 0) === level;
      if (continues) passes.add(level);
      else if (depth === level) ends.add(level);
    }
    const width = Math.round(row.offsetWidth);
    const height = Math.round(row.offsetHeight) + 2;
    const key = `${depth}|${[...passes].join(",")}|${[...ends].join(",")}|${[...starts].join(",")}|${width}x${height}`;
    if (row.dataset.moTreeKey === key) return;
    row.dataset.moTreeKey = key;
    row.style.setProperty("--mo-tree", treeBackground(ends, passes, starts, width, height));
  });
}

const LAYERS_SCROLL_CSS = `
div:has(> ul > li[data-layer-id]) {
  overflow-x: hidden !important;
}
div > ul:has(> li[data-layer-id]) {
  min-width: 0;
  width: 100%;
}
li[data-layer-id] [data-layer-row-surface] > div:first-child { min-width: 0; }
/* The eye and trash buttons sit over the right end of the row, only while it is hovered (they take no room otherwise, so names keep
   the whole width). */
li[data-layer-id] [data-layer-row-surface] {
  position: relative;
  grid-template-columns: minmax(0, 1fr) !important;
}
/* No trash button on a row (a layer is deleted with the Delete key); the eye stays. */
li[data-layer-id] [data-layer-actions] button[aria-label^="Delete "] { display: none !important; }
li[data-layer-id] [data-layer-actions] {
  position: absolute !important;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 2;
  overflow: visible !important;
  transform: none !important;
  translate: none !important;
  width: auto !important;
  padding-left: 6px;
  padding-right: 4px;
  background: none !important;
}
/* No box behind the buttons (it never matched the row's own fill, whatever its hover or selected colour): while they show, the end of the
   name fades out under them instead. */
li[data-layer-id]:hover [data-layer-row-surface] > div:first-child,
li[data-layer-id]:focus-within [data-layer-row-surface] > div:first-child {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 70px), transparent calc(100% - 46px));
  mask-image: linear-gradient(to right, #000 calc(100% - 70px), transparent calc(100% - 46px));
}
${indentRules()}
/* A row the user clicked away from keeps the runtime's selected fill underneath: it is covered, but the hover fill still shows on it. */
li[data-layer-id][data-deselected] > [data-layer-row-surface] { background-color: transparent !important; }
li[data-layer-id][data-deselected]:hover > [data-layer-row-surface] { background-color: color-mix(in oklab, var(--foreground) 10%, transparent) !important; }
li[data-layer-id] { isolation: isolate; }
li[data-layer-id]::before {
  content: "";
  position: absolute;
  inset: -1px 0;
  z-index: -1;
  pointer-events: none;
}
li[data-layer-id]::before { background: var(--mo-tree, none); }
`;

const indentOf = (depth: number): number => 14 * Math.min(depth, 3) + 6 * Math.max(depth - 3, 0);

// The panel grows with the deepest open row: room for its indent, its icons and a name of about 160 px (never narrower than the normal
// 248 px, never wider than 520 px or 40% of the window). It is the panel's min-width, so dragging its edge still works above that and
// the panel goes back to its own width when the groups are closed.
const BASE_WIDTH = 248;
function fitPanelWidth(): void {
  const rows = [...document.querySelectorAll<HTMLElement>("li[data-layer-id]")];
  const panel = rows[0]?.closest('[data-slot="scroll-fade"]')?.parentElement as HTMLElement | null | undefined;
  if (!panel) {
    document.documentElement.style.removeProperty("--mo-layers-width");
    return;
  }
  const deepest = rows.reduce((max, row) => Math.max(max, Number(row.dataset.templateLayerDepth) || 0), 0);
  const wanted = 7 + indentOf(deepest) + 44 + 160 + 14;
  const limit = Math.max(BASE_WIDTH, Math.min(520, Math.round(window.innerWidth * 0.4)));
  const width = Math.min(limit, Math.max(BASE_WIDTH, wanted));
  const current = panel.style.minWidth;
  // The tab bar above the panel follows it.
  if (width <= BASE_WIDTH) document.documentElement.style.removeProperty("--mo-layers-width");
  else document.documentElement.style.setProperty("--mo-layers-width", `${width}px`);
  if (width <= BASE_WIDTH) {
    if (current) panel.style.minWidth = "";
  } else if (current !== `${width}px`) {
    panel.style.minWidth = `${width}px`;
  }
}

export function useLayersScroll(): void {
  React.useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = LAYERS_SCROLL_CSS;
    document.head.append(style);
    return () => style.remove();
  }, []);
  React.useEffect(() => {
    let frame = 0;
    const schedule = (): void => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          fitPanelWidth();
          paintTree();
        });
      }
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
