# seaMotion (Figma plugin)

Select layers in Figma, open the plugin, press **Copy**. The JSON holds, per layer: size and position, auto layout,
fills (solid and gradient stops), strokes, corner radius, effects (drop shadow, inner shadow, layer blur, background blur and glass, with all their values), blend mode, opacity, text
(characters, font, size, weight, spacing) and the component name; icons and vectors up to 96 px carry their SVG,
so nothing comes out as an empty placeholder. For a design copy the JSON also carries a 2× PNG of each selected layer (gradients, blur and glow exactly as drawn), and optionally the whole selection as SVG. A layer whose fill has several colors stacked, or a picture, is also exported as a picture of just that fill (`fillImage`), and the app imports it as an image. A picture fill also travels as its original file with its fit (Fill, Fit, Crop, Tile), so the app can replace it; a GIF fill plays in the app. A video fill (Figma does not let plugins read the video file) arrives as its picture and is marked as a video, so the app asks for the file. Circles and boxes filled with a photo or video (avatars, thumbnails) come in as picture layers, not icons. Texts carry every font setting (family, style, weight, size, line height, letter spacing, case, decoration, every font a mixed text uses) and a 2× picture of the text: the app shows the picture while the font is missing on that computer, until the font file is added there. The window shows a short preview; **Copy** takes the full text.

## In the app
- **Import** pastes into the open project: an empty project takes the design (and its size); otherwise the design is added on top. A project still called "Untitled N" takes the frame's name; the design's main layer is always named after the frame.
- **Right-click a layer** (in Layers, or the artboard while a layer is selected) ▸ **Paste to replace**: the copied design takes that layer's place, filling its box.
- Select a pasted text in Layers: the Layer section shows a one-line text field (labels) or a multiline field (paragraphs), then Font | Weight, Size | Case, Color, Line height | Letter spacing, Align.
- Select a picture layer: the uploader shows its picture; drop or add a picture, GIF or video (MP4, WebM) to replace it; Fit sets how it fills the layer.

## Frames and auto layout
Every Figma frame, auto layout, component and instance arrives in seaMotion as a **frame layer**: a group whose own fill, stroke and corner radius sit on the group itself, below its nested child layers. A frame layer has all group properties (Clip content, Size, Align, Perspective, Blend) and clips its children when Figma's "Clip content" is on. An auto layout is copied with its layout turned off (the children keep the places they had) and still arrives as a frame layer. The window shows a "frame(s)" chip with the count. Plain Figma groups stay ordinary groups.

A frame carries its Figma effects: drop shadow, inner shadow, background blur and glass act on the frame's own fill; a **layer blur** on a frame blurs the frame with everything inside it, as in Figma. (The window's effects count includes frames; turn off "ignore effects" in the plugin's options if you do not want them.)

## Shapes, lines and blur
- **Vectors and shapes** (vector, boolean shape, star, polygon, line, ring or arc) arrive as their outline, not as a picture: the app paints them from their Figma **fill and stroke**, solid or **gradient**, so both stay editable in the Layer section (colors, gradient stops, stroke width, opacity). Stroke caps, joins and inside/outside/center are kept. A shape with a picture fill, dashes, arrow heads, inner shadow or glass still travels as a picture or SVG.
- **One-sided strokes**: a frame or auto layout whose stroke is on some sides only (a bottom rule, a left bar) is not a bordered box. Each stroked side becomes a **line layer** (a box as thick as the stroke, with the stroke's paint and gradient) inside the frame; the frame has no border. A frame with nothing else (no fill, no children) is just the line.
- **Progressive blur**: a layer blur set to progressive (blurred more and more from a start to an end across the layer) keeps its start radius, end radius and its start and end places, and blurs everything inside a frame or group as one picture, as in Figma.
- **Blur**: a layer with both **background blur** and **layer blur** arrives with both; they are drawn together (the frosted backdrop, then the soft layer).

## Pictures, exactly
Layers that travel as a picture (an icon, a marked layer, a shape with a glow or shadow) are taken so the app can place them exactly:
- The picture is taken at the layer's **full opacity** (the scratch copy is put back right after), because the app applies the layer's opacity itself and a picture that already carried it would be faded twice.
- An SVG comes with **how far it reaches past the layer's box** on each side (a glow, a shadow, half of a stroke), so the app puts it in place from numbers instead of guessing. Older pastes without them are still placed by the app's own rules.
- Straight lines, arcs, stars and other single shapes travel as outlines (see above), and a progressive blur keeps where it starts and ends.

## Marks
Select a layer in Figma, then press a mark in the plugin window (press it again to clear). The mark shows on the layer in Figma as a sign in front of its name (`[bg]`, `[1]`, `[svg]`); the plugin removes it when copying, so the app never sees it in a layer name. Pressing the mark again removes the sign.
- **Artboard**: the marked frame (or auto layout, or group) gives the app its artboard: background fill (solid stays solid, a gradient stays a gradient with its angle), name and size. Without a mark nothing changes.
- **Single layer**: the layer arrives as one picture layer; its children are not listed.
- **Image** (import as image): the layer arrives as one picture layer (a 2× PNG), its children are not listed; it works like Single, with a name that says what it does. The sign is `[img]`.
- **Asset (SVG)**: the layer arrives as one SVG layer, however large (a big illustration or logo).
**Tag**: a picker under the marks (Image, Text, Video, Frame, Group, Shape, Path, Vector, Icon, Button, Background, and your own). A tag says what kind of layer this is. **New tag…** makes a tag of your own (kept in the file, then listed for every layer) and gives it to the selection; the **pen** beside the picker renames the selection's tag on every layer of the page that has it. It is stored as plugin data, so it never shows in the layer name. The app shows it in Modifier > Layer > Tag (and lets you pick another tag or rename a tag there with the pen; tags are made only in the plugin, and nothing the app changes goes back to the plugin), and Motion tab > Preset > Apply to can give one motion to every layer with a tag. A layer with no tag gets one in the app from what it is: picture = image, text = text, video file = video, frame = frame, group = group, box/circle/line = shape, drawn outline = path, exported picture (SVG) = vector. Icon, Button and Background are only set by hand. A tag you pick in the app wins over the plugin's.

Marked layers inside the selection are counted in the window; **Clear marks** removes them.

## Cleaners and masks
Three switches (on by default) clean the copy; the design in Figma is never changed.
- **Clean layer names**: numbers such as "Rectangle 4821" or "Group 3 copy" go and every name is unique ("Rectangle", "Rectangle 2" …). Text layers keep their wording.
- **Round every value**: positions, sizes, corner radius, stroke width, gap and padding, effect numbers and text sizes come as whole numbers. Values from 0 to 1 (opacity, gradient stops) keep their decimals.
- **Remove hidden layers**: hidden layers are not copied (a hidden *mask* stays, it still cuts); effects, fills and strokes that are switched off are never copied.

**Clean selection in Figma** (button, press twice) does the same cleaning to the layers in your file before you copy: names, whole-number positions, sizes, radius and stroke, hidden layers removed (hidden masks stay), switched-off fills, strokes and effects removed. It is one step in Figma's history, so ⌘Z undoes all of it. The copy also cleans on its own with the switches above.

Shape layers: the Layer section shows only what the shape has: Fill (a color, or each color of a gradient), Stroke and Stroke width, Corner radius (one value, or one per corner), Opacity, Effects on/off, and Blend mode.

Blend modes: a layer's blend mode (Multiply, Screen, Overlay, Hue, Luminosity …) comes through, and the Layer section has a **Blend mode** dropdown to pick another.

Masks: a layer that is a mask in Figma cuts the layers above it in the same parent. The copy carries which layer masks which. In the app the mask layer is not drawn itself; a masked layer's Layer section has **Masked by**, a dropdown of the design's mask layers (or No mask) to pick another.

## Pictures (image compressor)
Select a frame: when it (or what is inside it) holds a picture fill, a **Pictures** switch appears under the buttons ("N pictures in the selection"). Turn **Make pictures smaller** on: each picture is listed with its real pixel size and file size, **Max width (px)** (2048, 1600, 1280, 1024, 768, 512 or a custom number) sets the widest a picture may be, and every row and the total show the size at that width, all before you copy. **Copy design** then carries the pictures at that width (the button reads **Copy at N px**); after the copy the list shows every picture in it, also the pictures of layers. Only wider pictures are made smaller, none is enlarged, the file type stays (PNG stays PNG, JPEG and WebP at 92 %), a picture that would not weigh less is kept, and a picture used as a tiled fill is kept (a tile's size is its pixels). With the switch off the copy is as before. The plugin reads a picture's bytes only when the switch is on.

## File size
Under the selection card, **Measure file size** shows three numbers for the selection: **File now** (what the copy weighs as it is, with the design's picture), **Effects solved** (what it would weigh with the effects left out, so blurred shapes are plain shapes), **Issue layers as pictures** (the copy with every layer that has an issue sent as one picture) and **As one picture** (the whole selection as one PNG, at 1× and 2×). They are estimates; the app then recompresses the pictures without visible loss. It runs only when you press the button.

## Lottie tab
**Import layers with issues as pictures** (a switch at the top of the tab): every layer with something a Lottie file cannot carry (effects, blend modes, boolean shapes, angular or diamond gradients, inside or outside strokes, corner smoothing) is copied as one picture layer, as if marked Single; texts stay text. Your Figma file is not changed.

The window has two tabs, **Design** (copy) and **Lottie**. In **Lottie**, select a frame and press **Analyze selection**: the report lists what a Lottie file cannot carry or carries badly, with why and how to fix each, and the layers involved (click a name, or **Select all**, to select them in Figma). Nothing in your file changes. It checks: live text (outline it), effects (blur, shadows, glass), blend modes, luminance masks, picture and video fills, angular and diamond gradients, inside and outside strokes, arrow heads, different stroke weights per side, boolean shapes, corner smoothing, very detailed paths, hidden layers and very large layer counts. These match the checks the app makes on a Lottie project. For each problem it also measures what those layers would weigh as plain pictures (no motion), at 1× and 2×, from real exports of a few of them.

## Load it
1. Figma desktop app: **Plugins ▸ Development ▸ Import plugin from manifest…**
2. Choose `manifest.json` in this folder.
3. Run it from **Plugins ▸ Development ▸ seaMotion**. It follows the selection.

No network access; nothing leaves Figma except what you paste.

## The window
A summary card (picture of the selection, name, size, layer count and what it holds: texts, icons, picture fills, effects), four switches for what to copy, one **Copy design** button, and **Show JSON** to see the text (the window grows to fit it). Nothing is copied until you press the button.

## Nothing happens until you press Copy
Selecting layers only reads a summary (name, size, counts and a small picture); the design is not touched. When you press **Copy design** the plugin builds everything at that moment, and the window shows what it is doing ("Preparing a copy…", "Reading layers…", "Taking the picture…").

The work is done on a scratch page, not on the page you are looking at: the selection is copied there, **every instance is detached** (again and again until none is left, since a detached instance can hold more) and **every auto layout is turned off**, so each layer has a fixed position. Each change to a copy happens in one synchronous run, so you never see a copy or a half-changed layer flash by. The scratch page is deleted when the reading is done (and cleared on start if a run was ever cut short). The picture of the design is taken from the real layer, so effects such as background blur still see what is behind them. Switch it off with *Detach instances, remove auto layout* to read the layers as they are.

If Figma does not let the window copy to the clipboard by itself, the button says **Ready — click to copy**; one more click copies the text that is already built.
