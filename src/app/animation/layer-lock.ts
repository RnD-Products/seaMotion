// A layer locked in the Layers panel cannot be picked, moved or resized on the artboard (it can still be selected in the panel). The locks are kept
// under the "__" key every scene shares, as { layerId: true }; a locked group locks everything it holds.
export const LOCK_KEY = "__locked";

type LayerLike = Readonly<{ id: string; parentGroupId?: string }>;

export function readLocked(params: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, true>> {
  const raw = params?.[LOCK_KEY];
  const out: Record<string, true> = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) for (const [id, value] of Object.entries(raw)) if (value === true) out[id] = true;
  return out;
}

// Every layer that is locked: itself or through a group around it.
export function lockedLayers(layers: readonly LayerLike[], locks: Readonly<Record<string, true>>): ReadonlySet<string> {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const out = new Set<string>();
  for (const layer of layers) {
    for (let at: LayerLike | undefined = layer, guard = 0; at && guard < 1000; at = at.parentGroupId ? byId.get(at.parentGroupId) : undefined, guard += 1) {
      if (locks[at.id]) {
        out.add(layer.id);
        break;
      }
    }
  }
  return out;
}

// The locks with one layer locked or unlocked.
export function withLock(locks: Readonly<Record<string, true>>, id: string, locked: boolean): Record<string, true> {
  const next: Record<string, true> = { ...locks };
  if (locked) next[id] = true;
  else delete next[id];
  return next;
}
