import { describe, expect, it } from "vitest";

import { ANIMATION_PARAMS_TARGET, type AnimationSpec } from "./animation-spec";
import {
  scenesOverlapping,
  snapToScenes,
  applySceneSlice,
  captureSceneSlice,
  defaultSceneSet,
  nextSceneName,
  readScenes,
  resolveScenes,
  sceneAt,
  sceneFrame,
  sceneParams,
  sceneSliceChanges,
  SEGMENTS_SECONDS,
  splitIntoSegments,
  splitIntoPreset,
  resetScenes,
  scenesHaveMotion,
  resolveProjectScenes,
  SCENE_PRESETS,
  presetSeconds,
  type Scene,
} from "./scenes";

const defaults = { "interactions.enabled": false, "interactions.list": [], "sound.sfx": false, "sound.part": "press", [ANIMATION_PARAMS_TARGET]: {} };
const live = {
  "interactions.enabled": true,
  "interactions.list": [{ id: "a" }],
  "sound.sfx": true,
  "sound.part": "grab",
  [ANIMATION_PARAMS_TARGET]: { speed: 2, __text: { t: "x" } },
};

function scene(id: string, over: Partial<Scene> = {}): Scene {
  return { duration: 4, id, motion: true, name: id, slice: {}, start: "design", ...over };
}

describe("scenes", () => {
  it("has one scene, as long as the timeline, when none are saved", () => {
    const scenes = resolveScenes(undefined, 13.93);
    expect(scenes.many).toBe(false);
    expect(scenes.items).toHaveLength(1);
    expect(scenes.items[0]?.scene.name).toBe("Scene");
    expect(scenes.total).toBe(13.93);
    expect(sceneAt(scenes, 20).index).toBe(0);
  });

  it("keeps a lone saved scene as long as the timeline and sums several", () => {
    const one = resolveScenes({ activeId: "a", items: [scene("a", { duration: 9 })] }, 5);
    expect(one.total).toBe(5);
    const two = resolveScenes({ activeId: "b", items: [scene("a"), scene("b", { duration: 6 })] }, 99);
    expect(two.total).toBe(10);
    expect(two.activeIndex).toBe(1);
    expect(two.items.map((item) => [item.start, item.end])).toEqual([[0, 4], [4, 10]]);
    expect(sceneAt(two, 3.9).index).toBe(0);
    expect(sceneAt(two, 4).index).toBe(1);
    expect(sceneAt(two, 50).index).toBe(1);
  });

  it("captures the motion, Reactor and sound settings but not the design's or the transport's", () => {
    const slice = captureSceneSlice(live);
    expect(slice).toEqual({
      "interactions.enabled": true,
      "interactions.list": [{ id: "a" }],
      "sound.sfx": true,
      [ANIMATION_PARAMS_TARGET]: { speed: 2 },
    });
  });

  it("applies a scene: its settings in, the design's parameters kept, unsaved settings at their defaults", () => {
    const applied = applySceneSlice(live, defaults, { "sound.sfx": true, [ANIMATION_PARAMS_TARGET]: { speed: 5 } });
    expect(applied["sound.sfx"]).toBe(true);
    expect(applied["interactions.enabled"]).toBe(false);
    expect(applied["interactions.list"]).toEqual([]);
    expect(applied["sound.part"]).toBe("grab");
    expect(applied[ANIMATION_PARAMS_TARGET]).toEqual({ __text: { t: "x" }, speed: 5 });
    expect(sceneSliceChanges(live, defaults, captureSceneSlice(live))).toEqual({});
  });

  it("gives each picture the scene it is in, with the scene's own time and values", () => {
    const value = { activeId: "a", items: [scene("a"), scene("b", { slice: { "sound.sfx": false }, start: "previous", motion: false })] };
    const scenes = resolveScenes(value, 8);
    const first = sceneFrame(live, defaults, scenes, 1);
    expect(first.localSeconds).toBe(1);
    expect(first.values).toBe(live);
    expect(first.previous).toBeNull();
    const second = sceneFrame(live, defaults, scenes, 6);
    expect(second.index).toBe(1);
    expect(second.localSeconds).toBe(2);
    expect(second.values["sound.sfx"]).toBe(false);
    expect(second.previous?.seconds).toBe(4);
    expect(second.previous?.values).toBe(live);
  });

  it("tells the drawing script when a scene has no motion and where the previous one ended", () => {
    const spec = { controls: [{ default: 1, id: "speed" }] } as unknown as AnimationSpec;
    const value = { activeId: "a", items: [scene("a"), scene("b", { motion: false, start: "previous" })] };
    const frame = sceneFrame(live, defaults, resolveScenes(value, 8), 6);
    const params = sceneParams(spec, frame);
    expect(params.__noMotion).toBe(true);
    expect(params.__base).toEqual({ motion: true, params: { __text: { t: "x" }, speed: 2 }, plan: undefined, planLayers: {}, time: 4 });
    const first = sceneParams(spec, sceneFrame(live, defaults, resolveScenes(value, 8), 1));
    expect(first.__noMotion).toBeUndefined();
    expect(first.__base).toBeUndefined();
  });

  it("reads saved scenes safely and numbers new ones", () => {
    expect(readScenes({ items: [{ id: "x" }, { id: "x" }, 4, { name: "no id" }] }).items).toHaveLength(1);
    expect(readScenes({ activeId: "gone", items: [{ id: "x" }] }).activeId).toBe("x");
    expect(nextSceneName([{ name: "Scene_01" }, { name: "Scene_04" }])).toBe("Scene_05");
    expect(nextSceneName([{ name: "Intro" }])).toBe("Scene_02");
  });
});

import { setScenePreview, addScene, changeScene, moveScene, planLayerGroups, removeScene, selectScene, SCENES_TARGET } from "./scenes";

describe("editing scenes", () => {
  const context = { defaults, timelineSeconds: 10, values: { ...live, [SCENES_TARGET]: undefined } };

  it("adds an empty scene, makes it the one on show and keeps the first scene with its settings", () => {
    const edit = addScene(context, null);
    const saved = readScenes(edit.values[SCENES_TARGET]);
    expect(saved.items.map((item) => item.name)).toEqual(["Scene", "Scene_02"]);
    expect(saved.items[0]?.duration).toBe(10);
    expect(saved.items[0]?.slice["sound.sfx"]).toBe(true);
    expect(saved.items[1]?.motion).toBe(false);
    expect(saved.activeId).toBe(saved.items[1]?.id);
    expect(edit.durationSeconds).toBe(13);
    expect(edit.values["sound.sfx"]).toBe(false);
    expect(edit.values["interactions.list"]).toEqual([]);
  });

  it("duplicates a scene with its settings", () => {
    const edit = addScene(context, "scene-1");
    const saved = readScenes(edit.values[SCENES_TARGET]);
    expect(saved.items).toHaveLength(2);
    expect(saved.items[1]?.slice["sound.sfx"]).toBe(true);
    expect(saved.items[1]?.motion).toBe(true);
    expect(saved.items[1]?.duration).toBe(10);
    expect(edit.durationSeconds).toBe(20);
    expect(edit.values["sound.sfx"]).toBeUndefined();
  });

  it("switches scenes, saving the one on show first", () => {
    const added = addScene(context, null);
    const second = { ...live, ...added.values };
    const back = selectScene({ defaults, timelineSeconds: 13, values: second }, "scene-1");
    const saved = readScenes(back?.values[SCENES_TARGET]);
    expect(saved.activeId).toBe("scene-1");
    expect(saved.items[1]?.slice["sound.sfx"]).toBe(false);
    expect(back?.values["sound.sfx"]).toBe(true);
    expect(back?.values["interactions.list"]).toEqual([{ id: "a" }]);
  });

  it("removes, reorders and changes scenes", () => {
    const added = addScene(context, null);
    const values = { ...live, ...added.values };
    const ctx = { defaults, timelineSeconds: 13, values };
    const second = readScenes(added.values[SCENES_TARGET]).items[1]?.id ?? "";
    expect(removeScene({ defaults, timelineSeconds: 10, values: live }, "scene-1")).toBeNull();
    const removed = removeScene(ctx, second);
    expect(readScenes(removed?.values[SCENES_TARGET]).items).toHaveLength(1);
    expect(removed?.durationSeconds).toBe(10);
    const moved = moveScene(ctx, second, -1);
    expect(readScenes(moved?.values[SCENES_TARGET]).items.map((item) => item.id)).toEqual([second, "scene-1"]);
    expect(moveScene(ctx, "scene-1", -1)).toBeNull();
    const changed = changeScene(ctx, second, { duration: 6.666, name: " Intro ", start: "previous" });
    const item = readScenes(changed?.values[SCENES_TARGET]).items[1];
    expect([item?.duration, item?.name, item?.start]).toEqual([6.67, "Intro", "previous"]);
    expect(changed?.durationSeconds).toBe(16.67);
  });

  it("finds the drawn layers a plan animation's group holds", () => {
    const layers = [
      { id: "g", kind: "group", name: "Card" },
      { id: "a", kind: "layer", name: "Title", parentGroupId: "g" },
      { id: "h", kind: "group", name: "Inner", parentGroupId: "g" },
      { id: "b", kind: "layer", name: "Title", parentGroupId: "h" },
      { id: "c", kind: "layer", name: "Cursor" },
    ];
    const plan = { animations: [{ layer: "Card" }, { layer: "c" }, { layer: "Title" }, { layer: "" }] };
    expect(planLayerGroups(layers, plan)).toEqual({ Card: ["a", "b"], Title: ["a", "b"], c: ["c"] });
  });

  it("keeps the segment wise preview switch through every edit", () => {
    const on = setScenePreview(context, true);
    expect(readScenes(on.values[SCENES_TARGET]).preview).toBe(true);
    expect(on.durationSeconds).toBeNull();
    const withPreview = { ...live, ...on.values };
    const added = addScene({ defaults, timelineSeconds: 10, values: withPreview }, null);
    expect(readScenes(added.values[SCENES_TARGET]).preview).toBe(true);
    expect(resolveScenes(added.values[SCENES_TARGET], 10).preview).toBe(true);
    // One scene has nothing to preview.
    expect(resolveScenes(on.values[SCENES_TARGET], 10).preview).toBe(false);
  });
});

describe("scene cameras join up", () => {
  const pose = (zoom: number) => ({ pitch: 0, yaw: 0, zoom });
  const cam = (from: number, to: number) => ({ delay: 0, duration: 1, focusX: 50, focusY: 50, from: pose(from), to: pose(to) });
  const context = {
    defaults,
    timelineSeconds: 10,
    values: { ...live, [SCENES_TARGET]: { activeId: "a", items: [scene("a", { camera: cam(1, 2) }), scene("b", { camera: cam(2, 3) }), scene("c", { camera: cam(5, 6) })] } },
  };

  it("moves the next scene's start when a scene's end pose changes", () => {
    const edit = changeScene(context, "a", { camera: cam(1, 2.5) });
    const items = readScenes(edit?.values[SCENES_TARGET]).items;
    expect(items[1]?.camera?.from.zoom).toBe(2.5);
    expect(items[1]?.camera?.to.zoom).toBe(3);
  });

  it("moves the earlier scene's end when a scene's start pose changes", () => {
    const edit = changeScene(context, "b", { camera: cam(1.5, 3) });
    const items = readScenes(edit?.values[SCENES_TARGET]).items;
    expect(items[0]?.camera?.to.zoom).toBe(1.5);
  });

  it("leaves a scene whose camera did not start from this one alone", () => {
    const edit = changeScene(context, "b", { camera: cam(2, 3.5) });
    const items = readScenes(edit?.values[SCENES_TARGET]).items;
    expect(items[2]?.camera?.from.zoom).toBe(5);
  });
});

describe("segments", () => {
  it("starts a new canvas with Start, Logo animation, Motion In and End, 10 s together", () => {
    const set = defaultSceneSet();
    expect(set.items.map((item) => item.name)).toEqual(["Start", "Logo animation", "Motion In", "End"]);
    expect(set.items.map((item) => item.duration)).toEqual([1, 2, 6, 1]);
    expect(SEGMENTS_SECONDS).toBe(10);
    expect(set.activeId).toBe("scene-1");
  });

  it("splits the only scene into the four segments, the scene's motion going to Motion In", () => {
    const context = { defaults, timelineSeconds: 8, values: { ...live } };
    const edit = splitIntoSegments(context);
    expect(edit).not.toBeNull();
    const saved = readScenes(edit?.values[SCENES_TARGET]);
    expect(saved.items.map((item) => item.name)).toEqual(["Start", "Logo animation", "Motion In", "End"]);
    expect(edit?.durationSeconds).toBe(10);
    const motionIn = saved.items.find((item) => item.name === "Motion In");
    expect(saved.activeId).toBe(motionIn?.id);
    expect(motionIn?.motion).toBe(true);
    expect(motionIn?.slice["sound.sfx"]).toBe(true);
    expect(saved.items.find((item) => item.name === "Start")?.motion).toBe(false);
  });

  it("does nothing when the project already has several scenes", () => {
    const values = { ...live, [SCENES_TARGET]: { activeId: "a", items: [scene("a"), scene("b")], preview: false } };
    expect(splitIntoSegments({ defaults, timelineSeconds: 8, values })).toBeNull();
  });
});

describe("default scene name", () => {
  it("calls a project's only scene saved as Scene_01 \"Scene\", and leaves several scenes alone", () => {
    expect(readScenes({ activeId: "a", items: [scene("a", { name: "Scene_01" })], preview: false }).items[0]?.name).toBe("Scene");
    const several = readScenes({ activeId: "a", items: [scene("a", { name: "Scene_01" }), scene("b", { name: "Scene_02" })], preview: false });
    expect(several.items.map((item) => item.name)).toEqual(["Scene_01", "Scene_02"]);
  });
});

describe("snapToScenes", () => {
  it("snaps to the nearest scene start or end within reach, else leaves the time alone", () => {
    const scenes = { items: [{ end: 1.5, start: 0 }, { end: 4, start: 1.5 }] } as unknown as Parameters<typeof snapToScenes>[0];
    expect(snapToScenes(scenes, 1.45, 0.1)).toBe(1.5);
    expect(snapToScenes(scenes, 3.95, 0.1)).toBe(4);
    expect(snapToScenes(scenes, 0.04, 0.1)).toBe(0);
    expect(snapToScenes(scenes, 2.5, 0.1)).toBe(2.5);
  });
});

describe("overlapping scenes", () => {
  const value = (lead: number) => ({
    activeId: "a",
    items: [
      { duration: 2, id: "a", motion: true, name: "A", slice: {}, start: "design" },
      { duration: 3, id: "b", lead, motion: true, name: "B", slice: {}, start: "design" },
      { duration: 1, id: "c", motion: true, name: "C", slice: {}, start: "design" },
    ],
  });

  it("starts a scene before the one ahead of it ends and counts the total from the last end", () => {
    const scenes = resolveScenes(value(0.5), 6);
    expect(scenes.items.map((item) => [item.start, item.end, item.lead])).toEqual([[0, 2, 0], [1.5, 4.5, 0.5], [4.5, 5.5, 0]]);
    expect(scenes.total).toBe(5.5);
    expect(resolveScenes(value(0), 6).total).toBe(6);
  });

  it("shows the scene that started last and lists the one it overlaps", () => {
    const scenes = resolveScenes(value(0.5), 6);
    expect(sceneAt(scenes, 1.0).scene.id).toBe("a");
    expect(sceneAt(scenes, 1.7).scene.id).toBe("b");
    expect(scenesOverlapping(scenes, 1.7).map((item) => item.scene.id)).toEqual(["a"]);
    expect(scenesOverlapping(scenes, 2.5)).toEqual([]);
  });

  it("changes how much a scene overlaps and keeps the project length in step", () => {
    const context = { defaults: {}, timelineSeconds: 6, values: { [SCENES_TARGET]: value(0) } };
    const edit = changeScene(context, "b", { lead: 0.5 });
    expect(edit?.durationSeconds).toBe(5.5);
  });
});

describe("scene presets", () => {
  it("offers four presets and splits the only scene into the chosen one", () => {
    expect(SCENE_PRESETS.map((preset) => presetSeconds(preset))).toEqual([10, 8, 7, 6]);
    const context = { defaults, timelineSeconds: 8, values: { ...live } };
    const simple = splitIntoPreset(context, "simple");
    const saved = readScenes(simple?.values[SCENES_TARGET]);
    expect(saved.items.map((item) => item.name)).toEqual(["Start", "Motion In", "End"]);
    expect(simple?.durationSeconds).toBe(8);
    expect(saved.items.find((item) => item.name === "Motion In")?.motion).toBe(true);
    const short = readScenes(splitIntoPreset(context, "short")?.values[SCENES_TARGET]);
    expect(short.items.map((item) => item.name)).toEqual(["Motion In", "End"]);
    const only = readScenes(splitIntoPreset(context, "motion")?.values[SCENES_TARGET]);
    expect(only.items.map((item) => [item.name, item.duration])).toEqual([["Motion In", 6]]);
    expect(only.items[0]?.motion).toBe(true);
    expect(splitIntoPreset(context, "nope")).toBeNull();
  });
});

describe("reset scenes", () => {
  it("is allowed while no scene has motion, and gives one scene as long as the whole motion", () => {
    const context = { defaults, timelineSeconds: 8, values: { ...live } };
    const split = splitIntoPreset(context, "logo");
    const values: Record<string, unknown> = { ...live, ...split?.values };
    const scenes = resolveScenes(values[SCENES_TARGET], 10);
    expect(scenesHaveMotion(values, defaults, scenes)).toBe(false);
    const reset = resetScenes({ defaults, timelineSeconds: 10, values });
    const saved = readScenes(reset?.values[SCENES_TARGET]);
    expect(saved.items.map((item) => [item.name, item.duration])).toEqual([["Scene", 10]]);
    expect(reset?.durationSeconds).toBe(10);
    expect(resetScenes({ defaults, timelineSeconds: 8, values: { ...live } })).toBeNull();
  });

  it("sees the motion of a scene: a layer effect, a Reactor item or a camera", () => {
    const context = { defaults, timelineSeconds: 8, values: { ...live } };
    const split = splitIntoPreset(context, "simple");
    const base: Record<string, unknown> = { ...live, ...split?.values };
    const withEffect: Record<string, unknown> = { ...base, [ANIMATION_PARAMS_TARGET]: { plan: { animations: [{ delay: 0, duration: 1, effect: "fade", enabled: true, id: "a", layer: "", name: "A", segmentId: null }], segments: [] } } };
    expect(scenesHaveMotion(withEffect, defaults, resolveScenes(withEffect[SCENES_TARGET], 8))).toBe(true);
  });
});
