// seaMotion (design copy): turns the selected layers into JSON (layout, fills with gradients, strokes, effects,
// text, and SVG for icons and vectors) and shows it in the plugin window with a Copy button.

figma.showUI(__html__, { width: 360, height: 640, themeColors: true });

const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "ELLIPSE"];
const ICON_MAX = 96;
// png: a 2x picture of each selected layer, so the design copies exactly (gradients, blur, glow). svg: icons and
// vectors as SVG. frameSvg: the whole selected layer as SVG too. fillImages: a fill made of several paints, or
// any picture, is exported as a picture of just that fill (the app cannot rebuild it from the parts). flatten: the
// layers are read from a temporary copy with every instance detached and every auto layout turned off, so each
// layer has a fixed position; the copy is deleted again and the design itself is never touched.
// textImages: each text also travels as a picture, shown by the app while the text's font is missing there.
const options = { issuePictures: false, ignoreEffects: false, cleanNames: true, dropHidden: true, roundValues: true, svg: true, png: true, frameSvg: false, fillImages: true, textImages: true, flatten: true, maxDepth: 40 };

function hex(color) {
  const part = (value) => Math.round(value * 255).toString(16).padStart(2, "0");
  return "#" + part(color.r) + part(color.g) + part(color.b);
}

function round(value) {
  return typeof value === "number" ? Math.round(value * 100) / 100 : value;
}

// Round cleaner: every size, position, radius, stroke and effect number comes out as a whole number (values from 0 to 1,
// such as opacity and gradient stops, keep their decimals).
function whole(value) {
  if (typeof value !== "number") return value;
  return options.roundValues ? Math.round(value) : round(value);
}

function paint(p) {
  if (p.visible === false) return null;
  const base = { type: p.type, opacity: round(p.opacity === undefined ? 1 : p.opacity), blendMode: p.blendMode };
  if (p.type === "SOLID") return Object.assign(base, { color: hex(p.color) });
  if (p.type.indexOf("GRADIENT") === 0) {
    return Object.assign(base, {
      stops: p.gradientStops.map((stop) => ({
        position: round(stop.position),
        color: hex(stop.color),
        alpha: round(stop.color.a === undefined ? 1 : stop.color.a),
      })),
      transform: p.gradientTransform ? p.gradientTransform.map((row) => row.map(round)) : undefined,
    });
  }
  if (p.type === "IMAGE") return Object.assign(base, { scaleMode: p.scaleMode, imageHash: p.imageHash });
  if (p.type === "VIDEO") return Object.assign(base, { scaleMode: p.scaleMode, videoHash: p.videoHash });
  return base;
}

function paints(list) {
  if (list === figma.mixed || !Array.isArray(list)) return undefined;
  const out = list.map(paint).filter(Boolean);
  return out.length ? out : undefined;
}

// Every effect keeps all its numbers, so drop and inner shadows (color, offset, blur, spread), layer and background
// blur, and Figma's glass (frost, light angle and intensity, refraction, depth, dispersion) all arrive with their values.
function effect(e) {
  if (e.visible === false) return null;
  const out = { type: e.type };
  for (const key of Object.keys(e)) {
    const value = e[key];
    if (key === "visible" || key === "boundVariables" || key === "type") continue;
    if (key === "color" && value) {
      out.color = hex(value);
      out.alpha = round(value.a === undefined ? 1 : value.a);
    } else if (key === "offset" && value) {
      out.offset = { x: whole(value.x), y: whole(value.y) };
    } else if ((key === "startOffset" || key === "endOffset") && value && typeof value === "object") {
      // A progressive blur: where it starts and ends across the layer (0 to 1 of its width and height).
      out[key] = { x: round(value.x), y: round(value.y) };
    } else if (typeof value === "number") {
      out[key] = Math.abs(value) <= 1 && value % 1 !== 0 ? round(value) : whole(value);
    } else if (typeof value === "string" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function isVectorish(node) {
  if (VECTOR_TYPES.indexOf(node.type) >= 0) return true;
  if ("children" in node && node.children.length > 0) return node.children.every(isVectorish);
  return false;
}

// A drawn path (a vector, a boolean shape, a star or polygon, an outlined stroke, a ring or arc) at any size. The app
// draws boxes and circles itself; these travel as SVG, or as an exact picture when they carry effects.
function isVectorShape(node) {
  if (node.type === "ELLIPSE") {
    const arc = node.arcData;
    return !!arc && (arc.innerRadius > 0 || Math.abs(arc.endingAngle - arc.startingAngle - 2 * Math.PI) > 1e-3);
  }
  return ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON"].indexOf(node.type) >= 0;
}

// The sides of a box (frame, auto layout, rectangle) that carry a stroke when the four sides do not carry the same weight, as
// [{ side, weight }]; undefined when the stroke is the same all around (a normal border).
function sideStrokes(node) {
  if (!("strokeTopWeight" in node)) return undefined;
  const weights = { TOP: node.strokeTopWeight, RIGHT: node.strokeRightWeight, BOTTOM: node.strokeBottomWeight, LEFT: node.strokeLeftWeight };
  const values = Object.keys(weights).map((side) => weights[side]);
  if (values.some((value) => typeof value !== "number")) return undefined;
  if (values.every((value) => value === values[0])) return undefined;
  const found = Object.keys(weights).filter((side) => weights[side] > 0).map((side) => ({ side, weight: whole(weights[side]) }));
  return found.length ? found : undefined;
}

// A single drawn shape (a vector, a boolean shape, a star, a polygon, a line, a ring or arc) whose look the app can draw itself from
// its outline, so its fill and stroke stay editable there (solid or gradient). Not with a picture fill, dashes, arrow heads or effects
// the app cannot draw on a path (inner shadow, glass).
function pathOutline(node) {
  if (!isVectorShape(node)) return undefined;
  const plain = (list) => list !== figma.mixed && Array.isArray(list) && list.every((p) => p.visible === false || p.type === "SOLID" || p.type.indexOf("GRADIENT") === 0);
  if (!plain(node.fills) || !plain(node.strokes)) return undefined;
  if (Array.isArray(node.dashPattern) && node.dashPattern.length) return undefined;
  if (node.strokeCap && node.strokeCap !== figma.mixed && node.strokeCap.indexOf("ARROW") === 0) return undefined;
  if (!options.ignoreEffects && Array.isArray(node.effects) && node.effects.some((e) => e.visible !== false && (e.type === "INNER_SHADOW" || e.type === "GLASS"))) return undefined;
  if (node.type === "LINE") return [{ d: "M0 0L" + round(node.width) + " 0", r: "NONE" }];
  const geometry = node.fillGeometry;
  if (!Array.isArray(geometry) || geometry.length === 0) return undefined;
  const paths = geometry.map((g) => ({ d: g.data, r: g.windingRule }));
  const size = paths.reduce((sum, g) => sum + g.d.length, 0);
  return size > 200000 ? undefined : paths;
}

// A layer's picture (SVG or PNG) is taken at the layer's full opacity: the app applies the layer's opacity itself, and a picture that
// already carries it would be faded twice. The scratch copy is restored right after.
async function exportAtFullOpacity(node, settings) {
  const opacity = "opacity" in node ? node.opacity : 1;
  let changed = false;
  try {
    if (opacity !== 1) {
      node.opacity = 1;
      changed = true;
    }
  } catch (error) {
    /* a layer that cannot be changed is exported as it is */
  }
  try {
    return await node.exportAsync(settings);
  } finally {
    if (changed) node.opacity = opacity;
  }
}

// The SVG of a layer, and how far it reaches past the layer's box on each side (a glow, a shadow, half of a stroke): the app places the
// picture exactly from these numbers instead of guessing.
async function exportSvg(node, out) {
  out.svg = await exportAtFullOpacity(node, { format: "SVG_STRING" });
  const render = node.absoluteRenderBounds;
  const box = node.absoluteBoundingBox;
  if (render && box) {
    out.svgBleed = {
      left: round(box.x - render.x),
      top: round(box.y - render.y),
      right: round(render.x + render.width - (box.x + box.width)),
      bottom: round(render.y + render.height - (box.y + box.height)),
    };
  }
}

function hasEffects(node) {
  if (options.ignoreEffects) return false;
  return "effects" in node && Array.isArray(node.effects) && node.effects.some((e) => e.visible !== false);
}

function holdsPicture(node) {
  return visiblePaints(node).some((p) => p.type === "IMAGE" || p.type === "VIDEO");
}

function isIcon(node) {
  // A circle or box filled with a photo or video (an avatar, a thumbnail) is a picture layer, not an icon.
  if ((node.type === "ELLIPSE" || node.type === "RECTANGLE") && holdsPicture(node)) return false;
  return (
    "width" in node && node.width <= ICON_MAX && node.height <= ICON_MAX &&
    (VECTOR_TYPES.indexOf(node.type) >= 0 || (("children" in node) && isVectorish(node)))
  );
}

function visiblePaints(node) {
  if (!("fills" in node) || node.fills === figma.mixed || !Array.isArray(node.fills)) return [];
  return node.fills.filter((p) => p.visible !== false);
}

// Several paints stacked, or a picture fill: these cannot be rebuilt from colors, so they travel as a picture.
function needsFillImage(node) {
  if (node.type === "TEXT") return false;
  const list = visiblePaints(node);
  return list.length > 1 || list.some((p) => p.type === "IMAGE" || p.type === "VIDEO");
}

// Everything the copy tries out (copies, detached instances, auto layout switched off) lives on a scratch page that
// is created when Copy is pressed and deleted again when it is done. Every change to a copy happens in one
// synchronous run, so the page you are looking at never shows a copy or a half-changed layer.
let scratchPage = null;
let scratchFrame = null;
function scratch() {
  if (scratchFrame) return scratchFrame;
  scratchPage = figma.createPage();
  scratchPage.name = "Copy Layer JSON (temporary)";
  scratchFrame = figma.createFrame();
  scratchPage.appendChild(scratchFrame);
  scratchFrame.name = "Scratch";
  scratchFrame.clipsContent = false;
  scratchFrame.fills = [];
  return scratchFrame;
}
function dropScratch() {
  try { if (scratchPage) scratchPage.remove(); } catch (error) { /* already gone */ }
  scratchPage = null;
  scratchFrame = null;
}

// A 2x picture of only the fill: a copy of the layer with its children, strokes, effects, rotation and
// opacity taken away is exported and thrown away again, so nothing in the file changes.
async function exportFill(node) {
  // The copy is moved to the scratch page in the same moment it is made.
  const copy = node.clone();
  scratch().appendChild(copy);
  try {
    if ("children" in copy) {
      for (const child of copy.children) {
        try { child.visible = false; } catch (error) { /* a locked part of an instance */ }
      }
    }
    if ("strokes" in copy) copy.strokes = [];
    if ("effects" in copy) copy.effects = [];
    if ("opacity" in copy) copy.opacity = 1;
    if ("blendMode" in copy) copy.blendMode = "NORMAL";
    if ("rotation" in copy) copy.rotation = 0;
    const bytes = await copy.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
    return "data:image/png;base64," + figma.base64Encode(bytes);
  } finally {
    copy.remove();
  }
}

// The top picture (or video) fill of a layer as its original file (not a render), with how it fills the layer, so the app can
// show it, fit it and let you replace it. Very large files travel only as the fill picture.
const PICTURE_MAX_BYTES = 8 * 1024 * 1024;
function mimeOf(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "image/png";
}
async function originalPicture(node) {
  const list = visiblePaints(node).filter((p) => (p.type === "IMAGE" && p.imageHash) || p.type === "VIDEO");
  const top = list[list.length - 1];
  if (!top) return null;
  // A video fill: plugins cannot read the video file, so the layer arrives as its picture (the fill as Figma shows
  // it) and the app asks for the video file to play there.
  if (top.type === "VIDEO") {
    return { video: true, scaleMode: top.scaleMode, opacity: round(top.opacity === undefined ? 1 : top.opacity) };
  }
  try {
    const image = figma.getImageByHash(top.imageHash);
    if (!image) return null;
    const bytes = await image.getBytesAsync();
    const size = typeof image.getSizeAsync === "function" ? await image.getSizeAsync() : null;
    const out = {
      scaleMode: top.scaleMode,
      opacity: round(top.opacity === undefined ? 1 : top.opacity),
      scalingFactor: top.scalingFactor === undefined ? undefined : round(top.scalingFactor),
      rotation: top.rotation || undefined,
      imageTransform: top.imageTransform ? top.imageTransform.map((row) => row.map((value) => Math.round(value * 100000) / 100000)) : undefined,
      width: size ? size.width : undefined,
      height: size ? size.height : undefined,
      bytes: bytes.length,
    };
    if (bytes.length <= PICTURE_MAX_BYTES) out.src = "data:" + mimeOf(bytes) + ";base64," + figma.base64Encode(bytes);
    else out.tooLarge = true;
    return out;
  } catch (error) {
    return { scaleMode: top.scaleMode, error: String(error && error.message ? error.message : error) };
  }
}

// Marks: set in the plugin window on layers (stored as plugin data, so a layer's name never changes) and read when copying.
//   bg: this frame's fill, name and size become the app's artboard.   single: one layer, its children are not listed.
//   image: import as an image, the same as single (one picture layer, a 2x PNG).
//   asset: one layer drawn from its SVG, however large.
const MARKS = ["bg", "single", "image", "asset"];
// The mark is shown on the layer as a sign in front of its name, so it is visible in Figma's layer list; the plugin strips
// it again when copying, so the app never sees it in a layer name.
const MARK_SIGNS = { bg: "[bg] ", single: "[1] ", image: "[img] ", asset: "[svg] " };
const MARK_PATTERN = /^\[(bg|1|img|svg)\]\s*/;
function plainName(name) {
  return String(name).replace(MARK_PATTERN, "");
}
function markOf(node) {
  const found = MARK_PATTERN.exec(String(node.name));
  if (!found) return "";
  return found[1] === "bg" ? "bg" : found[1] === "1" ? "single" : found[1] === "img" ? "image" : "asset";
}
function setMark(node, mark) {
  try {
    node.name = (mark ? MARK_SIGNS[mark] : "") + plainName(node.name);
  } catch (error) {
    /* a locked part of an instance */
  }
}
// Tags: what kind of layer this is. Stored as plugin data, so the layer's name never shows it; the app reads it (Modifier > Layer > Tag) and a
// motion preset can be given to every layer with a tag. The ready-made tags are below; New tag makes one of your own (kept in the file, so every
// layer can use it), and Rename tag renames a tag on every layer of the page that has it.
const TAGS = ["image", "text", "video", "frame", "group", "shape", "path", "vector", "icon", "button", "background"];
const MAX_TAG = 24;
function cleanTag(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, MAX_TAG).trim();
}
function tagOf(node) {
  try {
    return typeof node.getPluginData === "function" ? cleanTag(node.getPluginData("moTag")) : "";
  } catch (error) {
    return "";
  }
}
function setTag(node, tag) {
  try {
    node.setPluginData("moTag", cleanTag(tag));
  } catch (error) {
    /* a locked part of an instance */
  }
}
// The tags you made, kept with the file.
function customTags() {
  try {
    const list = JSON.parse(figma.root.getPluginData("moTags") || "[]");
    return Array.isArray(list) ? list.map(cleanTag).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}
function saveCustomTags(list) {
  const seen = new Set();
  const unique = list.map(cleanTag).filter((tag) => tag && TAGS.indexOf(tag.toLowerCase()) < 0 && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
  figma.root.setPluginData("moTags", JSON.stringify(unique));
}
// A working copy keeps the marks of the layer it was made from (read by position, since detaching makes new layers).
function copyMarks(from, to) {
  const mark = markOf(from);
  if (mark) setMark(to, mark);
  const tag = tagOf(from);
  if (tag) setTag(to, tag);
  if ("children" in from && "children" in to && from.children.length === to.children.length) {
    for (let index = 0; index < from.children.length; index++) copyMarks(from.children[index], to.children[index]);
  }
}

// A layer with something a Lottie file cannot carry (effects, blend modes, boolean shapes, angular gradients, inside or outside
// strokes ...): with "Import layers with issues as pictures" it travels as one picture layer, as if marked Single.
function hasPictureIssue(node) {
  if (node.type === "TEXT") return false;
  if ("effects" in node && Array.isArray(node.effects) && node.effects.some((e) => e.visible !== false)) return true;
  if ("blendMode" in node && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") return true;
  if (node.type === "BOOLEAN_OPERATION") return true;
  if ("cornerSmoothing" in node && typeof node.cornerSmoothing === "number" && node.cornerSmoothing > 0) return true;
  if ("fills" in node && Array.isArray(node.fills) && node.fills.some((p) => p.visible !== false && (p.type === "GRADIENT_ANGULAR" || p.type === "GRADIENT_DIAMOND"))) return true;
  if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.some((s) => s.visible !== false)) {
    if (node.strokeAlign === "INSIDE" || node.strokeAlign === "OUTSIDE") return true;
  }
  return false;
}

// A frame in Figma (a frame, an auto layout, a component, and what an instance becomes) is a frame layer in the app: a group that
// has its own fill, stroke and corner radius under what it holds, and cuts it when Clip content is on.
const FRAME_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"];
function isFrameNode(node) {
  return FRAME_TYPES.indexOf(node.type) >= 0 && "children" in node;
}

async function describe(node, depth) {
  const out = { name: plainName(node.name), type: node.type };
  const ownMark = markOf(node);
  // "Import as image" travels as a Single layer: one picture layer (the app knows no other name for it).
  if (ownMark) out.mark = ownMark === "image" ? "single" : ownMark;
  const ownTag = tagOf(node);
  if (ownTag) out.tag = ownTag;
  // A layer with an issue becomes a picture layer when that option is on (nothing changes in the file itself).
  const mark = ownMark === "image" ? "single" : ownMark || (options.issuePictures && depth >= 0 && hasPictureIssue(node) ? "single" : "");
  if (node.visible === false) out.visible = false;
  if ("x" in node) {
    out.x = whole(node.x);
    out.y = whole(node.y);
    out.width = whole(node.width);
    out.height = whole(node.height);
  }
  // Where the layer really is. x and y of a rotated or flipped layer are its pivot corner, not the corner of its
  // box, so the exact placement travels as the layer's matrix (only when it is not a plain move) and as its box on
  // the page (which also places icons that were exported already rotated).
  if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
    const box = node.absoluteBoundingBox;
    out.abs = { x: whole(box.x), y: whole(box.y), width: whole(box.width), height: whole(box.height) };
  }
  if ("relativeTransform" in node && node.relativeTransform) {
    const t = node.relativeTransform;
    const plain = Math.abs(t[0][0] - 1) < 1e-4 && Math.abs(t[0][1]) < 1e-4 && Math.abs(t[1][0]) < 1e-4 && Math.abs(t[1][1] - 1) < 1e-4;
    if (!plain) out.transform = t.map((row) => row.map((value) => Math.round(value * 100000) / 100000));
  }
  if ("rotation" in node && node.rotation) out.rotation = round(node.rotation);
  if ("opacity" in node && node.opacity !== 1) out.opacity = round(node.opacity);
  if ("blendMode" in node && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") out.blendMode = node.blendMode;
  if ("fills" in node) out.fills = paints(node.fills);
  if ("strokes" in node) {
    const strokes = paints(node.strokes);
    if (strokes) {
      out.strokes = strokes;
      out.strokeWeight = node.strokeWeight === figma.mixed ? undefined : whole(node.strokeWeight);
      out.strokeAlign = node.strokeAlign;
      if (node.strokeCap && node.strokeCap !== figma.mixed && node.strokeCap !== "NONE") out.strokeCap = node.strokeCap;
      if (node.strokeJoin && node.strokeJoin !== "MITER") out.strokeJoin = node.strokeJoin;
      if (typeof node.strokeMiterLimit === "number" && node.strokeMiterLimit !== 4) out.strokeMiterLimit = round(node.strokeMiterLimit);
      if (Array.isArray(node.dashPattern) && node.dashPattern.length) out.dashPattern = node.dashPattern.map(round);
      // A frame or auto layout with a stroke on only some sides (a bottom rule, a left bar) is not a bordered box: the sides
      // that carry the stroke travel as lines (same paint, same weight) and the box itself has no border.
      const sides = sideStrokes(node);
      if (sides) {
        out.sideStrokes = { sides, paints: strokes };
        delete out.strokes;
        delete out.strokeWeight;
        delete out.strokeAlign;
      }
    }
  }
  if ("cornerRadius" in node) {
    if (node.cornerRadius === figma.mixed) {
      out.cornerRadius = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius].map(whole);
    } else if (node.cornerRadius) {
      out.cornerRadius = whole(node.cornerRadius);
    }
  }
  if (!options.ignoreEffects && "effects" in node && node.effects.length) {
    const effects = node.effects.map(effect).filter(Boolean);
    if (effects.length) out.effects = effects;
  }
  if ("clipsContent" in node && node.clipsContent) out.clipsContent = true;
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    out.autoLayout = {
      direction: node.layoutMode,
      gap: whole(node.itemSpacing),
      padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map(whole),
      primaryAlign: node.primaryAxisAlignItems,
      counterAlign: node.counterAxisAlignItems,
      wrap: node.layoutWrap === "WRAP" || undefined,
    };
  }
  // The copy of an auto layout has its layout switched off (so every layer has a fixed place); what it was is remembered on the copy.
  if (isFrameNode(node)) {
    out.frame = true;
    const wasAuto = typeof node.getPluginData === "function" ? node.getPluginData("moAuto") : "";
    if (!out.autoLayout && wasAuto) out.autoLayout = { direction: wasAuto, flattened: true };
  }
  if ("layoutAlign" in node && node.layoutAlign !== "INHERIT") out.layoutAlign = node.layoutAlign;
  if ("layoutGrow" in node && node.layoutGrow) out.layoutGrow = node.layoutGrow;
  if ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE") out.positioning = "ABSOLUTE";

  if (node.type === "TEXT") {
    out.characters = node.characters;
    const mixed = (value) => (value === figma.mixed ? undefined : value);
    const font = mixed(node.fontName);
    out.text = {
      fontFamily: font ? font.family : undefined,
      fontStyle: font ? font.style : undefined,
      fontSize: mixed(node.fontSize),
      fontWeight: mixed(node.fontWeight),
      letterSpacing: mixed(node.letterSpacing),
      lineHeight: mixed(node.lineHeight),
      align: node.textAlignHorizontal,
      verticalAlign: node.textAlignVertical,
      case: mixed(node.textCase),
      decoration: mixed(node.textDecoration),
      autoResize: node.textAutoResize,
      paragraphSpacing: whole(node.paragraphSpacing),
      paragraphIndent: whole(node.paragraphIndent),
    };
    // Every font the text uses (a text can mix several), so the app can tell which ones it is missing.
    try {
      const seen = {};
      const fonts = [];
      for (const segment of node.getStyledTextSegments(["fontName", "fontWeight", "fontSize"])) {
        const key = segment.fontName.family + "|" + segment.fontName.style;
        if (seen[key]) continue;
        seen[key] = true;
        fonts.push({ family: segment.fontName.family, style: segment.fontName.style, weight: segment.fontWeight, size: whole(segment.fontSize) });
      }
      out.text.fonts = fonts;
      if (!font && fonts[0]) {
        out.text.fontFamily = fonts[0].family;
        out.text.fontStyle = fonts[0].style;
        out.text.fontWeight = fonts[0].weight;
      }
      if (out.text.fontSize === undefined && fonts[0]) out.text.fontSize = fonts[0].size;
    } catch (error) {
      /* older Figma: the single font above is all there is */
    }
    // The text as a 2x picture, with the box it covers: the app shows it while the font is missing there.
    if (options.textImages) {
      try {
        // The picture covers exactly the text's box (render bounds of the working copy can be stale).
        const bytes = await exportAtFullOpacity(node, { format: "PNG", constraint: { type: "SCALE", value: 2 }, useAbsoluteBounds: true });
        out.textPng = "data:image/png;base64," + figma.base64Encode(bytes);
        const box = node.absoluteBoundingBox;
        if (box) out.textPngBox = { x: whole(box.x), y: whole(box.y), width: whole(box.width), height: whole(box.height) };
      } catch (error) {
        out.textPngError = String(error && error.message ? error.message : error);
      }
    }
  }
  if (node.type === "INSTANCE") {
    try {
      const main = typeof node.getMainComponentAsync === "function" ? await node.getMainComponentAsync() : node.mainComponent;
      if (main) out.component = main.name;
    } catch (error) {
      /* the component may not be reachable */
    }
  }

  if (options.fillImages && needsFillImage(node)) {
    try {
      out.fillImage = await exportFill(node);
    } catch (error) {
      out.fillImageError = String(error && error.message ? error.message : error);
    }
  }

  if (options.fillImages && node.type !== "TEXT") {
    const picture = await originalPicture(node);
    if (picture) out.image = picture;
  }

  // A marked layer is one layer: a 2x picture (single) or its SVG (asset), with nothing listed inside it.
  if (node.type !== "TEXT" && (mark === "single" || mark === "asset")) {
    if (mark === "asset") {
      try {
        await exportSvg(node, out);
        return out;
      } catch (error) {
        out.svgError = String(error && error.message ? error.message : error);
      }
    }
    try {
      const bytes = await exportAtFullOpacity(node, { format: "PNG", constraint: { type: "SCALE", value: 2 } });
      out.vectorPng = "data:image/png;base64," + figma.base64Encode(bytes);
      const box = node.absoluteRenderBounds || node.absoluteBoundingBox;
      if (box) out.vectorPngBox = { x: whole(box.x), y: whole(box.y), width: whole(box.width), height: whole(box.height) };
      return out;
    } catch (error) {
      out.vectorPngError = String(error && error.message ? error.message : error);
    }
  }

  // A drawn shape as its outline: the app paints it with its fill and stroke (colors, gradients), which stay editable there.
  if (options.svg && node.type !== "TEXT") {
    const outline = pathOutline(node);
    if (outline) {
      out.paths = outline;
      delete out.children;
      return out;
    }
  }

  // Large drawn paths: as an exact 2x picture when blur or shadows are on them (SVG cannot carry Figma's progressive
  // blur), as SVG otherwise. Small ones are icons (below).
  if (isVectorShape(node) && !isIcon(node) && !holdsPicture(node)) {
    if (hasEffects(node)) {
      try {
        const bytes = await exportAtFullOpacity(node, { format: "PNG", constraint: { type: "SCALE", value: 2 } });
        out.vectorPng = "data:image/png;base64," + figma.base64Encode(bytes);
        // Only its size is used: the app centers it on the shape's box (render bounds of the working copy can be stale).
        const box = node.absoluteRenderBounds || node.absoluteBoundingBox;
        if (box) out.vectorPngBox = { x: whole(box.x), y: whole(box.y), width: whole(box.width), height: whole(box.height) };
        return out;
      } catch (error) {
        out.vectorPngError = String(error && error.message ? error.message : error);
      }
    }
    try {
      await exportSvg(node, out);
      return out;
    } catch (error) {
      out.svgError = String(error && error.message ? error.message : error);
    }
  }

  if (options.svg && isIcon(node)) {
    try {
      await exportSvg(node, out);
    } catch (error) {
      out.svgError = String(error && error.message ? error.message : error);
    }
    return out;
  }
  if ("children" in node && node.children.length && depth < options.maxDepth) {
    out.children = [];
    // A mask layer cuts the siblings above it (drawn after it) in the same parent. Each child tells its own position
    // (idx) and which sibling masks it (maskBy), so hidden layers can go without moving the numbers.
    let masker = -1;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      const isMask = "isMask" in child && child.isMask === true;
      // Hidden layers are cleaned away, but a mask stays: it still cuts what it masks.
      if (options.dropHidden && child.visible === false && !isMask) continue;
      const described = await describe(child, depth + 1);
      described.idx = index;
      if (isMask) {
        described.isMask = true;
        if (child.maskType) described.maskType = child.maskType;
        masker = index;
      } else if (masker >= 0) {
        described.maskBy = masker;
      }
      out.children.push(described);
    }
  }
  return out;
}

function count(node) {
  return 1 + (node.children ? node.children.reduce((sum, child) => sum + count(child), 0) : 0);
}

// What the selection holds, for the summary in the window.
function stats(node, into) {
  into.layers += 1;
  if (node.type === "TEXT") into.texts += 1;
  if (node.frame) into.frames += 1;
  if (node.svg) into.icons += 1;
  if (node.fillImage || node.image) into.pictureFills += 1;
  if (node.effects) into.effects += node.effects.length;
  if (node.children) node.children.forEach((child) => stats(child, into));
  return into;
}

// File-like layer names ("69d256de7d74a6529b29daf1_Polygon%201.svg 2"): the hash, the %20 codes and the file extension go.
function fileJunkOut(name) {
  let text = String(name);
  let changed = false;
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) { text = decoded; changed = true; }
  } catch (error) { /* not an encoded name */ }
  const noExt = text.replace(/\.(svg|png|jpe?g|gif|webp|avif|mp4|webm|mov|pdf)\b/gi, "");
  if (noExt !== text) { text = noExt; changed = true; }
  const noHash = text.replace(/^[0-9a-f]{12,}[\s_-]+/i, "");
  if (noHash !== text) { text = noHash; changed = true; }
  if (changed) text = text.replace(/_+/g, " ");
  return text.replace(/\s+/g, " ").trim();
}
// The base of a clean name: file junk, "copy" and trailing numbers removed.
function tidyBase(name) {
  let base = fileJunkOut(name).replace(/\s+copy(\s*\d+)?$/i, "");
  for (let again = true; again; ) {
    const next = base.replace(/[\s_-]*\d+$/, "").trim();
    again = next !== base.trim() && next.length > 0;
    if (again) base = next;
  }
  return base.trim();
}

// Name cleaner: "Rectangle 4821", "Frame 12" and "Group 3 copy" lose their numbers, and every layer ends up with a unique name
// ("Rectangle", "Rectangle 2", ...). Texts keep their wording (the name is the text).
function cleanNames(nodes) {
  const used = new Set();
  const labelOf = (type) => String(type).toLowerCase().replace(/(^|_)(\w)/g, (m, a, b) => (a ? " " : "") + b.toUpperCase()).trim();
  const taken = (name) => used.has(name.toLowerCase());
  const visit = (node) => {
    if (node.type !== "TEXT") {
      let base = tidyBase(node.name || "");
      if (!base) base = labelOf(node.type);
      let name = base;
      for (let n = 2; taken(name); n++) name = base + " " + n;
      node.name = name;
      used.add(name.toLowerCase());
    }
    (node.children || []).forEach(visit);
  };
  nodes.forEach(visit);
}

// Clean selection (a button): the same cleaning the copy does, but done to the layers in the Figma file before copying, so the
// file itself is tidy. One step in Figma's history: Cmd+Z undoes all of it.
const cleanSettings = { names: true, round: true, hidden: true, paints: true };
function cleanFile(selection) {
  const cfg = cleanSettings;
  const done = { named: 0, removed: 0, rounded: 0, tidied: 0 };
  const used = new Set();
  const labelOf = (type) => String(type).toLowerCase().replace(/(^|_)(\w)/g, (m, a, b) => (a ? " " : "") + b.toUpperCase()).trim();
  const walk = (node) => {
    // Hidden layers go first (a hidden mask stays: it still cuts).
    if (cfg.hidden && "children" in node) {
      for (const child of node.children.slice()) {
        const isMask = "isMask" in child && child.isMask === true;
        if (child.visible === false && !isMask) {
          try { child.remove(); done.removed += 1; } catch (error) { /* part of an instance: cannot be removed */ }
        }
      }
    }
    // Fills, strokes and effects that are switched off.
    for (const key of cfg.paints ? ["fills", "strokes", "effects"] : []) {
      if (!(key in node)) continue;
      try {
        const list = node[key];
        if (Array.isArray(list) && list.some((item) => item.visible === false)) {
          node[key] = list.filter((item) => item.visible !== false);
          done.tidied += 1;
        }
      } catch (error) { /* locked */ }
    }
    // Whole numbers for position, size, radius and stroke (not for rotated layers' position, nor texts' size).
    if (cfg.round) try {
      const before = [node.x, node.y, node.width, node.height].join();
      const fixed = !node.rotation && !(node.parent && "layoutMode" in node.parent && node.parent.layoutMode !== "NONE" && node.layoutPositioning !== "ABSOLUTE");
      if (fixed && "x" in node) {
        node.x = Math.round(node.x);
        node.y = Math.round(node.y);
      }
      if ("resize" in node && node.type !== "TEXT" && !node.rotation) {
        const w = Math.max(0.01, Math.round(node.width));
        const h = Math.max(0.01, Math.round(node.height));
        if (w !== node.width || h !== node.height) node.resize(w, h);
      }
      if ("cornerRadius" in node) {
        if (node.cornerRadius === figma.mixed) {
          node.topLeftRadius = Math.round(node.topLeftRadius);
          node.topRightRadius = Math.round(node.topRightRadius);
          node.bottomRightRadius = Math.round(node.bottomRightRadius);
          node.bottomLeftRadius = Math.round(node.bottomLeftRadius);
        } else if (node.cornerRadius) {
          node.cornerRadius = Math.round(node.cornerRadius);
        }
      }
      if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight % 1 !== 0) node.strokeWeight = Math.round(node.strokeWeight);
      if ([node.x, node.y, node.width, node.height].join() !== before) done.rounded += 1;
    } catch (error) { /* a layer Figma will not change */ }
    // Names: numbers go, every name is unique; the mark sign stays; texts keep their wording.
    if (cfg.names && node.type !== "TEXT") {
      try {
        const mark = markOf(node);
        let base = tidyBase(plainName(node.name));
        if (!base) base = labelOf(node.type);
        let name = base;
        for (let n = 2; used.has(name.toLowerCase()); n++) name = base + " " + n;
        used.add(name.toLowerCase());
        const full = (mark ? MARK_SIGNS[mark] : "") + name;
        if (full !== node.name) {
          node.name = full;
          done.named += 1;
        }
      } catch (error) { /* locked */ }
    }
    if ("children" in node) node.children.slice().forEach(walk);
  };
  selection.forEach(walk);
  return done;
}

// Lottie tab: what in the selection a Lottie file cannot carry (or carries badly), and how to solve each. Read only: nothing in
// the file changes. Matches the checks the app makes on a Lottie project (effects, blend modes, live text, merged paths ...).
function analyzeLottie(selection) {
  const found = new Map();
  let total = 0;
  const add = (key, severity, title, why, fix, node) => {
    let entry = found.get(key);
    if (!entry) {
      entry = { key, severity, title, why, fix, items: [], count: 0 };
      found.set(key, entry);
    }
    entry.count += 1;
    if (entry.items.length < 40) entry.items.push({ id: node.id, name: plainName(node.name) || node.type });
  };
  const visit = (node) => {
    total += 1;
    const hidden = node.visible === false;
    if (hidden) {
      add("hidden", "info", "Hidden layers", "Hidden layers still count as layers and may travel into the file.", "Delete them (Clean selection ▸ Hidden layers), or keep only what is needed.", node);
      return;
    }
    if (node.type === "TEXT") add("text", "error", "Live text", "A Lottie player draws text only from outlines (or bundled font glyphs); canvas players draw nothing.", "Outline the text: select it and press ⌘E (Flatten), or Object ▸ Outline stroke.", node);
    if (node.type === "BOOLEAN_OPERATION") add("boolean", "warn", "Boolean shapes", "Merged shapes become Merge Paths, which lottie-web ignores.", "Flatten the shape (⌘E) so it is one plain path.", node);
    if ("effects" in node && Array.isArray(node.effects)) {
      const fx = node.effects.filter((e) => e.visible !== false);
      if (fx.length > 0) add("effects", "error", "Effects (blur, shadow, glass)", "Layer blur, background blur, shadows and glass are ignored by iOS, Android and most web players.", "Remove them, or draw the shadow or glow as a soft gradient shape with lower opacity.", node);
    }
    if ("blendMode" in node && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") add("blend", "warn", "Blend modes", "Android ignores blend modes and iOS supports only some.", "Set the layer to Normal, or bake the look into the colors.", node);
    if ("isMask" in node && node.isMask === true && node.maskType === "LUMINANCE") add("luminance", "warn", "Luminance masks", "Only alpha masks and mattes play the same everywhere.", "Use an alpha mask (Mask ▸ Alpha), or a plain shape as the mask.", node);
    if ("fills" in node && Array.isArray(node.fills)) {
      for (const paint of node.fills) {
        if (paint.visible === false) continue;
        if (paint.type === "IMAGE") add("image", "warn", "Picture fills", "A picture is embedded in the file as an image: it makes the file big and cannot be scaled sharply.", "Use vector shapes where you can; keep pictures small, or leave them out.", node);
        else if (paint.type === "VIDEO") add("video", "error", "Video fills", "Lottie cannot carry video.", "Remove the video, or use a still picture or a vector illustration.", node);
        else if (paint.type === "GRADIENT_ANGULAR" || paint.type === "GRADIENT_DIAMOND") add("gradient", "error", "Angular and diamond gradients", "Lottie draws only linear and radial gradients.", "Use a linear or radial gradient, or build the look from a few shapes.", node);
      }
    }
    if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.some((s) => s.visible !== false)) {
      if (node.strokeAlign === "INSIDE" || node.strokeAlign === "OUTSIDE") add("strokealign", "warn", "Inside and outside strokes", "Lottie strokes always sit on the center of the path, so inside and outside strokes come out thicker or shifted.", "Set the stroke to Center, or Outline stroke (⌘⇧O) to turn it into a shape.", node);
      if ("strokeCap" in node && typeof node.strokeCap === "string" && node.strokeCap.indexOf("ARROW") === 0) add("arrow", "warn", "Arrow heads", "Arrow line ends are not part of Lottie strokes.", "Draw the arrow head as its own small shape.", node);
      if ("strokeTopWeight" in node && node.strokeTopWeight !== undefined && (node.strokeTopWeight !== node.strokeBottomWeight || node.strokeLeftWeight !== node.strokeRightWeight || node.strokeTopWeight !== node.strokeLeftWeight)) add("strokeweights", "warn", "Different stroke weights per side", "Lottie has one stroke width per shape.", "Use one weight for all sides, or draw each side as a line.", node);
    }
    if ("cornerSmoothing" in node && typeof node.cornerSmoothing === "number" && node.cornerSmoothing > 0) add("smoothing", "warn", "Corner smoothing", "Lottie rectangles have round corners only; smoothed (squircle) corners are not carried.", "Set corner smoothing to 0, or outline the shape (⌘E) to keep its exact curve.", node);
    if ("vectorNetwork" in node) {
      try {
        const points = node.vectorNetwork.vertices.length;
        if (points > 400) add("complex", "warn", "Very detailed paths", "Hundreds of points per path make the file heavy and slow to play.", "Simplify the path (fewer points), or draw it with simpler shapes.", node);
      } catch (error) { /* a path that cannot be read */ }
    }
    if ("children" in node) node.children.forEach(visit);
  };
  selection.forEach(visit);
  if (total > 250) {
    found.set("size", { key: "size", severity: "warn", title: "Many layers", why: total + " layers: big files play slowly, especially on phones.", fix: "Group and flatten parts that do not move, or use fewer, simpler shapes.", items: [], count: total });
  }
  const order = { error: 0, warn: 1, info: 2 };
  const issues = [...found.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return { total, issues };
}

// A temporary copy of the selection for reading: instances detached, auto layout off. The copy lives in a scratch
// frame far to the right of the design and is deleted afterwards, so the design itself is never changed.
async function flattenCopy(root) {
  let current = root;
  // Detach until no instance is left (a detached instance can hold more instances).
  for (let pass = 0; pass < 12; pass++) {
    const instances = "findAll" in current ? current.findAll((n) => n.type === "INSTANCE") : [];
    if (current.type === "INSTANCE") instances.unshift(current);
    if (instances.length === 0) break;
    let detached = 0;
    for (const instance of instances) {
      try {
        const frame = instance.detachInstance();
        if (instance === current) current = frame;
        detached += 1;
      } catch (error) {
        /* already gone with its parent, or not detachable: the next pass or the fallback handles it */
      }
    }
    if (detached === 0) break;
  }
  const withLayout = "findAll" in current ? current.findAll((n) => "layoutMode" in n && n.layoutMode !== "NONE") : [];
  if ("layoutMode" in current && current.layoutMode !== "NONE") withLayout.unshift(current);
  for (const frame of withLayout) {
    try {
      frame.setPluginData("moAuto", String(frame.layoutMode));
      frame.layoutMode = "NONE";
    } catch (error) {
      /* leave it as it is */
    }
  }
  return current;
}

async function prepareSelection(selection) {
  if (!options.flatten) return { originals: selection, roots: selection.slice(), cleanup() {} };
  const temp = scratch();
  let minX = Infinity;
  let minY = Infinity;
  for (const node of selection) {
    const box = node.absoluteBoundingBox;
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
  }
  const roots = [];
  for (const node of selection) {
    let copy = null;
    try {
      // A component is read through an instance, so the original component set is never copied into.
      copy = node.type === "COMPONENT" ? node.createInstance() : node.clone();
      temp.appendChild(copy);
      const box = node.absoluteBoundingBox;
      copy.x = box ? box.x - minX : 0;
      copy.y = box ? box.y - minY : 0;
      const flat = await flattenCopy(copy);
      copyMarks(node, flat);
      copy = flat;
    } catch (error) {
      if (copy) {
        try { copy.remove(); } catch (removeError) { /* nothing to do */ }
      }
      copy = null;
    }
    // A layer that could not be copied is read as it is (reading never changes it).
    roots.push(copy || node);
  }
  return { originals: selection, roots, cleanup() {} };
}

// What is selected, read without changing anything: shown in the window while you choose.
function tally(node, into) {
  into.layers += 1;
  if (node.type === "TEXT") into.texts += 1;
  if (isFrameNode(node)) into.frames += 1;
  if (node.type === "INSTANCE" || VECTOR_TYPES.indexOf(node.type) >= 0) into.icons += 1;
  if ("fills" in node && Array.isArray(node.fills) && node.fills.some((p) => p.type === "IMAGE" || p.type === "VIDEO")) into.pictureFills += 1;
  if ("effects" in node && Array.isArray(node.effects)) into.effects += node.effects.filter((e) => e.visible !== false).length;
  if ("children" in node) node.children.forEach((child) => tally(child, into));
}


// The pictures (picture fills) in the selection, each once: name of the first layer using it, how many layers use it, pixel size and file
// size. Sizes are cached per picture. The window asks for the bytes (pictureBytes) only when its "Make pictures smaller" switch is on.
const pictureInfo = new Map();
async function selectionPictures(selection) {
  const found = new Map();
  const walk = (node) => {
    if (node.visible === false) return;
    for (const paint of visiblePaints(node)) {
      if (paint.type !== "IMAGE" || !paint.imageHash) continue;
      const known = found.get(paint.imageHash);
      if (known) known.count += 1;
      else if (found.size < 40) found.set(paint.imageHash, { hash: paint.imageHash, name: plainName(node.name), count: 1 });
    }
    if ("children" in node) node.children.forEach(walk);
  };
  selection.forEach(walk);
  const out = [];
  for (const item of found.values()) {
    let info = pictureInfo.get(item.hash);
    if (!info) {
      try {
        const image = figma.getImageByHash(item.hash);
        const size = image && typeof image.getSizeAsync === "function" ? await image.getSizeAsync() : null;
        const bytes = image ? await image.getBytesAsync() : null;
        info = { width: size ? size.width : 0, height: size ? size.height : 0, bytes: bytes ? bytes.length : 0 };
      } catch (error) {
        info = { width: 0, height: 0, bytes: 0 };
      }
      pictureInfo.set(item.hash, info);
    }
    if (info.bytes > 0) out.push(Object.assign({}, item, info));
  }
  return out;
}

let busy = false;
let again = false;
async function summarize() {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "selection", empty: true });
      return;
    }
    const summary = { layers: 0, texts: 0, frames: 0, icons: 0, pictureFills: 0, effects: 0 };
    selection.forEach((node) => tally(node, summary));
    let preview = null;
    try {
      const bytes = await selection[0].exportAsync({ format: "PNG", constraint: { type: "WIDTH", value: 136 } });
      preview = "data:image/png;base64," + figma.base64Encode(bytes);
    } catch (error) {
      preview = null;
    }
    const first = selection[0];
    const marked = { bg: 0, single: 0, image: 0, asset: 0 };
    const countMarks = (node) => {
      const mark = markOf(node);
      if (mark) marked[mark] += 1;
      if ("children" in node) node.children.forEach(countMarks);
    };
    selection.forEach(countMarks);
    const images = await selectionPictures(selection);
    const own = selection.map(markOf);
    const common = own.every((mark) => mark === own[0]) ? own[0] : "mixed";
    const tags = selection.map(tagOf);
    const tag = tags.every((item) => item === tags[0]) ? tags[0] : "mixed";
    figma.ui.postMessage({
      type: "selection",
      mark: common,
      tag,
      customTags: Array.from(new Set(customTags().concat(tags.filter((item) => item && TAGS.indexOf(item.toLowerCase()) < 0)))),
      marked,
      empty: false,
      layers: summary.layers,
      summary,
      title: selection.length === 1 ? first.name : selection.length + " layers selected",
      size: selection.length === 1 && "width" in first ? Math.round(first.width) + " × " + Math.round(first.height) : "",
      preview,
      images,
    });
  } catch (error) {
    figma.ui.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
  } finally {
    busy = false;
    if (again) {
      again = false;
      summarize();
    }
  }
}

// Size of the file: what the copy weighs as it is, what it would weigh with the effects solved (effects left out, so blurred
// shapes are plain shapes), and what the whole selection weighs as one picture (1x and 2x).
let measuring = false;
async function copyBytes(selection, overrides) {
  const saved = Object.assign({}, options);
  Object.assign(options, overrides);
  try {
    const prepared = await prepareSelection(selection);
    const nodes = [];
    for (let index = 0; index < prepared.roots.length; index++) {
      const described = await describe(prepared.roots[index], 0);
      if (options.png) {
        try {
          const bytes = await prepared.originals[index].exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
          described.png = "data:image/png;base64," + figma.base64Encode(bytes);
        } catch (error) { /* no picture */ }
      }
      nodes.push(described);
    }
    return JSON.stringify({ type: "mo-figma-layers", nodes }).length;
  } finally {
    dropScratch();
    Object.assign(options, saved);
  }
}
async function measureSizes() {
  if (measuring) return;
  measuring = true;
  try {
    const selection = figma.currentPage.selection.slice();
    if (selection.length === 0) return;
    figma.ui.postMessage({ type: "building", text: "Measuring the file size…" });
    const withEffects = analyzeLottie(selection).issues.some((issue) => issue.key === "effects");
    const now = await copyBytes(selection, {});
    const solved = withEffects ? await copyBytes(selection, { ignoreEffects: true }) : now;
    const issuesAsPictures = await copyBytes(selection, { issuePictures: true });
    let one = 0;
    let two = 0;
    for (const node of selection) {
      one += (await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } })).length;
      two += (await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } })).length;
    }
    figma.ui.postMessage({ type: "sizes", asIs: now, solved, withEffects, issuesAsPictures, image1x: one, image2x: two });
  } catch (error) {
    dropScratch();
    figma.ui.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
  } finally {
    measuring = false;
  }
}

// Pressing Copy: the whole reading happens now, on the scratch page, and the page ends up as it was.
let building = false;
async function build() {
  if (building) return;
  building = true;
  try {
    const selection = figma.currentPage.selection.slice();
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "Select a frame or layers first." });
      return;
    }
    figma.ui.postMessage({ type: "building", text: "Preparing a copy…" });
    const nodes = [];
    const prepared = await prepareSelection(selection);
    try {
      figma.ui.postMessage({ type: "building", text: "Reading layers…" });
      for (let index = 0; index < prepared.roots.length; index++) {
        const node = prepared.roots[index];
        const original = prepared.originals[index];
        const described = await describe(node, 0);
        // The picture is taken from the real layer: effects such as background blur need what is behind them.
        if (options.png) {
          figma.ui.postMessage({ type: "building", text: "Taking the picture…" });
          try {
            const bytes = await original.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
            described.png = "data:image/png;base64," + figma.base64Encode(bytes);
          } catch (error) {
            described.pngError = String(error && error.message ? error.message : error);
          }
        }
        if (options.frameSvg && !described.svg) {
          try {
            described.frameSvg = await original.exportAsync({ format: "SVG_STRING" });
          } catch (error) {
            described.frameSvgError = String(error && error.message ? error.message : error);
          }
        }
        nodes.push(described);
      }
    } finally {
      dropScratch();
    }
    if (options.cleanNames) cleanNames(nodes);
    const data = {
      type: "mo-figma-layers",
      version: 10,
      fileName: figma.root.name,
      page: figma.currentPage.name,
      exportedAt: new Date().toISOString(),
      nodes,
    };
    const summary = { layers: 0, texts: 0, frames: 0, icons: 0, pictureFills: 0, effects: 0 };
    nodes.forEach((node) => stats(node, summary));
    figma.ui.postMessage({ type: "payload", layers: summary.layers, summary, json: JSON.stringify(data, null, 2) });
  } catch (error) {
    dropScratch();
    figma.ui.postMessage({ type: "error", message: String(error && error.message ? error.message : error) });
  } finally {
    building = false;
  }
}

// A burst of selection changes (dragging a selection box) is read once, after it settles.
let settle = null;
figma.on("selectionchange", () => {
  if (settle) clearTimeout(settle);
  settle = setTimeout(summarize, 200);
});
figma.ui.onmessage = (message) => {
  if (message.type === "options") {
    options.svg = !!message.svg;
    options.png = !!message.png;
    options.frameSvg = !!message.frameSvg;
    options.fillImages = message.fillImages !== false;
    options.textImages = message.textImages !== false;
    options.flatten = message.flatten !== false;
    options.cleanNames = message.cleanNames !== false;
    options.dropHidden = message.dropHidden !== false;
    options.roundValues = message.roundValues !== false;
    options.issuePictures = message.issuePictures === true;
  }
  if (message.type === "pictureBytes") {
    (async () => {
      const items = [];
      for (const hash of message.hashes || []) {
        try {
          const image = figma.getImageByHash(hash);
          if (image) items.push({ hash, bytes: await image.getBytesAsync() });
        } catch (error) { /* a picture that cannot be read is left out */ }
      }
      figma.ui.postMessage({ type: "pictureBytes", items });
    })();
  }
  if (message.type === "mark") {
    const selection = figma.currentPage.selection;
    const same = selection.length > 0 && selection.every((node) => markOf(node) === message.mark);
    for (const node of selection) setMark(node, same ? "" : message.mark);
    summarize();
  }
  if (message.type === "tag") {
    // Chosen for every selected layer; "" clears it. Tags never change a layer's name.
    for (const node of figma.currentPage.selection) setTag(node, message.tag);
    summarize();
  }
  if (message.type === "newTag") {
    const tag = cleanTag(message.tag);
    if (tag) {
      if (TAGS.indexOf(tag.toLowerCase()) < 0) saveCustomTags(customTags().concat(tag));
      for (const node of figma.currentPage.selection) setTag(node, tag);
    }
    summarize();
  }
  if (message.type === "renameTag") {
    const from = cleanTag(message.from);
    const to = cleanTag(message.to);
    if (from && to && from.toLowerCase() !== to.toLowerCase()) {
      // Every layer of this page with the tag takes the new name (a ready-made tag renamed this way becomes one of your own).
      const rename = (node) => {
        if (tagOf(node).toLowerCase() === from.toLowerCase()) setTag(node, to);
        if ("children" in node) node.children.forEach(rename);
      };
      figma.currentPage.children.forEach(rename);
      saveCustomTags(customTags().filter((tag) => tag.toLowerCase() !== from.toLowerCase()).concat(to));
      figma.notify('Tag "' + from + '" is now "' + to + '" on this page');
    }
    summarize();
  }
  if (message.type === "clearMarks") {
    const clear = (node) => {
      if (markOf(node)) setMark(node, "");
      if ("children" in node) node.children.forEach(clear);
    };
    figma.currentPage.selection.forEach(clear);
    summarize();
  }
  if (message.type === "cleanSettings") {
    for (const key of Object.keys(cleanSettings)) cleanSettings[key] = message[key] !== false;
    try { figma.clientStorage.setAsync("moCleanSettings", cleanSettings); } catch (error) { /* not saved */ }
  }
  if (message.type === "clean") {
    const selection = figma.currentPage.selection.slice();
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "Select a frame or layers first." });
    } else {
      const done = cleanFile(selection);
      const text = done.named + " renamed, " + done.rounded + " rounded, " + done.removed + " hidden removed, " + done.tidied + " tidied";
      figma.notify("Cleaned: " + text + " (Cmd+Z undoes)");
      figma.ui.postMessage({ type: "cleaned", text });
      summarize();
    }
  }
  if (message.type === "analyzeLottie") {
    const selection = figma.currentPage.selection.slice();
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "Select a frame or layers first." });
    } else {
      (async () => {
        const report = analyzeLottie(selection);
        // If these layers were pictures instead (no motion): the real PNG size of a few of them, scaled to all of them.
        for (const issue of report.issues) {
          if (issue.key === "text" || issue.key === "hidden" || issue.key === "size" || issue.items.length === 0) continue;
          const sample = issue.items.slice(0, 4);
          let one = 0;
          let two = 0;
          let done = 0;
          for (const item of sample) {
            try {
              const node = await figma.getNodeByIdAsync(item.id);
              if (!node || !("exportAsync" in node)) continue;
              one += (await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } })).length;
              two += (await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } })).length;
              done += 1;
            } catch (error) { /* a layer that cannot be exported */ }
          }
          if (done > 0) {
            const factor = issue.count / done;
            issue.asPicture = { bytes1x: Math.round(one * factor), bytes2x: Math.round(two * factor), sampled: done };
          }
        }
        figma.ui.postMessage({ type: "lottie", report, title: selection.length === 1 ? selection[0].name : selection.length + " layers" });
      })();
    }
  }
  if (message.type === "selectNodes") {
    (async () => {
      const nodes = [];
      for (const id of message.ids || []) {
        const node = await figma.getNodeByIdAsync(id);
        if (node && node.type !== "DOCUMENT" && node.type !== "PAGE") nodes.push(node);
      }
      if (nodes.length > 0) {
        figma.currentPage.selection = nodes;
        figma.viewport.scrollAndZoomIntoView(nodes);
      }
    })();
  }
  if (message.type === "measure") measureSizes();
  if (message.type === "copy") build();
  if (message.type === "resize") figma.ui.resize(360, Math.max(300, Math.min(900, Math.round(message.height))));
  if (message.type === "copied") figma.notify("Layer JSON copied");
  if (message.type === "close") figma.closePlugin();
};
// A page left over from a run that was cut short is cleared when the plugin opens.
for (const page of figma.root.children) {
  if (page.name === "Copy Layer JSON (temporary)") {
    try { page.remove(); } catch (error) { /* in use */ }
  }
}
summarize();
try {
  figma.clientStorage.getAsync("moCleanSettings").then((saved) => {
    if (saved && typeof saved === "object") {
      for (const key of Object.keys(cleanSettings)) if (typeof saved[key] === "boolean") cleanSettings[key] = saved[key];
      figma.ui.postMessage({ type: "cleanSettings", settings: cleanSettings });
    }
  });
} catch (error) { /* settings stay as they are */ }
