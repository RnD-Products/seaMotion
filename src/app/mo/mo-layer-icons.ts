import * as React from "react";

import { getActiveAnimation, type AnimationSpec } from "../animation/animation-spec";
import { lottieLayerId } from "../lottie/lottie-data";
import { frameIds, readFigmaDesign } from "./figma-paste-import";

// The Layers panel shows an icon by what a layer is: text, picture, video, box, circle, vector, mask (groups keep their
// arrow). The panel itself is the framework's, so each row gets a `data-mo-kind` and the icon is drawn by a style rule.

const STYLE_ID = "mo-app-layer-icons";
type Kind = "ellipse" | "mask" | "picture" | "rect" | "text" | "vector" | "video";

const svg = (body: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="black" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  )}")`;

const ICONS: Record<Kind, string> = {
  ellipse: svg('<circle cx="128" cy="128" r="84"/>'),
  mask: svg('<circle cx="128" cy="128" r="84"/><path d="M128 44a84 84 0 0 1 0 168z" fill="black"/>'),
  picture: svg('<rect x="40" y="52" width="176" height="152" rx="22"/><circle cx="96" cy="104" r="14" fill="black"/><path d="M40 176l56-52 44 40 28-24 48 44"/>'),
  rect: svg('<rect x="44" y="60" width="168" height="136" rx="22"/>'),
  text: svg('<path d="M60 70h136M128 70v120M104 190h48"/>'),
  vector: svg('<path d="M52 190C80 70 128 70 150 128s44 36 54-62"/><circle cx="52" cy="190" r="14" fill="black"/><circle cx="204" cy="66" r="14" fill="black"/>'),
  video: svg('<rect x="36" y="64" width="184" height="128" rx="22"/><path d="M110 98l52 30-52 30z" fill="black"/>'),
};

const FOLDER_CLOSED = svg('<path d="M32 88a16 16 0 0 1 16-16h48l24 24h88a16 16 0 0 1 16 16v72a16 16 0 0 1-16 16H48a16 16 0 0 1-16-16z"/>');
const FOLDER_OPEN = svg('<path d="M32 192V80a16 16 0 0 1 16-16h48l24 24h72a16 16 0 0 1 16 16v16"/><path d="M32 192l24-72h176l-24 72z"/>');

// A group shows its arrow and then a folder: closed when it is collapsed, open when it is expanded (clicking either opens
// and closes it). The little leftover of the eye and trash buttons is hidden until the row is hovered.
const ARTBOARD = svg('<path d="M96 36v184M160 36v184M36 96h184M36 160h184"/>');
const MAIN_ARTBOARD = svg('<rect x="36" y="48" width="184" height="160" rx="22"/><path d="M110 98l52 30-52 30z" fill="black"/>');
const CHEVRON = svg('<path d="M58 93l70 70 70-70"/>');
const GROUP_RULES = `
span[data-layer-row-icon-hit-area="group"] > svg { display: none !important; }
span[data-layer-row-icon-hit-area="group"] {
  cursor: pointer !important;
  width: auto !important;
  gap: 3px;
}
/* The arrow (down when open, right when closed) comes first, then the folder. */
span[data-layer-row-icon-hit-area="group"]::before {
  content: "";
  width: 12px;
  height: 12px;
  background-color: var(--foreground, #fff);
  opacity: 0.6;
  -webkit-mask: ${CHEVRON} center / contain no-repeat;
  mask: ${CHEVRON} center / contain no-repeat;
}
span[data-layer-row-icon-hit-area="group"][data-layer-row-icon-label^="Expand"]::before { transform: rotate(-90deg); }
span[data-layer-row-icon-hit-area="group"]::after {
  content: "";
  width: 15px;
  height: 15px;
  background-color: var(--foreground, #fff);
  opacity: 0.7;
  -webkit-mask: ${FOLDER_CLOSED} center / contain no-repeat;
  mask: ${FOLDER_CLOSED} center / contain no-repeat;
}
span[data-layer-row-icon-hit-area="group"][data-layer-row-icon-label^="Collapse"]::after {
  -webkit-mask: ${FOLDER_OPEN} center / contain no-repeat;
  mask: ${FOLDER_OPEN} center / contain no-repeat;
}
/* The main artboard layer (the top group of a design, as a frame in Figma) has its own box-with-play icon instead of a folder. */
li[data-template-layer-kind="group"][data-template-layer-depth="0"] span[data-layer-row-icon-hit-area="group"]::after,
li[data-template-layer-kind="group"][data-template-layer-depth="0"] span[data-layer-row-icon-hit-area="group"][data-layer-row-icon-label^="Collapse"]::after {
  -webkit-mask: ${MAIN_ARTBOARD} center / contain no-repeat;
  mask: ${MAIN_ARTBOARD} center / contain no-repeat;
}
/* A frame (a Figma frame or auto layout) has the frame icon too, wherever it is nested. */
li[data-mo-frame="true"]:not([data-template-layer-depth="0"]) span[data-layer-row-icon-hit-area="group"]::after,
li[data-mo-frame="true"]:not([data-template-layer-depth="0"]) span[data-layer-row-icon-hit-area="group"][data-layer-row-icon-label^="Collapse"]::after {
  -webkit-mask: ${ARTBOARD} center / contain no-repeat;
  mask: ${ARTBOARD} center / contain no-repeat;
}
/* The groups and frames around the selected layer have a yellow dashed outline in the panel. */
li[data-mo-parent="true"] [data-layer-row-surface] {
  outline: 1px dashed #facc15;
  outline-offset: -1px;
  border-radius: 6px;
}
/* A selected layer inside a closed group: the closed group that shows says what is inside it, down to the layer. */
li[data-mo-inside] [data-layer-row-surface] > div:first-child::after {
  content: "→ " attr(data-mo-inside);
  margin-left: 8px;
  white-space: nowrap;
  font-size: 10px;
  color: #facc15;
  pointer-events: none;
}
li[data-visible="false"] span[data-layer-row-icon-hit-area="group"]::before,
li[data-visible="false"] span[data-layer-row-icon-hit-area="group"]::after { opacity: 0.3; }
li[data-layer-id]:not(:hover):not(:focus-within):not([data-dragging="true"]) [data-layer-actions] { visibility: hidden; }
`;

const rules = (Object.keys(ICONS) as Kind[])
  .map(
    (kind) => `
li[data-mo-kind="${kind}"] [data-layer-row-surface] > div:first-child > span:first-child > svg { display: none !important; }
li[data-mo-kind="${kind}"] [data-layer-row-surface] > div:first-child > span:first-child::before {
  content: "";
  width: 14px;
  height: 14px;
  background-color: var(--foreground, #fff);
  opacity: 0.6;
  -webkit-mask: ${ICONS[kind]} center / contain no-repeat;
  mask: ${ICONS[kind]} center / contain no-repeat;
}
li[data-mo-kind="${kind}"][data-visible="false"] [data-layer-row-surface] > div:first-child > span:first-child::before { opacity: 0.3; }`,
  )
  .join("\n");

// What each pasted layer is, by its id (layers the design does not draw have no entry and keep the panel's icon).
export function layerKinds(spec: AnimationSpec | null): Record<string, Kind> {
  const out: Record<string, Kind> = {};
  // A Lottie layer's icon follows its type: a picture, a shape, a solid.
  if (spec?.lottie && Array.isArray(spec.lottie.layers)) {
    spec.lottie.layers.forEach((layer, index) => {
      const type = typeof layer === "object" && layer !== null ? (layer as { ty?: unknown }).ty : undefined;
      const kind: Kind | undefined = type === 2 ? "picture" : type === 4 ? "vector" : type === 1 ? "rect" : undefined;
      if (kind) out[lottieLayerId(layer, index)] = kind;
    });
    return out;
  }
  const design = spec ? readFigmaDesign(spec) : null;
  if (!spec || !design) return out;
  for (const block of design.blocks) {
    for (const item of block.items) {
      if (item.isMask) out[item.id] = "mask";
      else if (item.kind === "text") out[item.id] = "text";
      else if (item.pic) out[item.id] = item.pic.files?.some((key) => spec.assetMedia?.[key]?.kind === "video") || item.pic.video ? "video" : "picture";
      else if (item.kind === "png") out[item.id] = "picture";
      else if (item.kind === "svg") out[item.id] = "vector";
      else out[item.id] = item.paths ? "vector" : item.ellipse ? "ellipse" : "rect";
    }
  }
  return out;
}

export function useLayerIcons(values: Readonly<Record<string, unknown>>, layers: readonly Readonly<{ displayName?: string; id: string; name?: string; parentGroupId?: string }>[], activeLayerId: string | null): void {
  const layerCount = layers.length;
  const spec = getActiveAnimation(values);
  const kinds = React.useMemo(() => layerKinds(spec), [spec]);
  const frames = React.useMemo(() => frameIds(spec), [spec]);
  React.useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = rules + GROUP_RULES;
    document.head.append(style);
    return () => style.remove();
  }, []);
  // The groups around the selected layer, outermost first, and the names of the chain down to the layer itself.
  const chain = React.useMemo(() => {
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const ids: string[] = [];
    for (let at = activeLayerId ? byId.get(activeLayerId)?.parentGroupId : undefined, guard = 0; at && guard < 1000; at = byId.get(at)?.parentGroupId, guard += 1) ids.unshift(at);
    const nameOf = (id: string): string => {
      const layer = byId.get(id);
      return (layer?.displayName ?? layer?.name ?? "").trim() || "Layer";
    };
    return { ids, names: [...ids, ...(activeLayerId ? [activeLayerId] : [])].map(nameOf) };
  }, [layers, activeLayerId]);
  React.useEffect(() => {
    let frame = 0;
    const apply = (): void => {
      frame = 0;
      // The group that holds the selected layer is dashed (one row) only while its row is out of sight in the panel (hidden in a closed
      // group, or scrolled out of the list). The deepest group that shows carries a hint of what is inside it.
      let hint: { id: string; text: string } | null = null;
      let dashed = false;
      let dashedId = "";
      const selectedRow = activeLayerId ? document.querySelector<HTMLElement>(`li[data-layer-id="${CSS.escape(activeLayerId)}"]`) : null;
      if (activeLayerId && chain.ids.length > 0) {
        const list = (selectedRow ?? document.querySelector<HTMLElement>("li[data-layer-id]"))?.parentElement?.parentElement ?? null;
        const box = list?.getBoundingClientRect();
        const rect = selectedRow?.getBoundingClientRect();
        const inView = !!(selectedRow && box && rect && rect.bottom > box.top + 4 && rect.top < box.bottom - 4);
        dashed = !inView;
        if (dashed) {
          // One row only: the deepest group of the chain that shows. It is the closed group holding the layer, or (the row being
          // scrolled away) the layer's own group.
          for (let index = chain.ids.length - 1; index >= 0; index -= 1) {
            if (document.querySelector(`li[data-layer-id="${CSS.escape(chain.ids[index] ?? "")}"]`)) {
              dashedId = chain.ids[index] ?? "";
              if (!selectedRow) hint = { id: dashedId, text: chain.names.slice(index + 1).join(" \u203A ") };
              break;
            }
          }
        }
      }
      for (const row of document.querySelectorAll<HTMLElement>("li[data-layer-id]")) {
        // The full name on hover: a deep row's name can run under the eye and trash buttons.
        const rowName = row.getAttribute("aria-label");
        if (rowName && row.title !== rowName) row.title = rowName;
        const isParent = dashed && dashedId !== "" && row.dataset.layerId === dashedId;
        if (isParent) {
          if (row.dataset.moParent !== "true") row.dataset.moParent = "true";
        } else if (row.dataset.moParent) {
          delete row.dataset.moParent;
        }
        if (hint && row.dataset.layerId === hint.id) {
          if (row.dataset.moInside !== hint.text) row.dataset.moInside = hint.text;
          const surface = row.querySelector<HTMLElement>("[data-layer-row-surface] > div:first-child");
          if (surface && surface.dataset.moInside !== hint.text) surface.dataset.moInside = hint.text;
        } else if (row.dataset.moInside !== undefined) {
          delete row.dataset.moInside;
          delete row.querySelector<HTMLElement>("[data-layer-row-surface] > div:first-child")?.dataset.moInside;
        }
        const isFrame = frames.has(row.dataset.layerId ?? "");
        if (isFrame) {
          if (row.dataset.moFrame !== "true") row.dataset.moFrame = "true";
        } else if (row.dataset.moFrame) {
          delete row.dataset.moFrame;
        }
        // A frame's own fill shares its id with the group row; the group keeps its group icon.
        const kind = isFrame ? undefined : kinds[row.dataset.layerId ?? ""];
        if (kind) {
          if (row.dataset.moKind !== kind) row.dataset.moKind = kind;
        } else if (row.dataset.moKind) {
          delete row.dataset.moKind;
        }
      }
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    document.addEventListener("scroll", schedule, true);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", schedule, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chain, frames, kinds, layerCount, activeLayerId]);
}
