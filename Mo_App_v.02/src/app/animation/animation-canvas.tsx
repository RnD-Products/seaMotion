import * as React from "react";
import {
  useToolcraftProductSceneFrame,
  useToolcraftSelector,
  useToolcraftValue,
  useToolcraftDispatch,
} from "@/toolcraft/runtime/react";

import { AnimationSandbox, type DesignBounds, type SandboxFrame } from "./animation-sandbox";
import {
  ANIMATION_PARAMS_TARGET,
  getActiveAnimation,
  getLayerStack,
  getRenderSize,
  readTextOverrides,
  resolveParams,
  type AnimationSpec,
} from "./animation-spec";
import { setProbeSandbox } from "./layer-texts";
import { useSceneDurationSync, useSceneFollow, useScenePreview } from "./scene-duration";
import { useVideoStill } from "./timeline-view";
import { cameraWindow, drawCameraView, poseAt } from "./camera";
import { cameraGroupArea, cameraOnGroup } from "./camera-group";
import { resolveProjectScenes, sceneFrame as frameOfScene, sceneParams, sceneValuesList } from "./scenes";
import { areStickiesShown, drawMockup, drawStickies, getBackdropSources, getMockupViewport, loadBackdropImages, readBackdrop, readDesignBackground, type BackdropImages } from "./backdrop";
import { useFrameLayout } from "./design-bounds";
import { useDraftPlan } from "./landing-draft";
import { allFx, LANDING_SECTIONS_TARGET, motionGroups, readSectionMotions, withWaits, type LayerFx } from "./landing-motion";
import { clearLoopSegments, loopRanges, nextLoopTime, segmentLoopRanges, sectionWorkLoopKey, setEditingSectionLoop, useEditingSectionLoop, useLoopSelection } from "./landing-loop";
import { effectivePlan, evaluateScroll, LANDING_PLAN_TARGET, motionBlurLength, startAt, planDuration, readLandingPlan } from "./landing-plan";
import { MOTION_TYPE_TARGET, readMotionType } from "./motion-type";
import { drawInteractions, getCursorLayerId, isInteractionsOn, mapDesignPoint, readInteractions } from "./interactions";
import { drawBlankFrame, drawFramedBitmap, type FrameBitmap, frameWindow, FRAME_PANEL_LAYER_ID, readFramePerspective, readFrameStyle, readFrameTransform } from "./frame-transform";
import { PerspectivePins } from "./perspective-pins";
import { CanvasEdit } from "./canvas-edit";
import { frameIds } from "../mo/figma-paste-import";
import { composeDragPreview, getDragPreview, registerDragPreviewHost, splitStack, subscribeDragPreview, type DragParts } from "./drag-preview";
import { FULL_PREVIEW_QUALITY, nextPreviewPlaybackQuality, shouldSubmitPreviewFrame } from "./preview-playback-quality";
import { getRenderedPreviewSignature, invalidateRenderedPreview, useRenderedPreview } from "./rendered-preview";
import { readBrowserHeapBytes, recordPreviewMemorySample, type PreviewMemoryPhase } from "./preview-memory";
import { useSoundtrackPlayback } from "./sound-player";
import { useMoViewport } from "../mo/mo-viewport";
import { MoAppSidebarPortal } from "../mo/mo-app-sidebar-portal";
import styles from "./animation-canvas.module.css";

// The pieces drawn for a drag are this fraction of the preview's resolution.
const DRAG_PIECE_SCALE = 0.6;
const finiteOr = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

// One sandbox per installed animation; it is replaced when another animation is opened.
function useSandbox(spec: AnimationSpec | null): AnimationSandbox | null {
  const [sandbox, setSandbox] = React.useState<AnimationSandbox | null>(null);
  // The images are part of the key: adding, removing or reordering a layer's images reloads the animation.
  // "mo-refresh-runtime" (the broom in the Projects panel) starts the drawing's sandbox again, so the pictures, surfaces and
  // clips it had decoded are let go and loaded again as needed.
  const [epoch, setEpoch] = React.useState(0);
  React.useEffect(() => {
    const refresh = (): void => setEpoch((count) => count + 1);
    window.addEventListener("mo-refresh-runtime", refresh);
    return () => window.removeEventListener("mo-refresh-runtime", refresh);
  }, []);
  const key = spec ? `${spec.id}@${spec.version}#${spec.imageAssets.join(",")}~${epoch}` : null;
  const specRef = React.useRef(spec);
  specRef.current = spec;
  React.useEffect(() => {
    const current = specRef.current;
    if (!current) {
      setSandbox(null);
      return;
    }
    const next = new AnimationSandbox(current);
    next.ready.then(
      () => {
        setProbeSandbox(next);
        setSandbox(next);
      },
      () => undefined,
    );
    return () => {
      next.dispose();
      setProbeSandbox(next);
      setSandbox((existing) => (existing === next ? null : existing));
    };
  }, [key]);
  return sandbox;
}

function withScroll(params: Record<string, unknown>, state: { y: number }, fx: Record<string, LayerFx> | null, groups: Record<string, string[]> | null): Record<string, unknown> {
  return { ...params, ...(fx ? { __fx: fx } : {}), ...(groups ? { __groups: groups } : {}), __scrollY: state.y };
}

// Draws whatever animation the open project carries. Nothing is drawn when it has none.
export function AnimationCanvas(): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const sceneFrame = useToolcraftProductSceneFrame();
  const values = useToolcraftSelector((state) => state.values);
  const layers = useToolcraftSelector((state) => state.layers);
  const timeSeconds = useToolcraftSelector((state) => state.timeline.currentTimeSeconds);
  const videoStill = useVideoStill();
  const durationSeconds = useToolcraftSelector((state) => state.timeline.durationSeconds);
  const renderScaleValue = useToolcraftValue("canvas.renderScale");
  const renderScale = typeof renderScaleValue === "number" ? renderScaleValue : 1;

  const spec = React.useMemo(() => getActiveAnimation(values), [values]);
  const frameStyle = React.useMemo(() => readFrameStyle(values), [values]);
  const authoredFrameTransform = React.useMemo(() => readFrameTransform(values), [values]);
  const framePerspective = React.useMemo(() => readFramePerspective(values), [values]);
  const { bounds: frameBounds, transform: frameTransform } = useFrameLayout();
  // The mockup and sticky items: read from values, with their pictures decoded once per change.
  const backdrop = React.useMemo(() => readBackdrop(values), [values]);
  const canvasSize = useToolcraftSelector((state) => state.canvas.size);
  // The scenes are played one after another: each picture is drawn with its own scene's settings and time. With one scene
  // this is the project's values and time, as they are.
  const defaults = useToolcraftSelector((state) => state.defaults);
  const scenes = React.useMemo(() => resolveProjectScenes(values, durationSeconds), [values, durationSeconds]);
  useSceneDurationSync();
  useScenePreview();
  useSceneFollow();
  const sceneValues = React.useMemo(() => sceneValuesList(values, defaults, scenes), [values, defaults, scenes]);
  const scene = frameOfScene(values, defaults, scenes, timeSeconds, sceneValues);
  const localSeconds = scene.localSeconds;
  const frameDuration = scene.duration;
  const carriesOn = scene.carriesOn;
  // The scene's camera (a zoom with an angle): the picture is drawn on a buffer and placed in 3D on the canvas.
  const sceneCamera = scene.scene.scene.camera ?? undefined;
  const cameraBuffer = React.useRef<HTMLCanvasElement | null>(null);
  // What dragging a layer on the artboard needs: the last frame's settings, the way a picture is put on the canvas, and a tick that
  // draws the design in full again when the drag is over.
  const paintRef = React.useRef<((bitmap: FrameBitmap, tracked: DesignBounds | null, bitmapScale: number) => void) | null>(null);
  const lastFrameRef = React.useRef<SandboxFrame | null>(null);
  const [fullRepaint, setFullRepaint] = React.useState(0);
  const leadsOn = scene.leadsOn;
  const interactionItems = React.useMemo(() => readInteractions(scene.values), [scene.values]);
  const designBackground = React.useMemo(() => readDesignBackground(spec?.design as Parameters<typeof readDesignBackground>[0]), [spec]);
  const cursorLayerId = spec ? getCursorLayerId(spec.layers) : null;
  // While the kit is on, the animation's own cursor is not drawn; the kit items take over its motion.
  const trackLayer = isInteractionsOn(scene.values) && cursorLayerId ? cursorLayerId : undefined;
  const hideCursor = trackLayer !== undefined && interactionItems.length > 0;
  const stickiesShown = areStickiesShown(values, canvasSize, spec?.size);
  const backdropKey = getBackdropSources(backdrop).join("\n");
  const [backdropImages, setBackdropImages] = React.useState<BackdropImages>(new Map());
  React.useEffect(() => {
    let cancelled = false;
    void loadBackdropImages(backdropKey ? backdropKey.split("\n") : []).then((images) => {
      if (!cancelled) setBackdropImages(images);
    });
    return () => {
      cancelled = true;
    };
  }, [backdropKey]);
  const sandbox = useSandbox(spec);
  const sceneRef = React.useRef(scene);
  sceneRef.current = scene;
  const previousValues = scene.previous?.values;
  // The camera works on the design's "Camera" group when it has one: that group's box is its frame and its focus points are
  // measured inside it.
  const camera = React.useMemo(() => {
    if (!sceneCamera || !spec) return sceneCamera;
    const own = resolveParams(spec, values[ANIMATION_PARAMS_TARGET]);
    return cameraOnGroup(sceneCamera, cameraGroupArea(spec, layers, own, getRenderSize(spec, canvasSize)));
  }, [sceneCamera, spec, layers, values, canvasSize]);
  const params = React.useMemo(
    () => (spec ? sceneParams(spec, sceneRef.current, layers) : {}),
    // The scene's index, values and previous scene stand for the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, scene.values, scene.scene.scene, previousValues, layers],
  );
  // A Landing Page scrolls by its Scroll plan; the script is told how far, and whether the loader shows.
  const draftPlan = useDraftPlan();
  const sectionMotions = React.useMemo(() => readSectionMotions(values[LANDING_SECTIONS_TARGET]), [values]);
  const savedLanding = React.useMemo(() => {
    if (!spec?.page || readMotionType(values[MOTION_TYPE_TARGET]) !== "landing") return null;
    return { page: spec.page, plan: withWaits(effectivePlan(readLandingPlan(values[LANDING_PLAN_TARGET]), spec.page), spec.page, sectionMotions) };
  }, [spec, values, sectionMotions]);
  // While a number is being nudged with the arrow keys the canvas shows that draft plan.
  const landing = React.useMemo(() => (savedLanding && draftPlan ? { page: savedLanding.page, plan: withWaits(effectivePlan(draftPlan, savedLanding.page), savedLanding.page, sectionMotions) } : savedLanding), [savedLanding, draftPlan, sectionMotions]);
  // The plan decides how long the timeline is.
  const dispatch = useToolcraftDispatch();
  const planSeconds = savedLanding ? planDuration(savedLanding.plan) : null;
  React.useEffect(() => {
    if (planSeconds !== null && Math.abs(planSeconds - durationSeconds) > 0.05) dispatch({ durationSeconds: planSeconds, type: "timeline.setDuration" });
  }, [dispatch, durationSeconds, planSeconds]);
  // Rail picks and the section's temporary editing loop share the preview transport.
  const loopKeys = useLoopSelection();
  const editingSectionLoop = useEditingSectionLoop();
  const activeLoopKeys = React.useMemo(() => editingSectionLoop ? [sectionWorkLoopKey(editingSectionLoop)] : loopKeys, [editingSectionLoop, loopKeys]);
  React.useEffect(() => {
    setEditingSectionLoop(null);
  }, [spec?.id]);
  const isPlaying = useToolcraftSelector((state) => state.timeline.isPlaying);
  // Interaction sounds and music play in step with the timeline.
  const isPlayingRef = React.useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const timeSecondsRef = React.useRef(timeSeconds);
  timeSecondsRef.current = timeSeconds;
  const [playbackQuality, setPlaybackQuality] = React.useState(FULL_PREVIEW_QUALITY);
  const lastPreviewSubmission = React.useRef(-1);
  const previousPreviewTime = React.useRef(timeSeconds);
  React.useEffect(() => {
    if (isPlaying) return;
    lastPreviewSubmission.current = -1;
    setPlaybackQuality(FULL_PREVIEW_QUALITY);
  }, [isPlaying]);
  const previousLoopTime = React.useRef(timeSeconds);
  const previousLoopKeys = React.useRef(activeLoopKeys);
  React.useEffect(() => {
    const previous = previousLoopTime.current;
    previousLoopTime.current = timeSeconds;
    const picksChanged = previousLoopKeys.current !== activeLoopKeys;
    previousLoopKeys.current = activeLoopKeys;
    if (!isPlaying || activeLoopKeys.length === 0) return;
    const ranges = landing ? loopRanges(landing.plan, activeLoopKeys, sectionMotions, landing.page, durationSeconds) : segmentLoopRanges(activeLoopKeys);
    const next = nextLoopTime(ranges, timeSeconds);
    if (next === null) return;
    if (editingSectionLoop !== null) {
      dispatch({ currentTimeSeconds: next, type: "timeline.setCurrentTime" });
      return;
    }
    // A segment was just picked while playing: take the playhead into it (never throw the pick away).
    if (picksChanged) {
      dispatch({ currentTimeSeconds: next, type: "timeline.setCurrentTime" });
      return;
    }
    // Running past the end of a picked segment (a small step from inside it) wraps to the next one.
    // Playing from, or being moved to, a point outside the picked segments is the user choosing to
    // play from there, so the loop is let go instead of pulling the playhead back.
    const crossedEnd = nextLoopTime(ranges, previous) === null && Math.abs(timeSeconds - previous) <= 0.5;
    if (crossedEnd) dispatch({ currentTimeSeconds: next, type: "timeline.setCurrentTime" });
    else clearLoopSegments();
  }, [activeLoopKeys, dispatch, durationSeconds, editingSectionLoop, isPlaying, landing, sectionMotions, timeSeconds]);
  // A click anywhere outside the line, the loop bar and the timeline controls drops the picked segments.
  React.useEffect(() => {
    if (loopKeys.length === 0) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-loop-keep], [data-panel-type="timeline"], [role="listbox"], [role="dialog"], [role="alertdialog"]')) return;
      clearLoopSegments();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") clearLoopSegments();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [loopKeys.length]);
  const layerStack = React.useMemo(() => (spec ? getLayerStack(spec, layers) : []), [spec, layers]);
  useSoundtrackPlayback(values, defaults, durationSeconds, isPlaying, timeSeconds, canvasSize, layerStack);
  const texts = React.useMemo(() => readTextOverrides(values), [values]);

  const previewSignature = React.useMemo(
    () => getRenderedPreviewSignature({ canvas: { size: canvasSize }, layers, timeline: { durationSeconds }, values }),
    [canvasSize, durationSeconds, layers, values],
  );
  const renderedPreview = useRenderedPreview();
  const activeRenderedPreview = renderedPreview?.signature === previewSignature ? renderedPreview : null;
  React.useEffect(() => invalidateRenderedPreview(previewSignature), [previewSignature]);

  const frameLayerShown = layers.some((layer) => layer.id === FRAME_PANEL_LAYER_ID && layer.visible);
  const rect = sceneFrame.kind === "ready" ? sceneFrame.rect : null;
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const pixelScale = devicePixelRatio * renderScale;
  const previewFactor = isPlaying ? playbackQuality.factor : 1;
  const previewPixelScale = pixelScale * previewFactor;
  useMoViewport(canvasRef, rect);

  const previousMemoryTime = React.useRef(timeSeconds);
  React.useEffect(() => {
    if (!sandbox) return;
    let cancelled = false;
    let first = true;
    const sample = async (): Promise<void> => {
      const stats = await sandbox.measureMemory().catch(() => null);
      if (cancelled || !stats) return;
      const currentTime = timeSecondsRef.current;
      const moved = Math.abs(currentTime - previousMemoryTime.current) > 0.0001;
      const phase: PreviewMemoryPhase = first ? "reopen" : isPlayingRef.current ? "playing" : moved ? "scrubbing" : "idle";
      first = false;
      previousMemoryTime.current = currentTime;
      const schedule = sandbox.getScheduleStats();
      const completedFrames = schedule.delivered + schedule.skippedStale;
      recordPreviewMemorySample({
        averageRenderMs: completedFrames > 0 ? schedule.totalRenderMs / completedFrames : 0,
        budgetBytes: typeof stats.budgetBytes === "number" ? stats.budgetBytes : null,
        cacheBytes: stats.bytes ?? 0,
        effectBytes: stats.effectBytes ?? 0,
        evictions: (stats.evictions ?? 0) + (stats.effectEvictions ?? 0),
        heapBytes: readBrowserHeapBytes(),
        maxRenderMs: schedule.maxRenderMs,
        peakBytes: stats.peakBytes ?? stats.totalBytes ?? 0,
        phase,
        sampledAt: Date.now(),
        totalBytes: stats.totalBytes ?? (stats.bytes ?? 0) + (stats.effectBytes ?? 0),
      });
    };
    void sample();
    const timer = globalThis.setInterval(() => void sample(), 1000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [sandbox]);

  React.useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !rect || !activeRenderedPreview) return;
    const pixelWidth = Math.max(1, Math.ceil(rect.width * pixelScale));
    const pixelHeight = Math.max(1, Math.ceil(rect.height * pixelScale));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    let stopped = false;
    let callbackId: number | null = null;
    const draw = (): void => {
      if (stopped || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.dataset.renderedPreview = "true";
      canvas.dataset.previewTimeSeconds = (activeRenderedPreview.startSeconds + video.currentTime).toFixed(4);
    };
    const next = (): void => {
      draw();
      if (!stopped) callbackId = video.requestVideoFrameCallback(next);
    };
    video.addEventListener("loadeddata", draw);
    video.addEventListener("seeked", draw);
    callbackId = video.requestVideoFrameCallback(next);
    draw();
    return () => {
      stopped = true;
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      video.removeEventListener("loadeddata", draw);
      video.removeEventListener("seeked", draw);
      delete canvas.dataset.renderedPreview;
    };
  }, [activeRenderedPreview, pixelScale, rect]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeRenderedPreview) return;
    const previewDuration = Math.max(0, activeRenderedPreview.endSeconds - activeRenderedPreview.startSeconds);
    const desired = Math.min(previewDuration, Math.max(0, timeSeconds - activeRenderedPreview.startSeconds));
    if (!isPlaying || Math.abs(video.currentTime - desired) > 0.15) video.currentTime = desired;
    if (isPlaying) void video.play().catch(() => undefined);
    else video.pause();
  }, [activeRenderedPreview, isPlaying, timeSeconds]);

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rect) return;
    const pixelWidth = Math.max(1, Math.ceil(rect.width * pixelScale));
    const pixelHeight = Math.max(1, Math.ceil(rect.height * pixelScale));
    if (activeRenderedPreview) return;
    if (!sandbox) {
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const blank = canvas.getContext("2d");
      blank?.clearRect(0, 0, pixelWidth, pixelHeight);
      // A blank project draws its own frame once the Frame layer is added (Active) and visible.
      if (blank && !spec && frameLayerShown) drawBlankFrame(blank, rect, frameTransform, frameStyle, pixelScale);
      return;
    }
    // The animation is drawn at its own size and placed on the canvas, so a canvas of another shape
    // never cuts it off.
    const drawSize = spec ? getRenderSize(spec, rect) : rect;
    const scrolled = landing ? evaluateScroll(landing.plan, landing.page, timeSeconds) : null;
    // The Start (preloader or intro transition) is drawn by the app around the page picture.
    const part = landing && scrolled && scrolled.loading !== null ? startAt(landing.plan, timeSeconds) : null;
    const start = part ? { color: part.color, index: part.index, preset: part.preset, progress: part.progress, time: timeSeconds } : undefined;
    // The entry and loop motion of the page's sections.
    const motionFx = landing ? allFx(sectionMotions, landing.plan, landing.page, timeSeconds, durationSeconds) : null;
    // The scroll's motion blur (the preview can switch it off; a render always has it).
    const blurLength = landing ? motionBlurLength(landing.plan, landing.page, timeSeconds, true) : 0;
    // While a layer is being dragged the picture is put together from the pieces; a frame drawn now would only be replaced by it.
    if (getDragPreview().parts) return;
    const now = performance.now();
    if (isPlaying && !shouldSubmitPreviewFrame(lastPreviewSubmission.current, now, playbackQuality.targetFps)) return;
    lastPreviewSubmission.current = now;
    const previewActivity = isPlaying ? "playing" : Math.abs(timeSeconds - previousPreviewTime.current) > 0.0001 ? "scrubbing" : "idle";
    previousPreviewTime.current = timeSeconds;
    const previewParams = { ...params, __preview: true, __previewActivity: previewActivity, __previewQuality: renderScale * previewFactor, __videoStill: videoStill };
    const frame: SandboxFrame = {
      durationSeconds: frameDuration,
      height: drawSize.height,
      // While the kit is on, the animation's own cursor layer is left out of the picture.
      layerStack: hideCursor ? layerStack.filter((id) => id !== trackLayer) : layerStack,
      mediaDurationSeconds: durationSeconds,
      mediaTimeSeconds: timeSeconds,
      params: scrolled ? withScroll(previewParams, scrolled, motionFx, motionGroups(sectionMotions, layers, frameIds(spec))) : previewParams,
      pixelHeight: Math.max(1, Math.ceil(drawSize.height * previewPixelScale)),
      pixelScale: previewPixelScale,
      pixelWidth: Math.max(1, Math.ceil(drawSize.width * previewPixelScale)),
      texts,
      timeSeconds: localSeconds,
      trackLayer,
      width: drawSize.width,
    };
    const pose = poseAt(camera, localSeconds);
    // Puts a picture of the design on the artboard canvas. It is used for a frame the sandbox has drawn and, while a layer is dragged,
    // for the picture put together from the pieces (drag-preview.ts).
    const paint = (bitmap: FrameBitmap, tracked: DesignBounds | null, bitmapScale: number): void => {
        const target = canvasRef.current;
        const context = target?.getContext("2d");
        if (target && context) {
          if (target.width !== pixelWidth) target.width = pixelWidth;
          if (target.height !== pixelHeight) target.height = pixelHeight;
          context.clearRect(0, 0, target.width, target.height);
          drawFramedBitmap(
            context,
            bitmap,
            frameTransform,
            pixelScale,
            frameBounds ? { rect: frameBounds, renderSize: drawSize, style: frameStyle } : undefined,
            (target2d) => drawMockup(target2d, backdrop, backdropImages, { height: pixelHeight, width: pixelWidth }, designBackground),
            (target2d) => {
              if (stickiesShown) drawStickies(target2d, backdrop, backdropImages, { height: pixelHeight, width: pixelWidth }, pixelScale);
              // Kit items go where the animation's cursor is (its tip) and move with the animation, or sit at their own position.
              const cursor =
                trackLayer && tracked
                  ? mapDesignPoint({ x: tracked.x, y: tracked.y }, drawSize, frameTransform, { height: pixelHeight, width: pixelWidth }, pixelScale)
                  : null;
              // While the animation's cursor is off the picture (before it enters, after it leaves) the kit draws nothing.
              if (!trackLayer || tracked) drawInteractions(target2d, interactionItems, localSeconds, pixelWidth, pixelHeight, pixelScale, cursor, {
                carriesOn,
                ...(leadsOn ? { leadsOnAt: frameDuration } : {}),
                place: (xPercent, yPercent) => mapDesignPoint({ x: (xPercent / 100) * drawSize.width, y: (yPercent / 100) * drawSize.height }, drawSize, frameTransform, { height: pixelHeight, width: pixelWidth }, pixelScale),
              });
            },
            start,
            blurLength,
            (() => {
              const viewport = getMockupViewport(backdrop, backdropImages, { height: pixelHeight, width: pixelWidth });
              return viewport ? { perspective: framePerspective, viewport, transform: authoredFrameTransform } : undefined;
            })(),
            bitmapScale,
          );
          if (pose && camera) {
            // The picture inside the frame is zoomed and angled; the frame and what is around it stay as they are.
            const buffer = cameraBuffer.current ?? document.createElement("canvas");
            cameraBuffer.current = buffer;
            if (buffer.width !== target.width) buffer.width = target.width;
            if (buffer.height !== target.height) buffer.height = target.height;
            const copy = buffer.getContext("2d");
            copy?.clearRect(0, 0, buffer.width, buffer.height);
            copy?.drawImage(target, 0, 0);
            drawCameraView(context, buffer, pose, pose.focusX, pose.focusY, cameraWindow(camera, frameWindow(frameBounds ? { rect: frameBounds, renderSize: drawSize, style: frameStyle } : undefined, frameTransform, pixelScale, target), target, pixelScale), (target2d) =>
              // The window's rounded corners show the artboard behind the picture.
              drawMockup(target2d, backdrop, backdropImages, { height: pixelHeight, width: pixelWidth }, designBackground),
            );
          }
          target.dataset.previewTimeSeconds = frame.timeSeconds.toFixed(4);
        }
    };
    paintRef.current = paint;
    lastFrameRef.current = frame;
    sandbox.schedule(
      frame,
      (bitmap, tracked) => {
        paint(bitmap, tracked, previewPixelScale);
        bitmap.close();
      },
      (sample) => {
        const target = canvasRef.current;
        if (target) {
          const stats = sandbox.getScheduleStats();
          target.dataset.previewDelivered = String(stats.delivered);
          target.dataset.previewMaxPending = String(stats.maxPending);
          target.dataset.previewReplaced = String(stats.replacedPending);
          target.dataset.previewSkippedStale = String(stats.skippedStale);
          target.dataset.previewFailed = String(stats.failed);
          target.dataset.previewLastError = stats.lastError;
        }
        setPlaybackQuality((current) => nextPreviewPlaybackQuality(current, isPlayingRef.current, sample));
      },
    );
  }, [designBackground, videoStill, activeRenderedPreview, camera, carriesOn, durationSeconds, leadsOn, frameDuration, localSeconds, landing, layers, sectionMotions, frameLayerShown, backdrop, backdropImages, interactionItems, hideCursor, trackLayer, stickiesShown, durationSeconds, frameBounds, frameStyle, frameTransform, authoredFrameTransform, framePerspective, isPlaying, layerStack, params, pixelScale, playbackQuality, previewFactor, previewPixelScale, rect, renderScale, sandbox, spec, texts, timeSeconds, fullRepaint]);

  // Dragging a layer: the design is drawn in three pieces once (below, the moved layers, above); every move only slides the middle piece
  // over the others (drag-preview.ts), so a fast drag keeps up. The pieces are drawn a little smaller than the preview.
  React.useEffect(() => {
    if (!sandbox) return;
    registerDragPreviewHost({
      prepare: async (ids): Promise<DragParts | null> => {
        const base = lastFrameRef.current;
        if (!base) return null;
        const pieces = splitStack(base.layerStack, new Set(ids));
        if (!pieces) return null;
        const scale = Math.max(0.1, base.pixelScale * DRAG_PIECE_SCALE);
        const piece = { ...base, params: { ...base.params, __previewQuality: finiteOr(base.params.__previewQuality, 1) * DRAG_PIECE_SCALE }, pixelHeight: Math.max(1, Math.ceil(base.height * scale)), pixelScale: scale, pixelWidth: Math.max(1, Math.ceil(base.width * scale)) };
        const draw = (stack: string[]): Promise<ImageBitmap | null> => (stack.length > 0 ? sandbox.render({ ...piece, layerStack: stack }) : Promise.resolve(null));
        const [below, selected, above] = await Promise.all([draw(pieces.below), draw(pieces.selected), draw(pieces.above)]);
        if (!selected) {
          below?.close();
          above?.close();
          return null;
        }
        return { above, below, height: base.height, scale, selected, width: base.width };
      },
    });
    return () => registerDragPreviewHost(null);
  }, [sandbox]);
  React.useEffect(() => {
    const together = document.createElement("canvas");
    let composed = false;
    return subscribeDragPreview(() => {
      const { live, parts } = getDragPreview();
      const paint = paintRef.current;
      if (parts && live && paint) {
        composeDragPreview(together, parts, live);
        paint(together, null, parts.scale);
        composed = true;
      } else if (!parts && composed) {
        // The drag is over: the design is drawn in full again, even when nothing changed.
        composed = false;
        setFullRepaint((count) => count + 1);
      }
    });
  }, []);

  // The artboard can be edited directly (click, drag, resize, Delete, retype) while it shows a plain, still view of a pasted design.
  const drawSizeForEdit = React.useMemo(() => (rect ? (spec ? getRenderSize(spec, rect) : rect) : null), [rect, spec]);
  const canEditOnArtboard =
    spec !== null &&
    !isPlaying &&
    !camera &&
    !landing &&
    !spec.page &&
    // Any scene can be edited on the artboard: what a drag, a resize or a retype writes (position, size, text) is kept under the "__" keys
    // every scene shares, and a scene drawn from its saved settings takes them from the live values.
    !framePerspective.enabled &&
    backdrop.mode !== "mockup" &&
    !activeRenderedPreview &&
    frameTransform.scale > 0;

  return (
    <>
      <canvas
        className={backdrop.mode === "transparent" ? `${styles.canvas} ${styles.checker}` : styles.canvas}
        data-animation-ready={sandbox ? "true" : "false"}
        data-preview-render-factor={previewFactor}
        data-preview-target-fps={isPlaying ? playbackQuality.targetFps : 60}
        data-toolcraft-product-output=""
        ref={canvasRef}
        style={rect ? { height: rect.height, width: rect.width } : undefined}
      />
      {activeRenderedPreview ? (
        <video
          aria-hidden="true"
          loop
          muted
          playsInline
          preload="auto"
          ref={videoRef}
          src={activeRenderedPreview.url}
          style={{ display: "none" }}
        />
      ) : null}
      {rect && drawSizeForEdit ? <CanvasEdit drawSize={drawSizeForEdit} enabled={canEditOnArtboard} frameTransform={frameTransform} rect={rect} /> : null}
      <PerspectivePins
        backdrop={backdrop}
        canvasRef={canvasRef}
        images={backdropImages}
        perspective={framePerspective}
        pixelScale={pixelScale}
        transform={authoredFrameTransform}
      />
      <MoAppSidebarPortal canvasRef={canvasRef} />
    </>
  );
}
