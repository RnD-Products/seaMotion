# seaMotion motion guide for AI agents

Read this before you build, change or explain motion in seaMotion. It describes how motion works in
this app, the words the user uses, and the traps that already cost time. The framework rules in
`AGENTS.md` and `docs/toolcraft/*` still apply (never edit `src/toolcraft`, keep
`docs/toolcraft/agent-worklog.md` current, one worklog entry per change).

## 1. What a project is

A project is one design plus how it moves. Each project has its own animation, layers, canvas size,
frame settings, kit items, mockup and Scroll plan. Projects are saved as `.json` files by the
auto-save helper into `~/Documents/seaMotion/Recovered/` (format `mo-app-project`, version 2). The
finished page assets and tools for the BaseCase page are in
`~/Documents/seaMotion/Projects/BaseCase Landingpage Motion/`.

Motion types (Motion tab > Motion Type, stored per project as `motion.type`):

| Type | What it is |
|---|---|
| Animation | A drawing script with layers that move, plus the Interactions Kit. |
| Landing Page | A tall page scrolled through a window by the Scroll plan. |
| Lottie Animation | A Lottie (Bodymovin) animation the app plays and exports as `.json` or `.lottie`. Build it only with the features in section 2b. |
| Dashboard, App | Locked ("soon"). Do not build them unless asked. |

## 2. The Landing Page model (the part you will edit most)

A Landing Page project carries an animation spec (`AnimationSpec` in
`src/app/animation/animation-spec.ts`) whose `page` field says how tall the page is, the window
size and the sections:

```json
"page": { "height": 8825, "viewport": { "width": 1280, "height": 832 },
          "sections": [{ "id": "section-hero", "name": "Hero", "top": 0, "height": 832 }] }
```

The spec's script draws the page through the window. It does not decide how far to scroll: the app
tells it with `frame.params.__scrollY` (px from the top of the page). Never put scroll timing in the
script. The Start (preloader or intro) is drawn by the app, not the script
(`src/app/animation/start-screen.ts`, called from `drawFramedBitmap` in `frame-transform.ts`).

### The Scroll plan (`landing.plan`, per project)

Code: `landing-plan.ts` (logic and types), `scroll-plan-control.tsx` (panel),
`landing-loop.ts` (looped segments), `animation-canvas.tsx` and `mo/mo-render.ts`
(they turn the plan into `__scrollY` and the Start, for the canvas and for export).

```jsonc
{
  "easing": "custom",           // plan default: lenis | smooth | out | in | linear | expo-in-out | overshoot | custom (a NEW plan starts as custom 0.68, 0, 0.2, 1)
  "customEasing": "0.68, 0, 0.2, 1",   // a cubic-bezier, used when easing is "custom"
  "secondEasing": "custom",     // "2nd plan default": the easing of every 2nd At that follows the plan (a NEW plan starts as custom 0, 0, 0.42, 0.82; an older plan without it starts equal to `easing`)
  "secondCustomEasing": "0, 0, 0.42, 0.82",   // its pasted curve when secondEasing is "custom"
  "start": [                    // Start parts, played in order (empty = no Start)
    { "id": "start-1", "preset": "thumbnail", "duration": 1, "color": "#5B5CF6" },  // still of the page top
    { "id": "start-2", "preset": "dots", "duration": 2, "color": "#5B5CF6" }        // then a preloader / intro
  ],                            // `loading` is derived (sum of durations); old loading/loadingStyle/startColor migrate to one part
  "blur": { "amount": 30, "preview": true },   // motion blur of the scroll: 0 = off, 100 = shutter open 1/30 s; preview false hides it on the canvas only (a render always has it)
  "end": { "mode": "hold", "hold": 0, "travel": 1.6 },   // mode: hold | top | reload
  "steps": [
    {
      "id": "step-1", "kind": "scroll",   // or "reload"
      "scroll": 832,            // px to scroll FROM WHERE THE PAGE IS: positive down, negative back up
      "travel": 0.8,            // shown to the user as "Scroll time (s)": how long this scroll takes
      "pause": 0.7,             // shown as "Hold (s)": how long it stays after everything has landed
      "easing": "plan",         // "plan" = follow the plan; or a preset id; "custom" uses customEasing
      "name": "",               // optional card name; empty means the section it lands in
      "second": null            // or the nested 2nd At, below
    }
  ]
}
```

Nested second scroll ("2nd At"), `second` on a step:

```jsonc
{ "offset": 120,   // extra px past where the step lands; positive down, negative up
  "travel": 0.8,   // its Scroll time
  "delay": 0.3,    // seconds after the step STARTS (it may start while the first scroll still runs)
  "easing": "plan" }
```

Rules you must keep:

- **A step value is a distance, never a page position.** `scroll: 400` scrolls down 400 px from
  wherever the page is; `scroll: -450` scrolls back up 450 px. Where a step lands is the running sum,
  clamped to `[0, page height - window height]`, so changing one step moves every later step.
  The panel shows "Lands at N px" for you. Plans saved with absolute `y` positions are converted when
  they are read (`readLandingPlan`); do not write `y` any more.
- **Timing of a step:** it starts when the previous step is over; the first scroll runs `travel`
  seconds; the 2nd At starts `delay` seconds after the step starts and carries on from wherever the
  page is (no jump); `pause` (Hold) starts after both are over. The timeline length is the plan's
  length and is set by the canvas, so never set the timeline duration by hand for a Landing Page.
- **Easing** applies to a step's scroll; a 2nd At has its own. A "Plan default" step is stored as the
  word `"plan"`.
- **Start** comes first and is a list of parts (`start[]`), each with its own preset, duration and color
  (`startAt(plan, time)` finds the active part; `withStart`, `newStartPart` edit the list). `thumbnail`
  holds a still of the page top, which makes a loop with End "top" seam into it. Preloaders (spinner, bar, dots,
  ring, counter, pulse) cover the page; intro transitions (fade, slide, zoom, blur, wipe, center) change
  how the page is drawn. To add a preset, add a row to `START_PRESETS` and a case in `drawPreloader`
  or `applyIntro` in `start-screen.ts`.
- **End** comes last: `hold` stays on the bottom, `top` scrolls back to the top over `travel` (a
  loop), `reload` cuts to the top.
- With no stored steps the project uses `autoSteps(page)` (a stop at every section, extra stops in tall
  sections, a last stop at the bottom). Any edit stores the steps.

### Replacing a picture (Layer files)

A layer painted with pictures lists them in the Modifier tab's "Layer files" (click a picture to replace it). A page imported
layer by layer keeps `layerImages` in its spec (layer id -> asset keys, made by `build_layered.py`); replacing writes the new
picture under the same key and bumps the spec `version` so the drawing reloads. Pictures cover their box
(`preserveAspectRatio="xMidYMid slice"`), so a replacement of another shape fills it.

### Section animation (`landing.sections`, per project, keyed by section name)

Motion tab > Section animation (`section-motion-control.tsx`, logic in `landing-motion.ts`). For each section: `enabled`,
`trigger` (`start` = right after the Start / `view` = when the section scrolls into view), `stagger` (0.05 s) and `items`:
one per layer (a leaf of the section's Layers tree) with `fade`, `blur` px, `scale` % to start from, `slide`
(none/bottom/top/left/right) and `distance`, `loop` (none/float/rotate/floatRotate/pulse), `duration`, `delay`, and
`withPrevious` (starts together with the item above, otherwise one stagger later). The app works out each layer's look per
frame (`allFx`) and passes it in `params.__fx` (layer id -> blur, dx, dy, opacity, rotate, scale); the page's script
(`tools/apply_layered.py`) takes those layers out of the section picture and draws each one on its own with that look.
While the Start's first part is a thumbnail the layers sit in place. A "Hero preset" button fills the BaseCase Hero.

### Turning a motion description into a plan

| The user says | Do this |
|---|---|
| "scroll down 400" / "go back 450" | `scroll: 400` / `scroll: -450` |
| "scroll takes 1.2 seconds" | `travel: 1.2` (label: Scroll time) |
| "wait / hold 2 seconds" | `pause: 2` (label: Hold) |
| "feel smoother, overlap the scrolls" | give the step a `second` with a small `delay` and its own easing |
| "loading before the page" | a Start part with a preloader preset and a duration |
| "keep the top as a thumbnail, then preloader" | Start part 1 `thumbnail`, part 2 a preloader |
| "page fades in" | a Start part with an intro preset such as `fade` |
| "loop it" | `end.mode: "top"` (the first frame is the Start, so a loop with a loader is not seamless) |
| "go back to top / reload" | a step with `scroll` equal to minus where it is, or `kind: "reload"` |

### An Animation-type project built on a pasted design (Research Signals Card 3)

The pasted design's script can carry its own motion: a `stateAt(params, time)` that returns a camera, per-layer
changes (x, w, alpha, text, invert) and extra shapes, applied before each `drawItem`. Clips of a moved layer's parts follow
it (matched by box). Its motion settings are spec `controls` (they show in Motion > Animation, grouped by `group`; ids
must not start with a layer's slug). A screen-space layer named "Cursor" gives the Reactor a cursor to follow (its
tip = top-left of what it draws); the Reactor items are stored timings, so re-time them when the motion's times change.
While dragging, the script draws the same grabbing hand as the Reactor's Drag item (`grabHand` in `interactions.ts`,
1.35x the size); the Reactor places its hand by the hand's painted top-left, so the two line up.

### Motion on a design pasted with the current plugin (`spec.design.motion`)

Designs pasted since the block format (spec `design`, drawn by the shared design script in
`src/app/mo/figma-paste-import.ts`) take motion as a script string in `design.motion`, not as a copy of the drawing
code, so fixes to the shared script keep reaching them. It is run as `new Function("api", "D", "H", motion)` and returns
`{ init?, stateAt(params, time, frame), drawLayer?(ctx, id, state, frame), getSegments?(params) }`. `stateAt` returns
`{ items: { [layerId]: { dx, dy, sx, sy, ox, oy, alpha, text, clip, hidden, draw(ctx, item, H) } }, ... }`: changes
applied while each pasted layer is drawn (in its block's coordinates); `H` has `drawItem`, `outline`, `paintStyle`,
`rgba`, `images`, `view`. Layers that are not part of the design (a "Cursor") are added to `spec.layers` and the Layers
panel and drawn by `drawLayer` in design coordinates. `getSegments` feeds the Interaction plan cards; settings are
spec `controls` (grouped by `group`). Example: PropVera_Header v_01 (`docs/mo-app/propvera-header-motion.template.js`,
filled with layer ids and chart geometry by a builder): cursor pages with the gallery arrows, numbers count to the next
property's values with a stagger, the gauge re-sweeps, bars resize and dot-chart columns light up or down.

## 2b. Lottie Animation projects (`motion.type: "lottie"`)

When the project's Motion Type is **Lottie Animation**, everything you build must export to Lottie. Do not
write a drawing script: the motion lives in Lottie JSON, and only the features below are allowed.

**What the project holds.** `spec.lottie` is the Bodymovin JSON; `spec.code` is not used. The app plays it with
the lottie-web light canvas player (no expressions) inside the animation sandbox
(`src/app/lottie/lottie-runtime.ts`), so the preview shows what players without expressions show. Each
top-level Lottie layer is a design layer with id `lottie-<ind>`; hiding it in the Layers panel and the Layer
section's blend and opacity are written into the file on export (`prepareLottie` in `lottie-data.ts`).
Project tab › **Render and Export** › Format **Lottie** writes Lottie JSON or dotLottie (`lottie-export.ts`); the footer
button then reads Export (relabelled in `mo-inspector-labels.ts`). The red list under Motion Type and in Render and Export comes from `checkLottieExport` in `lottie-support.ts`: each item says what, why and
what to do. Add a check there whenever you find another feature a player cannot draw.

**How a Lottie project starts.** Open a Lottie `.json` with Open project › Browse files (or put it in
`~/Documents/seaMotion/Recovered/` and pick it from the list): `parseProjectFile` sees a Bodymovin file and
`buildProjectFromLottie` makes the project (canvas = `w`×`h`, timeline = `(op - ip) / fr`, frame fill off).
To build a new animation, write the Lottie JSON yourself, save it as a `.json` there and open it. To change an
open one, follow the "do not edit a file while it is open" trap in section 5 and bump `spec.version`.

**Use only these (they play the same in lottie-web, lottie-ios, lottie-android and dotLottie):**

| Area | Allowed |
|---|---|
| Layers | Shape (`ty: 4`), Solid (`1`), Null (`3`) for parenting, Precomp (`0`, with time remap), Image (`2`) only with the picture embedded (`p` is a `data:` URL, `e: 1`). |
| Shapes | Group, Rectangle (with roundness), Ellipse, Path, Polystar, Fill, Stroke (caps, joins, dashes), Gradient fill and stroke, Trim Paths, Repeater, Round Corners, group Transform. |
| Transform | Anchor, Position (also split X/Y), Scale, Rotation, Opacity, Skew, Parent, Auto-orient. |
| Keyframes | Bezier easing (`i`/`o` handles), hold keyframes (`h: 1`), any frame rate (use 30 or 60). |
| Masks and mattes | Masks in Add, Subtract or None mode with no expansion; alpha and alpha-inverted track mattes. |
| Text | Only as shapes (outlines), or with glyphs in `chars`. Live font text is not drawn by canvas players. |

**Never use (the check shows them in red):** expressions, effects (blur, glow, drop shadow), layer styles, 3D layers,
cameras, audio layers, Merge Paths, Offset Paths, Pucker & Bloat, Twist, Zig Zag, blend modes, Intersect / Lighten
/ Darken / Difference masks, mask expansion, motion blur, linked (not embedded) images, live text without glyphs.
Fake blur and glow with soft gradient shapes and opacity; fake depth with scale and position.

**Not in the file even when on:** the Reactor (cursor, taps, drags: add them as Lottie layers instead), Sound,
Frame Settings fill / stroke / rounded clip / rotation / opacity / perspective, the mockup and stickies. Use Render and
Export › Lottie › Background layer for a solid colour behind the animation. Keep the timeline equal to the file's length.

**Rules for files you write:** `ip: 0`; `w`, `h` = the design size; a name (`nm`) and a unique `ind` on every layer;
first and last frame identical so it loops without a jump; shapes rather than pictures to keep the file small.

**Check before you hand it over:** open the project, play it, and see "Everything in this project exports to
Lottie" under Motion Type (no red items); run `npx vitest run src/app/lottie`.

## 2c. Video and GIF layers (any motion type)

MP4, WebM and GIF files work in every project. Open project › **Browse files…** opens one as a new Animation
project at its own size and length (`buildProjectFromMedia`); the sidebar's **Import › Video & GIF › Add video or GIF** adds
one as a layer on top of the open project's design (`withMediaLayer`; a project with no animation gets one that
draws only the video). The file is stored in the spec's `assets` (data: URL, 40 MB limit) and described in
`spec.media[layerId]` (`kind`, `fit` cover/contain, `width`, `height`, `duration`); code in `src/app/media/`.
`AnimationSandbox` decodes it in the app (mediabunny for MP4/WebM, ImageDecoder for GIF; the script never sees
the file), loops it on the timeline and sends the picture with each frame; the sandbox runtime draws it at its
place in the layer stack, between groups of the design's own layers, with the Layer section's blend and opacity.
So Layers order and visibility, preview, Build preview and Render all include it. Video sound is not used. A Lottie
export lists video layers in red (a Lottie file cannot hold video).

**Pictures that play.** In Modifier › Layer files a picture can be replaced by (or added as) an MP4, WebM or GIF.
`withAnimatedPicture` keeps the clip's first frame as the picture (`assets[key]`, what scripts load) and the clip in
`assets["<key>.media"]`, described in `spec.assetMedia[key]`. The sandbox runtime tags images whose `src` is that
first frame and, while a frame is drawn, `drawImage` / `createPattern` of a tagged image use the clip's current
picture, so it plays in the picture's own box with no script change. A pattern a script builds once in `init`
stays still. Replacing it with an image again removes the clip (`withoutAnimatedPicture`).

## 2d. Scenes (Interaction Animation, Motion tab > Scenes Segment)

An Interaction Animation project plays a list of **scenes** one after another. Code: `src/app/animation/scenes.ts` (logic and
tests in `scenes.test.ts`), `scenes-control.tsx` (the section), `scene-duration.ts` (timeline length, scene offset),
`scene-sound.ts` (sound of all scenes). Value `scenes.items` = `{ activeId, items: [{ id, name, duration, motion, start, slice }] }`.

- **What a scene owns:** the animation's own controls and the hand-built Interaction plan (`animation.params` keys that do not
  start with `__`), the Reactor (`interactions.*`) and the sound (`sound.*`). The design, layers, pictures, texts, frame and
  the `__` params are shared by every scene.
- **How it is stored:** the scene on show is edited in the ordinary controls, so its settings are the live values; the others
  keep theirs in `slice`. Selecting a scene saves the live settings into the old scene's `slice` and applies the new
  scene's (`selectScene`, one `controls.apply`, so one undo). A setting a scene never saved is its default. No saved
  scenes = one implicit scene named "Scene" as long as the timeline; existing projects need no migration. With one scene the timeline
  length is the scene's length; with several the timeline is the sum of the scenes (`useSceneDurationSync`: changing the
  timeline length elsewhere changes the scene on show by the same amount).
- **Time:** every consumer maps the timeline time to a scene and the scene's own time (`resolveProjectScenes`, `sceneFrame`):
  the canvas (`animation-canvas.tsx`), the render (`createFramePainter` in `mo-render.ts`) and the sound (`sound-player.ts`,
  `buildRenderSound`: every scene's soundtrack is built on its own and laid one after another). The Interaction plan rail
  shifts the scene's times by the scene's start (`useSceneOffset`, `useSegmentSchedule`).
- **Motion on/off:** `Scene.motion` says whether the scene runs the design's own motion script (`design.motion`). Scene_01
  does; a new scene does not (`params.__noMotion`) and shows the hand-built Interaction plan editor instead. A duplicate
  copies the source scene's setup, including `motion`.
- **Hand-built plan is drawn:** the design script reads `params.plan` (segments one after another, animations on a layer by
  name) and brings the layer in: Fade from clear, Move up from below (40 px), Scale from 80 %, Blur from soft, easing out over
  the animation's Duration. A whole-frame animation (layer empty) works on every drawn layer; a group works on what it holds
  (`planLayerGroups`, passed as `params.__planLayers`).
- **Starts from:** `design` (the pasted design) or `previous`: the scene before it ended; the design script draws that
  scene's motion at its last moment (and its plan) underneath this scene's own (`params.__base`). Own design per scene is not
  built (the first scene's design is every scene's).
- **Versions** keep every scene (`scenes.items` with each scene's settings) instead of the live scene settings, so switching
  scenes never counts as a change to a version; a version saved before scenes existed loads into the scene on show.
- **Segment wise preview** (switch under the section title, `scenes.items.preview`): while on, the preview plays only the scene on
  show, looping it; showing another scene takes the playhead to its start (`useScenePreview`). Renders always play every scene.
- **Where playback stops, that scene is shown** (segment wise preview off): when the timeline stops, the scene the playhead is in
  becomes the scene on show, as if clicked (`useSceneFollow`). While it plays the selection stays; moving a paused playhead changes nothing.
- **Scene role (`Scene.role`):** a scene can play one part of the design's motion script: the script is told `params.__stage`
  (the role) and the scene's own time, and returns that part's segment (`getSegments`) and picture (`stateAt`). A part starts from
  where the part before it ended (the script knows the end state of every earlier part), so scenes join up with no "Previous end".
  The Interaction plan shows only the controls of the scene's part (control groups start with the role's number, "03 · Next"). Example:
  PropVera_Header v_09 (`docs/mo-app/propvera-header-motion.template.js`, built by `propvera-header-scenes.build.py`): Start, Scene_01
  Cursor in, Scene_02 Move for Arrows, Scene_03 Next (first right click, pager 02, ALL areas count to page 02 values; then the second click, pager 03: Delay before click, Click time, Delay 2nd click, Data delay after click, Count time, Stagger, Hold after), Scene_04 /
  05 / 06 Data change of img-01 (key stats) / img-02 (Occupancy, Rent collection) / img-03 (Maintenance, Net operating income), each area counting from the first click's values (page 02) to the second click's (page 03),
  Scene_07 Back twice (left click, pager 03 → 02 and ALL areas count back to page 02; Gap between clicks; second left click, pager 02 → 01 and all areas count back to page 01; settings: Data delay after click, Count time, Stagger, Hold after), Scene_08 Cursor out, End. Start (role 00) and End (role 09) are drawn by the same script as every other scene (everything on page 01, cursor hidden), so the first picture, the picture where Scene_01 begins and the last picture are pixel-identical; do not give them a hand-built plan (the design's own gauge and dot charts differ from the script's). The occupancy gauge on a change fades the old gauge out and then draws the new one in from the left (no erasing outward). Scene lengths are stored; change them if a part's times change.
- **Digits roll through several changes** (PropVera_Header v_15): every digit of a number that changes (the ones that stay the same too) rolls through a few other digits (Letter changes, 3) before it lands; text letters and signs ($, M, %, the point, words like Occupied) stand still. Each step the shown digit leaves (fades, slides up 10 px, blurs up to 5 px) while the next comes in from below. Digits start Letter stagger (0.04 s) after each other from the left and take Letter time (0.6 s) each. A rolling digit always sits in its own place of the new text (centered, squeezed when wider), so it never overlaps the letters or signs beside it. Settings are in the Shapes group; drawn by `drawLetters` / `rollOf` in the motion template.
- **Scene camera** (`Scene.camera`, `animation/camera.ts`, switch "Camera" in the Scenes Segment section): a move from one pose to another while the scene plays (`zoom`, `yaw` angle, `pitch` tilt, focus point in percent, `delay` and `duration`). The scene is drawn as usual on a buffer and `drawCameraView` places it in 3D inside the frame (`SceneCamera.area`, percent of the picture; the Scenes Segment sliders Frame X / Y / width / height / corners; PropVera_Header uses its Container box: x 5, y 6.667, width 90, height 86.667): zoom about the focus point (which never moves), a small angle with perspective, a soft vignette; the frame never moves and the picture always covers it (`coveringZoom` raises the zoom a little when an angle would let an edge in), so no background or edge shows. The preview (`animation-canvas.tsx`) and the render (`createFramePainter`) both do it, so the Reactor cursor moves with the picture. A move mixes zoom (in log space, so a push in feels even), angle, tilt and focus with one ease, so they start and end together; keep the angle and tilt the same in the poses of a pan (PropVera_Header: -4 / 2 in Scenes 04 to 07) so only the zoom in and the zoom out change them. Scenes join up when one scene's end pose is the next scene's start pose (zoom, angle, tilt and focus; editing one end in the Camera sliders moves the neighbour's start with it when they matched). Never read the autosave file right after another agent update to build the next one: it can be up to 10 s old and would write the older value back. A pose can name its own focus point (`focusX` / `focusY`, percent), so a move also pans from one place to another. PropVera_Header (all inside its Container frame): Scene_02 and Scene_03 are wide (no zoom); Scene_04 zooms in from the whole frame onto the top left of the frame (logo, menu, title, tags and the key stats; focus 5 %, 6.667 % = the frame's top left corner, zoom 2.05, angle 3, tilt 1.5, which gives way to 0 at a corner) and the data changes only after the zoom in (Delay 0.9 s), Scene_05 pans to the bottom left of the frame (filter chips, Occupancy and Rent collection, the two small buttons; focus 5 %, 93.333 % = the frame's bottom left corner, zoom 1.75 so the Rent collection card has a gap before the frame's right edge, angle 0 at a corner) and Scene_06 to the bottom right of the frame (the pager, Maintenance and Net operating income; focus 95 %, 93.333 % = the frame's bottom right corner, zoom 2.05, angle 0 at a corner), each changing its data after the move; Scene_07 zooms out to the whole frame in its first 0.8 s (the Back twice changes are seen wide) and Scene_08 stays wide. Each move takes 0.8 s at the start of its scene.
- **The plan's effects** (hand-built Interaction plan, `interaction-plan.ts`; drawn by `planState` in `figma-paste-import.ts`): Fade, Move,
  Scale and Blur (the old presets), and **Come in / Go out** (fade with an optional `blur` px, `slide` from or to a side by `distance` px and a
  `scale` % to start from or end at; the ease is out-cubic), **Letters in / Letters out** (the same per letter, one `stagger` s after the letter before; one-line texts), **Trim path** (outline layers only: a stroke draws along its length), **Turn 3D** (`angle` to flat about the vertical
  axis, in perspective for an outline layer; it waits flat until it starts, so 360 is one whole turn), **Mask out** (a band that opens across the layer from the middle of the frame to the top and the bottom at once until the layer is gone) **Rotate** (swings from an `angle` to where the layer is, about a pivot `px`, `py` in design pixels), **Sweep reveal** (the layer shows through a wedge from the left to the direction `angle`, as a gauge fills behind its needle), **Spin loop** and **Wave loop** (never stop: one turn, or one `distance` px wave length, every `period` s; set `phase` to the seconds the whole motion has run when the scene starts, and choose a period that divides the whole length, so every scene carries on from the one before and the end meets the start; a layer that turns or loops keeps the frames that cut it in place), **Count** (a text's number counts from `from`, 0, to its value, keeping its decimals, leading zeros, commas and the signs around it: "064", "72%", "1.8 m"; give it the text layer's name, or its id when another layer has the same name) and **Hide** (the layer is not drawn while
  the playhead is inside the animation's bar: use it for a layer that has no part in a scene, never a 0.05 s "Go out", which shows for one
  picture). A layer that has not started "Come in" is hidden, so a scene's layers wait in their start state. Names in `layer` are the Layers
  panel names (a group works on what it holds); each scene has its own plan (one segment per scene, animations by Start and Duration).
  Example: Cargora (`docs/mo-app/cargora-motion.build.py`): Start, Logo animation, Motion In, End, 11 s.
- Not built: dragging scenes to reorder (arrows are used), a different pasted design per scene.

## 2e. The live preview must never freeze (how it is kept safe)

- **Watchdog:** `LatestFrameScheduler` gives up a picture that fails or takes longer than 6 s, counts it (`data-preview-failed`,
  `data-preview-last-error` on the canvas), tells `AnimationSandbox.repair` (logs `[preview] ...` once per kind, closes the video
  readers so the next picture reopens them) and goes on with the next frame; a picture that arrives late is thrown away. Render
  requests to the sandbox time out too (`PICTURE_TIMEOUT_MS`).
- **Videos and GIFs** (`media/media-clip.ts`): read in order (about 1 ms a picture), a stuck decode is dropped after 4 s and falls back
  to a single read or the last picture; the preview asks for a copy no bigger than it draws (`previewWidth`), a render gets the full
  picture; clips open and decode their first picture when the project opens (`warmUp`).
- **Time of videos and GIFs** is the whole timeline's, never a scene's (`SandboxFrame.mediaTimeSeconds` / `mediaDurationSeconds`), so a
  clip runs once across all scenes instead of fast-forwarding in each.
- **Check before saying the preview works:** play the whole loop twice in the app and read the canvas data attributes
  (`data-preview-delivered` rising, `data-preview-failed` 0, `data-preview-render-factor`), and look at the console for `[preview]`.

## 3. User vocabulary (use these words in the UI and in answers)

Start, End, step, **Scroll At (px)**, **Scroll time (s)**, **Hold (s)**, **Delay (s)**, 2nd At,
Easing, Curve, segment, card, rail, ghost playhead, Frame, Mockup, Scene, Reactor.

**Rule: "interaction" / "interaction icon".** When the user says an interaction or interaction icon shows or happens at a time
in a motion plan (click, tap, drag, move, pinch, resize, typing, loading), build it as **Reactor** items (`interactions.enabled`
+ `interactions.list`, Reactor section, `src/app/animation/interactions.ts`) in the scene the plan describes, at the scene's
own seconds. Do not draw the icon or cursor in the design's motion script or as a layer. Do not say "travel", "pause",
"ripple" or "pin" to the user; they were renamed or removed.

## 4. The panel's interactions (what exists, so you do not rebuild it)

- A rail of equal cards: Start, steps, End. Hover highlights a card; click selects it and moves the
  playhead to it; click it again, click outside, or Esc deselects.
- The line between two dots is a segment. Idle 2px grey; hover shows the 4px blue stroke (the click
  area is exactly that 4px); click picks it to loop while the timeline plays; Shift-click adds more;
  a click anywhere else on the rail deselects and plays from that point (the ghost playhead shows
  there). Picks are session-only. Picking while playing moves the playhead into the segment.
- Double-click a step card name to rename it; Start and End titles are fixed.
- "Add to the plan" menu: Auto steps, add a step down / back / to the top / a reload. Each choice shows
  a short message and selects the new card.

## 5. Traps that already cost time

- **Workspace persistence drops removed keys.** Setting a key to `undefined` is not saved. Store an
  explicit value: `second: null`, `easing: "plan"`, `name: ""`.
- Saved state in `localStorage` can lag the screen by several seconds. When checking, wait or read the
  UI.
- **Change an open project through the agent channel (section 5b), never by editing its file.** Autosave writes the
  open project over its file every 10 s, so a file edit is lost; and do not switch away, delete and re-open it (the
  user sees the app jump around and loses edits made meanwhile). For a project that is not open: Switch to
  another project, edit the file in `~/Documents/seaMotion/Recovered/`, delete the in-app copy (trash in the
  Projects tab), then open the file from Open project. The helper (`scripts/project-autosave.mjs`, port
  3011) must be running (`npm run dev` starts it).
- The browser pane is shared with the user, who often clicks at the same time. If a test result looks
  impossible, someone else probably edited the same card. Check `document.title` first and put things
  back as you found them.
- Selects cannot disable options. Locked choices ("(soon)") are rejected in the handler and the select is
  remounted with a new `key`.
- A test mouse cannot reliably hit a 2px target; use element coordinates, not guesses.
- Product CSS is CSS modules only. Never import below `src/toolcraft/ui/components/**`; use the public
  barrel (`@/toolcraft/ui`).

- **The app's saved state is one browser-storage entry** (`toolcraft:mo-app:state:v2`) that includes a
  shared animation library keyed by animation id. Deleting a project does not remove its library entry, so
  big imports pile up (45 MB+) and a save that no longer fits fails silently: after a reload the OLD version
  returns and autosave writes it over the file. Fixes: give every import a fresh animation id
  (`apply_layered.py` / `apply_html.py` do), remove unused library entries (unreferenced ids in
  `values["animation.library"].items`), and after changing a file switch away, delete the in-app copy, wait ~6 s,
  then open the project from its file. Always re-read the file after a minute to be sure it was not overwritten.
  The autosave helper limit is 96 MB (`scripts/project-autosave.mjs`).

## 5b. Agent channel: change the open project in place, with progress on the artboard

`npm run dev` runs the helper that carries it (`scripts/project-autosave.mjs`, files in `~/.mo-app/agent/`); the app
polls it every 0.8 s (`mo-app-sidebar.tsx`, card in `mo-agent-overlay.tsx`). Use it for every motion or design change
to the project the user has open:

1. While working, report progress so the user sees it over the artboard (0-100%, a ring, an orange orbit, and the
   line under it saying what you are doing). Send a status at each step:
   `node scripts/mo-agent.mjs status "<open project name>" 30 "Writing the scroll motion…"`
2. Build the result as JSON: `{ "project": "<open project name>", "animation": <full spec, version + 1>,
   "params": {...}, "values": {...}, "layers": [...], "durationSeconds": 11.2, "version": "v_03" }` (every field but
   `project` is optional; `values` cannot touch the project list, versions or library; `layers` replaces the Layers
   panel list when it differs). Start from the project's latest autosave in `~/Documents/seaMotion/Recovered/`.
3. `node scripts/mo-agent.mjs apply <file.json>`. The app applies it to the open project in place (same project, no
   navigation), saves the result as a new version (the given name, else the next `v_NN`) and makes it active; the card
   ends with "Done · Saved as version v_03" and the channel clears. Check the result in the app afterwards.
4. Updates whose `project` is not the open project wait until it is opened. `node scripts/mo-agent.mjs clear` drops
   a status or update you no longer want. Every version stores the animation's script, controls and layer lists
   (`script` in the version, `src/app/mo/mo-versions.ts`) beside its settings, all inside the one project file;
   loading a version puts them back (the spec's version is raised so the drawing reloads). `"saveVersion": false`
   with `"versionScripts": { "<version name>": { code, controls, layers, panelLayers } }` attaches scripts to existing
   versions without saving a new one.

## 6. Importing a landing page from a design

1. The Figma MCP has a monthly call limit on the user's plan. If it is used up, export the frame from the
   user's Chrome (Claude in Chrome): select the frame, Export 1x PNG, then remove the export setting again
   so the Figma file is left as it was. Downloads land in `~/Downloads/<folder>/`.
2. Crop the page frame out of the export (the PNG may be wider than the frame because decoration
   overhangs: find the first fully opaque column) and cut it into the sections listed by the metadata.
3. The tools used for BaseCase are in `Projects/BaseCase Landingpage Motion/tools/`:
   `build_landing.py` makes the section JPEGs and `landing_assets.json`; `apply_landing.py` writes the
   animation spec (with `page`), the layer tree (Main > Screen > Frame group > sections) and keeps the
   project's values. They need Pillow.
4. A page imported as pictures has no editable text or shapes (the Layer section says so). Editable text
   needs a re-import from the design's real structure.

### Importing from an HTML + Tailwind export (Pencil, or any page with named elements)

Preferred over the SVG route when the user gives an `.html` export (Pencil: `Export(..., "html-tailwind", path)`).
Tools in `Projects/<name>/tools/`: `build_from_html.py <export.html>` (slims the page, serves it on port 8766),
open `http://127.0.0.1:8766/index.html` in the browser so `html_extract.js` can post the layout back,
then `apply_html.py` writes the project file. Each element with `data-pencil-name` becomes a layer; sections are the
root's direct children, drawn from real HTML + CSS (SVG foreignObject), cached per section. The Pencil MCP only
works while Pen.app is open with the file; the `.pen` file is plain JSON under `~/.pencil/documents/`.
After applying, switch to another project, delete the in-app copy, then reopen the file (autosave overwrites a
file whose project is open).

## 7. Verify and ship

- Dev server: `npm run dev` (app on 3002, auto-save helper on 3011). Open the app in the built-in browser.
- Checks: `npx tsc --noEmit -p tsconfig.json` and `npx vitest run src/app/animation/` (plan logic and loop
  logic have unit tests; add tests when you change them).
- Look at the app yourself with real clicks and read computed values; do not claim a UI works from the code.
- Add one entry per change to `docs/toolcraft/agent-worklog.md` (what, why, how it was checked, what was
  not checked).
- PRs go to `mr-imruu/Mo_App_v.02` (the app lives in its `Motion app/` folder): clone it into the
  scratchpad, `rsync` this folder in (without `node_modules`, `dist`, `.git`, `.toolcraft`), commit, push a
  new branch, `gh pr create`. Do not commit in the parent repo.

## 8. Not built yet (do not pretend it exists)

- Section entry / exit / loop motion per page section (waiting for the user's motion plan).
- Mockup choices (None, Fill, Browser mock, Image) are stored but not drawn; Device is locked.
- Motion Pins (notes on layers that sync to chat): planned only; build it only when the user says
  "Motion Pins".
