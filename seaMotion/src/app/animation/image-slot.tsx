import { Plus, X } from "@phosphor-icons/react";
import * as React from "react";
import type { ToolcraftCustomControlRendererProps } from "@/toolcraft/runtime/react";

import { readImageSlot } from "./backdrop";
import styles from "./layer-images.module.css";

const MAX_SIDE = 1600;

// The picture is scaled down so it stays small in the saved project; the alpha channel is kept.
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const fit = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * fit));
  canvas.height = Math.max(1, Math.round(bitmap.height * fit));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.9);
}

// A set of uploaded pictures as thumbnails: click one to show it, × removes it, + adds more. The value
// is the pictures themselves and which one is shown, so it is saved, undone and exported with the
// project like any other setting.
export function ImageSlot({ setValue, value }: ToolcraftCustomControlRendererProps): React.ReactNode {
  const input = React.useRef<HTMLInputElement>(null);
  const { items, selected } = readImageSlot(value);
  const write = (nextItems: readonly string[], nextSelected: number): void => {
    setValue({ items: nextItems, selected: Math.min(Math.max(0, nextSelected), Math.max(0, nextItems.length - 1)) });
  };
  const add = async (files: FileList): Promise<void> => {
    const added = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(toDataUrl));
    if (added.length === 0) return;
    // The first picture added is shown; later ones are added without changing what is shown.
    write([...items, ...added], items.length === 0 ? 0 : selected);
  };
  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {items.map((source, index) => (
          <div
            aria-pressed={index === selected}
            className={styles.tile}
            data-selected={index === selected}
            key={`${index}-${source.length}`}
            onClick={() => write(items, index)}
            role="button"
            style={{ cursor: "pointer" }}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") write(items, index);
            }}
          >
            <img alt="" className={styles.image} src={source} />
            <button
              aria-label="Remove image"
              className={`${styles.badge} ${styles.remove}`}
              onClick={(event) => {
                event.stopPropagation();
                const next = items.filter((_, itemIndex) => itemIndex !== index);
                write(next, index < selected ? selected - 1 : index === selected ? 0 : selected);
              }}
              type="button"
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        ))}
        <button aria-label="Add images" className={styles.add} onClick={() => input.current?.click()} type="button">
          <Plus size={16} />
        </button>
      </div>
      <input
        accept="image/*"
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
    </div>
  );
}
