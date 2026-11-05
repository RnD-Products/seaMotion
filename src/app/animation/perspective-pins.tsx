import * as React from "react";

import type { BackdropImages, BackdropSettings } from "./backdrop";
import { getMockupViewport } from "./backdrop";
import {
  getPerspectiveDestinationCorners,
  PERSPECTIVE_CORNERS,
  type FramePerspective,
  type FrameTransform,
  type PerspectiveCorner,
} from "./frame-transform";
import { selectPerspectiveCorner, setPerspectivePinsVisible, usePerspectivePinsVisible, useSelectedPerspectiveCorner } from "./perspective-selection";
import styles from "./perspective-pins.module.css";

const CORNER_LABELS: Readonly<Record<PerspectiveCorner, string>> = {
  bottomLeft: "bottom left",
  bottomRight: "bottom right",
  topLeft: "top left",
  topRight: "top right",
};

function isPointInsideQuad(point: Readonly<{ x: number; y: number }>, corners: readonly Readonly<{ x: number; y: number }>[]): boolean {
  let inside = false;
  for (let index = 0, previous = corners.length - 1; index < corners.length; previous = index, index += 1) {
    const current = corners[index];
    const prior = corners[previous];
    const crosses = current.y > point.y !== prior.y > point.y
      && point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function PerspectivePins({
  backdrop,
  canvasRef,
  images,
  perspective,
  pixelScale,
  transform,
}: Readonly<{
  backdrop: BackdropSettings;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  images: BackdropImages;
  perspective: FramePerspective;
  pixelScale: number;
  transform: FrameTransform;
}>): React.JSX.Element | null {
  const visible = usePerspectivePinsVisible();
  const selected = useSelectedPerspectiveCorner();
  const canvas = canvasRef.current;
  const viewport = canvas && pixelScale > 0 ? getMockupViewport(backdrop, images, { height: canvas.height, width: canvas.width }) : null;
  const corners = viewport ? getPerspectiveDestinationCorners(viewport, transform, perspective, pixelScale) : null;
  const cssCorners = corners
    ? Object.fromEntries(
        PERSPECTIVE_CORNERS.map((corner) => [corner, { x: corners[corner].x / pixelScale, y: corners[corner].y / pixelScale }]),
      ) as Record<PerspectiveCorner, Readonly<{ x: number; y: number }>>
    : null;

  React.useEffect(() => {
    const interactionSurface = canvas?.parentElement;
    if (!perspective.enabled || !canvas || !cssCorners || !interactionSurface) {
      setPerspectivePinsVisible(false);
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-toolcraft-perspective-pin]")) return;
      if (!(target instanceof Node) || !interactionSurface.contains(target)) return;
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const point = {
        x: ((event.clientX - bounds.left) * (canvas.width / pixelScale)) / bounds.width,
        y: ((event.clientY - bounds.top) * (canvas.height / pixelScale)) / bounds.height,
      };
      const quad = PERSPECTIVE_CORNERS.map((corner) => cssCorners[corner]);
      if (isPointInsideQuad(point, quad)) {
        setPerspectivePinsVisible(true);
      } else {
        setPerspectivePinsVisible(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [canvas, cssCorners, perspective.enabled, pixelScale]);

  if (!perspective.enabled || !canvas || !viewport || !cssCorners || !visible) return null;

  const polygon = PERSPECTIVE_CORNERS.map((corner) => `${cssCorners[corner].x},${cssCorners[corner].y}`).join(" ");
  return (
    <div className={styles.layer} data-toolcraft-perspective-pins="">
      <svg aria-hidden="true" className={styles.guide} height={canvas.height / pixelScale} width={canvas.width / pixelScale}>
        <polygon points={polygon} />
      </svg>
      {PERSPECTIVE_CORNERS.map((corner) => (
        <button
          aria-label={`Move ${CORNER_LABELS[corner]} perspective pin`}
          aria-pressed={selected === corner}
          className={styles.pin}
          data-corner={corner}
          data-selected={selected === corner ? "true" : "false"}
          data-testid={`frame-perspective-${corner}`}
          data-toolcraft-perspective-pin=""
          key={corner}
          onClick={() => selectPerspectiveCorner(corner)}
          style={{ left: cssCorners[corner].x, top: cssCorners[corner].y }}
          type="button"
        >
          <span />
        </button>
      ))}
    </div>
  );
}
