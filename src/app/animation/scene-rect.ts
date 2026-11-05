// The product scene is the finite artboard, centered on the world origin.
export type SceneRect = Readonly<{ height: number; width: number; x: number; y: number }>;

export function getSceneRect(size: Readonly<{ height: number; width: number }>): SceneRect {
  return { height: size.height, width: size.width, x: -size.width / 2, y: -size.height / 2 };
}
