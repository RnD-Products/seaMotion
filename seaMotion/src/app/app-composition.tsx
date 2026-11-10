import { composeToolcraftApp, type ToolcraftPanelActionContext } from "@/toolcraft/runtime/react";

import { appSchema } from "./app-schema";
import { AnimationCanvas } from "./animation/animation-canvas";
import { renderMoMotion, renderTemporaryPreview, type MoRenderResult } from "./mo/mo-render";
import { moRenderStatusControl, setMoRenderStatus } from "./mo/mo-render-status";
import { MoRenderStatusControl } from "./mo/mo-render-status-control";
import { AnimationControls } from "./animation/animation-controls";
import { ScenesControl } from "./animation/scenes-control";
import { MotionPresets } from "./animation/motion-presets";
import { LayerTagSection } from "./animation/layer-tag-picker";
import { StickyPresets } from "./animation/sticky-presets";
import { LandingMockupControl, MotionTypeControl } from "./animation/motion-type-control";
import { ScrollPlanControl } from "./animation/scroll-plan-control";
import { SectionMotionControl } from "./animation/section-motion-control";
import { ArtboardSize } from "./animation/artboard-size";
import { ArtboardFonts } from "./mo/artboard-fonts";
import { LayerPerspectiveControl } from "./animation/layer-perspective-control";
import { FrameSettings } from "./animation/frame-settings";
import { AnimationLibraryControl } from "./animation/animation-library-control";
import { animationLibraryControl, animationParamsControl, interactionPlanControl, motionPresetsControl, scenesControl, moMotionPickerControl, artboardSizeControl, artboardFontsControl, layerPerspectiveControl, frameSettingsControl, imageSlotControl, interactionListControl, landingMockupControl, layerEditorControl, layerTagControl, motionTypeControl, scrollPlanControl, sectionMotionControl, layerImagesControl, layerTextsControl, stickyPresetsControl, stickyRatiosControl } from "./mo/mo-motion-picker";
import { MoMotionPickerControl } from "./mo/mo-motion-picker-control";
import { moProjectsControl } from "./mo/mo-projects";
import { MoProjectsControl } from "./mo/mo-projects-control";
import { moVersionsControl } from "./mo/mo-versions";
import { MoVersionsControl } from "./mo/mo-versions-control";
import { ImageSlot } from "./animation/image-slot";
import { StickyRatios } from "./animation/sticky-ratios";
import { InteractionList } from "./animation/interaction-list";
import { LayerEditor } from "./animation/layer-editor";
import { LayerImages } from "./animation/layer-images";
import { LayerTextEditor } from "./animation/layer-text-editor";
import { getSceneRect } from "./animation/scene-rect";
import { clearRenderedPreview, getRenderedPreviewSignature, installRenderedPreview, resolveRenderedPreviewRange, setRenderedPreviewStatus } from "./animation/rendered-preview";
import { renderedPreviewStatusControl } from "./animation/rendered-preview-status";
import { RenderedPreviewStatusControl } from "./animation/rendered-preview-status-control";
import { exportLottie, lottieCheckControl, lottieExportControl, setLottieExportStatus } from "./lottie/lottie-export";
import { LottieCheckControl, LottieExportControl } from "./lottie/lottie-check-control";

const CODEC_LABELS = { avc: "H.264", hevc: "H.265", vp8: "VP8", vp9: "VP9" } as const;

function describeRender(result: MoRenderResult): string {
  const codec = result.codec ? `, ${CODEC_LABELS[result.codec]}` : "";
  const size = result.byteLength >= 1024 * 1024 ? `${(result.byteLength / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(result.byteLength / 1024))} KB`;
  return `Saved ${result.fileName} (${result.width}×${result.height}${codec}, ${size}).`;
}

let activeRender: AbortController | null = null;

// Render results are shown by the status control above the Render button.
async function handlePanelAction(context: ToolcraftPanelActionContext): Promise<void> {
  if (context.action.value === "clear-rendered-preview") {
    clearRenderedPreview();
    return;
  }
  // With Format Lottie the footer button reads Export and downloads the Lottie file instead of rendering.
  if (context.action.value === "render-motion" && context.state.values["render.format"] === "lottie") {
    setMoRenderStatus(null);
    try {
      const result = exportLottie(context.state);
      const size = result.byteLength >= 1024 * 1024 ? `${(result.byteLength / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(result.byteLength / 1024))} KB`;
      const leftOut = result.leftOut > 0 ? ` ${result.leftOut} listed item${result.leftOut === 1 ? " is" : "s are"} not in it.` : "";
      setLottieExportStatus({ kind: "success", message: `Saved ${result.fileName} (${size}).${leftOut}` });
    } catch (error) {
      setLottieExportStatus({ kind: "error", message: error instanceof Error ? error.message : "Lottie export failed." });
      throw error;
    }
    return;
  }
  if (context.action.value !== "render-motion" && context.action.value !== "build-rendered-preview") return;
  if (activeRender) {
    const message = "A render is already running.";
    if (context.action.value === "build-rendered-preview") setRenderedPreviewStatus({ kind: "error", message });
    else setMoRenderStatus({ kind: "error", message });
    return;
  }
  const controller = new AbortController();
  activeRender = controller;
  setMoRenderStatus(null);
  try {
    if (context.action.value === "build-rendered-preview") {
      setRenderedPreviewStatus({ kind: "rendering", message: "Rendering temporary preview…" });
      const range = resolveRenderedPreviewRange(context.state, context.state.values["preview.renderedRange"]);
      const signature = getRenderedPreviewSignature(context.state);
      const result = await renderTemporaryPreview({ reportProgress: context.reportProgress, signal: controller.signal, state: context.state }, range);
      installRenderedPreview({
        endSeconds: range[1],
        fps: result.fps,
        height: result.height,
        signature,
        startSeconds: range[0],
        width: result.width,
      }, result.blob);
      return;
    }
    const result = await renderMoMotion({
      reportProgress: context.reportProgress,
      signal: controller.signal,
      state: context.state,
    });
    setMoRenderStatus({ kind: "success", message: describeRender(result) });
  } catch (error) {
    if (context.action.value === "build-rendered-preview") {
      setRenderedPreviewStatus({ kind: "error", message: error instanceof Error ? error.message : "Preview render failed." });
      throw error;
    }
    setMoRenderStatus({
      kind: "error",
      message: error instanceof Error ? error.message : "Render failed.",
    });
    throw error;
  } finally {
    activeRender = null;
  }
}

export const appComposition = composeToolcraftApp(appSchema, {
  actions: { onPanelAction: handlePanelAction },
  controls: {
    renderers: {
      [moRenderStatusControl]: MoRenderStatusControl,
      [lottieCheckControl]: LottieCheckControl,
      [lottieExportControl]: LottieExportControl,
      [animationLibraryControl]: AnimationLibraryControl,
      [animationParamsControl]: AnimationControls,
      [interactionPlanControl]: AnimationControls,
      [scenesControl]: ScenesControl,
      [moMotionPickerControl]: MoMotionPickerControl,
      [artboardSizeControl]: ArtboardSize,
      [artboardFontsControl]: ArtboardFonts,
      [layerPerspectiveControl]: LayerPerspectiveControl,
      [frameSettingsControl]: FrameSettings,
      [imageSlotControl]: ImageSlot,
      [interactionListControl]: InteractionList,
      [motionTypeControl]: MotionTypeControl,
      [landingMockupControl]: LandingMockupControl,
      [scrollPlanControl]: ScrollPlanControl,
      [sectionMotionControl]: SectionMotionControl,
      [stickyPresetsControl]: StickyPresets,
      [motionPresetsControl]: MotionPresets,
      [stickyRatiosControl]: StickyRatios,
      [layerEditorControl]: LayerEditor,
      [layerTagControl]: LayerTagSection,
      [layerImagesControl]: LayerImages,
      [layerTextsControl]: LayerTextEditor,
      [moProjectsControl]: MoProjectsControl,
      [moVersionsControl]: MoVersionsControl,
      [renderedPreviewStatusControl]: RenderedPreviewStatusControl,
    },
  },
  scene: {
    canvasContent: <AnimationCanvas />,
    renderDefaultCanvasMedia: false,
    sceneBoundsProvider: ({ state }) => [getSceneRect(state.canvas.size)],
  },
});
