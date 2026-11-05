import { Copy, FileSvg, FilmStrip, FrameCorners, Image as ImageIcon, MusicNotes, SpeakerHigh, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { useToolcraftDispatch, useToolcraftSelector } from "@/toolcraft/runtime/react";
import { Button, PanelSection } from "@/toolcraft/ui";

import { getActiveAnimation } from "../animation/animation-spec";
import { readSoundSettings, SOUND_DRAG_TARGET, SOUND_MUSIC_TARGET, SOUND_SFX_TARGET } from "../animation/sound";
import { getMediaLayers } from "../media/media-layer";
import { readFigmaDesign, type FigmaItem } from "./figma-paste-import";
import { useLayerActions } from "./mo-layer-duplicate";
import styles from "./mo-assets-lists.module.css";

// How many cards a list shows at most (a big design can hold hundreds of layers).
const MAX_CARDS = 60;

type Card = Readonly<{ icon: React.ReactNode; id: string; meta: string; name: string }>;

function CardList({ cards, onDelete, onDuplicate }: Readonly<{ cards: readonly Card[]; onDelete?: (id: string) => void; onDuplicate?: (id: string) => void }>): React.JSX.Element {
  return (
    <div className={styles.list}>
      {cards.map((card) => (
        <div className={styles.card} key={card.id}>
          <span className={styles.icon}>{card.icon}</span>
          <div className={styles.text}>
            <span className={styles.name} title={card.name}>
              {card.name}
            </span>
            <span className={styles.meta}>{card.meta}</span>
          </div>
          {onDuplicate || onDelete ? (
            <div className={styles.actions}>
              {onDuplicate ? (
                <Button aria-label={`Duplicate ${card.name}`} onClick={() => onDuplicate(card.id)} size="icon-xs" title="Duplicate" type="button" variant="ghost">
                  <Copy size={12} />
                </Button>
              ) : null}
              {onDelete ? (
                <Button aria-label={`Delete ${card.name}`} onClick={() => onDelete(card.id)} size="icon-xs" title="Delete" type="button" variant="ghost">
                  <Trash size={12} />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// The project's assets as name cards (an icon and the name), in this order: the imported Figma designs, the images in use, the videos, the SVGs
// and the audio (music and sound effects). Each card has Duplicate and Delete.
export function MoAssetLists(): React.JSX.Element {
  const dispatch = useToolcraftDispatch();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const actions = useLayerActions();
  const spec = getActiveAnimation(values);

  const { audio, designs, images, svgs, videos } = React.useMemo(() => {
    const names = new Map(layers.map((layer) => [layer.id, layer.displayName ?? layer.name] as const));
    const nameOf = (id: string): string => names.get(id) ?? id;
    const design = spec ? readFigmaDesign(spec) : null;
    const items: FigmaItem[] = design ? design.blocks.flatMap((block) => block.items) : [];
    const media = getMediaLayers(spec);
    const frameIcon = <FrameCorners size={16} />;

    // Every import (paste) of a design is a block; its top layer in the Layers panel is the one whose parent is not part of the same block.
    const designCards: Card[] = (design?.blocks ?? []).flatMap((block) => {
      const own = (id: string | undefined): boolean => id !== undefined && id.startsWith(`${block.id}-`);
      const parents = new Map(layers.map((layer) => [layer.id, layer.parentGroupId] as const));
      const top = layers.find((layer) => own(layer.id) && !own(layer.parentGroupId) && !(layer.id in media));
      if (!top) return [];
      return [{ icon: frameIcon, id: top.id, meta: `${Math.round(block.width)} × ${Math.round(block.height)}${parents.get(top.id) ? " · inside the artboard" : ""}`, name: top.displayName ?? top.name }];
    });

    const seen = new Set<string>();
    const imageCards: Card[] = [];
    for (const item of items) {
      const asset = item.kind === "png" ? item.png : item.pic?.asset;
      if (!asset || seen.has(asset) || item.id.endsWith("-original")) continue;
      seen.add(asset);
      imageCards.push({ icon: <ImageIcon size={16} />, id: item.id, meta: `${Math.round(item.w)} × ${Math.round(item.h)}`, name: nameOf(item.id) });
    }

    const videoCards: Card[] = Object.entries(media).map(([id, layer]) => ({
      icon: <FilmStrip size={16} />,
      id,
      meta: `${layer.kind.toUpperCase()} · ${layer.duration.toFixed(1)}s · ${layer.width} × ${layer.height}`,
      name: nameOf(id),
    }));

    const svgCards: Card[] = items
      .filter((item) => item.kind === "svg" && item.svg)
      .map((item) => ({ icon: <FileSvg size={16} />, id: item.id, meta: `${Math.round(item.w)} × ${Math.round(item.h)}`, name: nameOf(item.id) }));

    const sound = readSoundSettings(values);
    const audioCards: Card[] = [
      ...(sound.music ? [{ icon: <MusicNotes size={16} />, id: "music", meta: `${sound.musicMood === "bright" ? "Bright" : "Calm"} · ${Math.round(sound.musicVolume * 100)}%`, name: "Music" }] : []),
      ...(sound.sfx ? [{ icon: <SpeakerHigh size={16} />, id: "sfx", meta: `${sound.sfxStyle} · ${Math.round(sound.sfxVolume * 100)}%`, name: "Sound effects" }] : []),
      ...(sound.drag ? [{ icon: <SpeakerHigh size={16} />, id: "drag", meta: `${sound.dragStyle} · ${Math.round(sound.dragVolume * 100)}%`, name: "Drag sound" }] : []),
    ];
    return { audio: audioCards, designs: designCards, images: imageCards.slice(0, MAX_CARDS), svgs: svgCards.slice(0, MAX_CARDS), videos: videoCards };
  }, [layers, spec, values]);

  // Audio has no layer: Delete turns that sound off.
  const turnOff = (id: string): void => {
    const target = id === "music" ? SOUND_MUSIC_TARGET : id === "sfx" ? SOUND_SFX_TARGET : SOUND_DRAG_TARGET;
    dispatch({ label: "Turn sound off", target, type: "controls.setValue", value: false });
  };

  // Every list is its own section, always there, each with a toggle to fold it; they start folded.
  // A section is folded unless it was opened.
  const [folded, setFolded] = React.useState<Readonly<Record<string, boolean>>>({});
  const fold = (key: string): { collapsed: boolean; collapsible: true; onCollapsedChange: (next: boolean) => void } => ({
    collapsed: folded[key] !== false,
    collapsible: true,
    onCollapsedChange: (next) => setFolded((previous) => ({ ...previous, [key]: next })),
  });
  return (
    <>
      <PanelSection title="Figma designs" {...fold("designs")}>
        {designs.length > 0 ? <CardList cards={designs} onDelete={actions.remove} onDuplicate={(id) => actions.duplicate(id)} /> : <span className={styles.hint}>No Figma designs yet.</span>}
      </PanelSection>
      <PanelSection title="Images" {...fold("images")}>
        {images.length > 0 ? <CardList cards={images} onDelete={actions.remove} onDuplicate={(id) => actions.duplicate(id)} /> : <span className={styles.hint}>No images yet.</span>}
      </PanelSection>
      <PanelSection title="Videos" {...fold("videos")}>
        {videos.length > 0 ? <CardList cards={videos} onDelete={actions.remove} onDuplicate={(id) => actions.duplicate(id)} /> : <span className={styles.hint}>No videos yet.</span>}
      </PanelSection>
      <PanelSection title="SVG" {...fold("svgs")}>
        {svgs.length > 0 ? <CardList cards={svgs} onDelete={actions.remove} onDuplicate={(id) => actions.duplicate(id)} /> : <span className={styles.hint}>No SVGs yet.</span>}
      </PanelSection>
      <PanelSection title="Audio" {...fold("audio")}>
        {audio.length > 0 ? <CardList cards={audio} onDelete={turnOff} /> : <span className={styles.hint}>No music or sound effects on.</span>}
      </PanelSection>
    </>
  );
}
