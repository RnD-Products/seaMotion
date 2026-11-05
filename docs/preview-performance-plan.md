# Preview Performance Plan

Status: Implemented

## 1. Reduce preview render scale

The editor preview defaults to render scale `1` instead of `2`. On the same display this reduces preview canvas pixels by 75%.

Preview and export quality remain separate:

- `Preview quality` controls the interactive canvas resolution.
- Render format, FPS, and output resolution continue to control exported files independently.
- Existing projects synchronize `preview.quality` with the runtime `canvas.renderScale` value without changing export resolution.

## 2. Prevent repeated rebuilding of section pictures

The landing-page renderer no longer keeps only four section pictures. It uses a 128 MB memory-budgeted LRU cache.

The eviction policy prioritizes:

1. The currently visible section.
2. Nearby sections prepared for upcoming scrolling.
3. All other cached sections.

Within the same priority, the least recently used picture is removed first. The cache records:

- hits;
- pending-request hits;
- misses;
- evictions;
- entry count;
- estimated pixel memory in bytes.

These counters are exposed as renderer diagnostic state through `__moPreviewCacheStats`.

## 3. Reuse drawing buffers

Preview frames use a reusable pool of offscreen canvas surfaces instead of allocating a new drawing canvas for every frame.

The pool:

- leases separate surfaces for concurrent preview and export work;
- resets each 2D context before reuse;
- keeps at most two idle surfaces;
- limits retained idle surface memory to 96 MB;
- releases oversized or excess surfaces;
- transfers completed frames as `ImageBitmap` objects;
- closes each transferred bitmap after the visible canvas consumes it.

## 4. Skip individual offscreen layers

Moving, grouped, and custom-styled layers are culled independently after section culling. Before the renderer builds or draws an individual layer picture, it computes that element's current transformed bounds.

The visibility bounds include:

- the element's measured alpha bounds, including authored shadows;
- its current translation, rotation, and scale;
- three times the current animated blur radius;
- an additional 48 px sampling and motion margin around the viewport.

Only the drawing work is skipped. Animation state remains derived from the current timeline frame, so a layer that re-enters the viewport immediately appears at its correct current position, opacity, rotation, scale, and blur instead of resuming from the frame where it was culled.

The renderer records skipped individual draws in `__moPreviewCacheStats.culledElements`.

## 5. Prepare the next section early

After the visible sections finish drawing, the renderer schedules preparation of one adjacent section in the current scroll direction.

Background preparation is constrained so it cannot grow without bounds:

- only one section request is active at a time;
- visible section rendering always runs first;
- cached runs are prepared sequentially and yield between runs;
- preparation waits 48 ms before starting;
- it stops when visible rendering becomes busy;
- it stops when the section cache reaches 90% of its 128 MB budget;
- changing scroll direction replaces the pending adjacent-section request.

Prepared pictures use the same cache keys as visible section pictures, so entering the section consumes the prepared result without rebuilding it. Diagnostics record warmed runs, fully warmed sections, and aborted warming attempts.

## 6. Cache static blur and shadows

Static SVG filters, shadows, masks, and authored blur belonging to an independently drawn layer are rasterized once and stored in a 64 MB LRU effect cache. Subsequent frames reuse those pixels while applying animated properties at draw time.

The cached picture key includes:

- the layer or motion-group identity;
- the exact member-layer set;
- preview detail scale;
- edited text content.

Animated translation, rotation, scale, opacity, and timeline blur remain outside the cached picture. This keeps moving elements independent and avoids freezing animation state into a static raster.

Rendering semantics remain unchanged:

- the existing ordered `parts` list preserves layer overlap order;
- the page viewport clip still wraps all section and independent-layer drawing;
- each cached layer retains its authored blend mode;
- user blend and opacity overrides are applied when the cached picture is drawn;
- text changes generate new bounds and effect-cache keys;
- evicted canvases are explicitly released by resetting their dimensions.

Diagnostics expose effect-cache hits, misses, evictions, entries, and estimated bytes. Static layers that are already batched into cached section pictures continue to reuse their blur and shadow pixels through the section cache.

## 7. Use lighter animated blur for preview

Changing layer blur uses a reusable lower-resolution offscreen surface in interactive preview. The animation still evaluates the same blur amount at the same timeline time; only the temporary blur raster is calculated at lower resolution and then composited at the intended size.

Quality behavior:

- `Smooth · 1×`, `1.25×`, `Balanced · 1.5×`, and `1.75×` use the lighter animated-blur path;
- `Sharp · 2×` is the high-quality close-inspection mode and uses the full-resolution blur path;
- exported frames always use full-resolution animated blur;
- authored static blur and shadows remain in the static effect cache;
- scroll motion blur remains controlled by its separate saved preview setting and is not enabled by this change.

The low-resolution blur surface grows only when necessary and is reused between layer draws and frames. Blur padding remains three radii around the layer, preventing the temporary surface from clipping the changing effect. Diagnostics record low-resolution blur frames.

## 8. Resize oversized source images

Low-quality preview can substitute display-sized copies for oversized raster sources. Originals remain unchanged and are always used by `Sharp · 2×` and export.

Four confirmed oversized assets currently have preview copies:

| Asset | Original | Preview | Encoded bytes |
| --- | ---: | ---: | ---: |
| `cardbg_bg_01` | 716×816 | 358×408 | 41,192 → 7,377 |
| `cardbg_bg_02` | 716×816 | 358×408 | 129,198 → 28,813 |
| `cardbg_bg_03` | 716×816 | 358×408 | 131,482 → 29,382 |
| `image10_0_1` | 1600×1600 | 800×800 | 316,500 → 113,014 |

Each preview copy stores a signature of its source. If the user replaces an original image, a signature mismatch disables the stale preview copy and immediately falls back to the new original. Section, bounds, and effect-cache keys distinguish preview and original imagery, so export cannot reuse preview pixels.

These four preview payloads are about 71% smaller than their source payloads and decode to one-quarter of the original pixel memory. The originals remain stored for export, while low-quality preview avoids decoding and drawing their oversized versions.

## 9. Adapt quality during playback

The visible canvas keeps the exact backing resolution selected by `Preview quality`. During playback, only the sandbox's internal render resolution changes, and the completed bitmap is composited into that full-size backing canvas.

The adaptive policy is intentionally stable:

- playback begins at the selected preview quality and 60 FPS submission rate;
- sustained render pressure reaching six samples (renders over 34 ms or made stale by newer timeline frames, with isolated fast samples reducing pressure gradually) lowers internal resolution to 75% and limits preview submissions to 30 FPS;
- if sustained pressure continues, internal resolution can step down once more to 50%;
- quality never oscillates upward during the same playback run;
- pausing immediately restores the selected full resolution and 60 FPS submission rate;
- export resolution and FPS remain independent and never use adaptive preview quality.

The existing low-resolution animated-blur and preview-image paths consume the effective internal preview quality, so they become cheaper together when playback is under pressure.

## 10. Keep scrolling synchronized with time

Scroll position and all section motion continue to be evaluated from the runtime timeline's elapsed `timeSeconds`, rather than by incrementing a frame counter. Reducing preview submissions therefore skips visual samples without slowing the animation clock.

The live renderer retains one active render and exactly one replaceable latest pending request. When rendering falls behind:

- a newer request replaces the prior pending request;
- an active render that finishes after a newer request arrived is closed without being displayed;
- the latest request is rendered from its own current timeline time;
- no second queue or backlog is created.

Scheduler diagnostics expose submitted, started, delivered, replaced-pending, stale-skipped, and maximum-pending counts. The deterministic load test confirms a maximum pending depth of one and verifies that an obsolete completed bitmap is released instead of reaching the canvas.

## 11. Control memory throughout the session

Preview memory is sampled once per second while a project is open and classified as reopening, playing, scrubbing, or idle. A bounded 120-sample session history records:

- section-cache, effect-cache, and reusable blur-surface bytes;
- the combined cache peak and eviction count;
- average and maximum completed-frame render time;
- browser JS heap when the browser exposes it.

The Preview panel shows the current combined cache, its 160 MB session budget, peak, evictions, average render time, and optional JS heap. These are measurements for diagnosing gradual slowdown; an increase alone is not labeled a leak.

Cache enforcement now has both local and combined limits. Section pictures retain their 128 MB budget and static effects retain 64 MB, while their combined total plus the reusable blur surface is capped at 160 MB. When the combined budget is exceeded, eviction proceeds in this order:

1. Distant section pictures outside the visible and next-section priority set.
2. Least-recently-used static effect pictures.
3. A protected section picture only when no distant/effect candidate remains.

Evicted section and effect canvases have their dimensions reset to release backing storage. Reopening a project disposes its sandbox, cancels warming, clears cache maps and bounds, releases the blur surface, and starts a new scheduler while the bounded session history remains available for comparison.

## 12. Offer a rendered video preview

The Preview panel offers `Build preview` for either the full timeline or one continuous selected section/timeline segment. It renders a temporary in-memory 0.5K, 30 FPS video using the same final frame painter as export, including frame transforms, perspective, mockup, section animation, blur, interactions, and sticky content.

Once ready, timeline playback decodes the video and copies each decoded frame to the existing full-resolution canvas. The sandbox stops drawing design frames during this mode, while the runtime timeline remains authoritative for play, pause, scrubbing, and loop timing. The temporary video does not download, alter export format/FPS/resolution, or enter project persistence.

The preview signature covers the active animation code/assets, canvas size, duration, layers, and product content values. Relevant edits revoke the object URL, release the video, return the canvas to live rendering, and show a refresh message. Preview-quality and export-setting changes do not invalidate it because they do not change the rendered composition. `Remove preview` releases it manually.

## Saved projects

The following project files contain render scale `1`, the bounded section cache, and cache diagnostics:

- `Projects/BaseCase Landingpage Motion 2.json`
- `Projects/BaseCase Landingpage Motion 2 2.json`

## Verification

- `npm run typecheck` passes.
- Three focused adaptive-quality and scheduler cases pass across sustained pressure, pause restoration, 30 FPS gating, latest-request replacement, stale-result disposal, and one-slot pending depth.
- The focused memory/signature cases confirm a bounded 120-sample history and content-sensitive rendered-preview invalidation that ignores preview/export-only settings.
- Both saved animation scripts parse successfully through `new Function("api", code)`.
- Both saved scripts contain the memory budgets, static-effect cache, lighter preview blur, guarded preview-image substitution, element-culling logic, bounded adjacent-section warming, and diagnostic counters, and no longer contain `KEEP = 4`.
- Live editor inspection shows `Smooth · 1×`, runtime Resolution scale `1`, and independent 4K Render settings.
- Live playback preserved a 1600×1200 backing at `Smooth · 1×` and a 3200×2400 backing at `Sharp · 2×`; scheduler diagnostics reported maximum pending depth `1`, and pausing/restoring Smooth returned factor `1`, 60 FPS submission, and the 1600×1200 backing.
- Live memory telemetry reported the 160 MB budget and classified scrubbing and playing samples. A full 29.5-second temporary preview completed at 1280×960/30 FPS; during its playback the canvas timeline advanced while sandbox-delivered frame count stayed unchanged. Changing the canvas ratio revoked the preview and displayed the refresh message; Undo restored the project ratio.
- The protected measured performance suite was not run, so this document records the implemented policies and deterministic pixel-count reduction rather than measured latency or throughput claims.

The existing `src/app/app-schema.test.ts` still contains starter-template expectations. Four assertions fail because the current product has controls and timeline behavior while its product acceptance inventory has not yet replaced those starter assertions.
