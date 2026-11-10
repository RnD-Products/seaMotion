import { defineToolcraftCustomControlType } from "@/toolcraft/runtime";

export const moRenderStatusControl = defineToolcraftCustomControlType("moRenderStatus");

export type MoRenderStatus = Readonly<{ kind: "error" | "success"; message: string }> | null;

let current: MoRenderStatus = null;
const listeners = new Set<() => void>();

export function getMoRenderStatus(): MoRenderStatus {
  return current;
}

export function setMoRenderStatus(status: MoRenderStatus): void {
  current = status;
  for (const listener of listeners) listener();
}

export function subscribeMoRenderStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
