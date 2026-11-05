import { DotsSixVertical, Plus, X } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

import { useActiveLayerId } from "../mo/mo-layer-selection";
import {
  ANIMATION_LIBRARY_TARGET,
  getActiveAnimation,
  getLayerImageAssets,
  readAnimationLibrary,
  type AnimationSpec,
} from "./animation-spec";
import styles from "./layer-images.module.css";
import { FieldError } from "@/toolcraft/ui";
import { makeMediaPoster, mediaKindOf, readMediaFile, withAnimatedPicture, withoutAnimatedPicture } from "../media/media-layer";

// Pictures can be still images, or an MP4, WebM or GIF that plays in the picture's place.
const PICTURE_ACCEPT = "image/*,video/mp4,video/webm,.mp4,.webm,.gif";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

// An image's id is its layer's name plus a number that no other asset uses.
function newAssetId(spec: AnimationSpec, taken: ReadonlySet<string>, base: string): string {
  for (let index = 1; ; index += 1) {
    const id = `${base}-${index}`;
    if (!spec.assets[id] && !taken.has(id)) return id;
  }
}

// The images of the layer being edited, as a thumbnail grid: drag to reorder, × to remove, + to add.
// They are the animation's own images, so edits redraw the canvas and travel with the project file.
export function LayerImages({ dispatch, state }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const spec = getActiveAnimation(state.values);
  const layerId = useActiveLayerId(state.selectedLayerId);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!spec || !layerId) return null;
  const names = getLayerImageAssets(spec, layerId);
  if (names.length === 0) return null;
  const replaceMode = spec.layerImages !== undefined;

  const write = (next: Pick<AnimationSpec, "assets" | "imageAssets">, label: string): void => {
    const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
    dispatch({
      label,
      target: ANIMATION_LIBRARY_TARGET,
      type: "controls.setValue",
      value: { items: { ...library.items, [spec.id]: { ...spec, ...next } } },
    });
  };
  // The layer's images keep the places they already had among the animation's images.
  const places = spec.imageAssets.flatMap((name, index) => (names.includes(name) ? [index] : []));

  // A page painted layer by layer: a picture is swapped in place (same name), and the drawing reloads.
  // A video or GIF keeps its first frame as the picture and plays in its place.
  const replace = async (name: string, file: File): Promise<void> => {
    setError(null);
    let next: AnimationSpec;
    try {
      if (mediaKindOf(file)) {
        const info = await readMediaFile(file);
        next = withAnimatedPicture(withoutAnimatedPicture(spec, name), name, info, await makeMediaPoster(info));
      } else if (file.type.startsWith("image/")) {
        const still = withoutAnimatedPicture(spec, name);
        next = { ...still, assets: { ...still.assets, [name]: await readFile(file) }, version: spec.version + 1 };
      } else return;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not use that file.");
      return;
    }
    const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
    dispatch({
      label: "Replace layer image",
      target: ANIMATION_LIBRARY_TARGET,
      type: "controls.setValue",
      value: { items: { ...library.items, [spec.id]: next } },
    });
  };

  const remove = (name: string): void => {
    const still = withoutAnimatedPicture(spec, name);
    const { [name]: _removed, ...assets } = still.assets;
    const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
    dispatch({
      label: "Remove layer image",
      target: ANIMATION_LIBRARY_TARGET,
      type: "controls.setValue",
      value: { items: { ...library.items, [spec.id]: { ...still, assets, imageAssets: spec.imageAssets.filter((item) => item !== name) } } },
    });
  };
  const move = (from: string, to: string): void => {
    if (from === to) return;
    const order = [...names];
    order.splice(order.indexOf(to), 0, ...order.splice(order.indexOf(from), 1));
    const imageAssets = [...spec.imageAssets];
    places.forEach((place, index) => {
      imageAssets[place] = order[index] ?? imageAssets[place] ?? "";
    });
    write({ assets: spec.assets, imageAssets }, "Reorder layer images");
  };
  const add = async (files: FileList): Promise<void> => {
    setError(null);
    const base = (names[0] ?? "image").replace(/-?\d+$/, "");
    let next: AnimationSpec = { ...spec, assets: { ...spec.assets } };
    const added: string[] = [];
    const taken = new Set<string>();
    for (const file of Array.from(files)) {
      const isMedia = mediaKindOf(file) !== null;
      if (!isMedia && !file.type.startsWith("image/")) continue;
      const id = newAssetId(spec, taken, base);
      taken.add(id);
      try {
        if (isMedia) {
          const info = await readMediaFile(file);
          next = withAnimatedPicture(next, id, info, await makeMediaPoster(info));
        } else {
          next = { ...next, assets: { ...next.assets, [id]: await readFile(file) } };
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not use that file.");
        continue;
      }
      added.push(id);
    }
    if (added.length === 0) return;
    const imageAssets = [...spec.imageAssets];
    imageAssets.splice((places.at(-1) ?? imageAssets.length - 1) + 1, 0, ...added);
    const library = readAnimationLibrary(state.values[ANIMATION_LIBRARY_TARGET]);
    dispatch({
      label: "Add layer images",
      target: ANIMATION_LIBRARY_TARGET,
      type: "controls.setValue",
      value: { items: { ...library.items, [spec.id]: { ...next, imageAssets, version: spec.version + 1 } } },
    });
  };
  // A small label on pictures that play a video or GIF.
  const badge = (name: string, atTop = false): React.ReactNode => {
    const media = spec.assetMedia?.[name];
    return media ? <span className={atTop ? `${styles.kind} ${styles.kindTop}` : styles.kind}>{media.kind === "gif" ? "GIF" : "Video"}</span> : null;
  };

  if (replaceMode) {
    return (
      <div className={styles.root}>
        <div className={styles.grid}>
          {names.map((name) => (
            <div className={styles.tile} key={name} style={{ cursor: "pointer" }} title="Click to replace this picture">
              <img alt={name} className={styles.image} src={spec.assets[name]} />
              {badge(name, true)}
              <span style={{ background: "rgba(0,0,0,0.55)", bottom: 0, color: "#fff", fontSize: 10, left: 0, padding: "2px 0", position: "absolute", right: 0, textAlign: "center" }}>Replace</span>
              <button
                aria-label={`Replace ${name}`}
                className={styles.add}
                onClick={() => {
                  setReplacing(name);
                  input.current?.click();
                }}
                style={{ inset: 0, opacity: 0, position: "absolute" }}
                type="button"
              />
            </div>
          ))}
        </div>
        <input
          accept={PICTURE_ACCEPT}
          className={styles.input}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && replacing) void replace(replacing, file);
            event.target.value = "";
            setReplacing(null);
          }}
          ref={input}
          type="file"
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {names.map((name) => (
          <div
            className={styles.tile}
            data-dragging={dragging === name}
            data-over={over === name && dragging !== null && dragging !== name}
            draggable
            key={name}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(name);
            }}
            onDragStart={() => setDragging(name)}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging) move(dragging, name);
              setDragging(null);
              setOver(null);
            }}
          >
            <img alt={name} className={styles.image} src={spec.assets[name]} />
            {badge(name)}
            <span aria-hidden className={`${styles.badge} ${styles.handle}`}>
              <DotsSixVertical size={12} weight="bold" />
            </span>
            <button aria-label={`Remove ${name}`} className={`${styles.badge} ${styles.remove}`} onClick={() => remove(name)} type="button">
              <X size={12} weight="bold" />
            </button>
          </div>
        ))}
        <button aria-label="Add images" className={styles.add} onClick={() => input.current?.click()} type="button">
          <Plus size={16} />
        </button>
      </div>
      <input
        accept={PICTURE_ACCEPT}
        className={styles.input}
        multiple
        onChange={(event) => {
          const files = event.target.files;
          if (files) void add(files);
          event.target.value = "";
        }}
        ref={input}
        type="file"
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}
