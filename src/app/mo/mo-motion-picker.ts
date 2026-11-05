import { defineToolcraftCustomControlType } from "@/toolcraft/runtime";

// Stands in the Animation section while a project has no motion yet.
export const moMotionPickerControl = defineToolcraftCustomControlType("moMotionPicker");

// The sidebar listens for this to open its project-file chooser.
export const OPEN_PROJECT_EVENT = "mo-app:open-project";

// The values of the open animation's controls, keyed by control id.
export const animationParamsControl = defineToolcraftCustomControlType("animationParams");

// The same parameters shown as the Interaction plan of an Interaction Animation project.
export const interactionPlanControl = defineToolcraftCustomControlType("interactionPlan");
// Motion tab > Preset: ready-made motion (Floating) applied to the layer selected in the Layers panel.
export const motionPresetsControl = defineToolcraftCustomControlType("motionPresets");
export const scenesControl = defineToolcraftCustomControlType("scenes");

// Every animation opened so far (controls, layers, script and files), kept by id so projects only name theirs.
export const animationLibraryControl = defineToolcraftCustomControlType("animationLibrary");

// The design's own properties (frame corner radius, colors and so on); values live with the animation's.
export const frameSettingsControl = defineToolcraftCustomControlType("frameSettings");

// Perspective for the layer selected in the Layers tab (opened from the tool rail).
export const layerPerspectiveControl = defineToolcraftCustomControlType("layerPerspective");

// The artboard (canvas) width and height, shown in the Modifier tab.
export const artboardFontsControl = defineToolcraftCustomControlType("artboardFonts");
export const artboardSizeControl = defineToolcraftCustomControlType("artboardSize");

// Edits the layer selected in the Layers tab: its visibility and its own design controls.
export const layerEditorControl = defineToolcraftCustomControlType("layerEditor");

// The tag of the layer selected in the Layers tab (what kind of layer it is), in its own Tag section.
export const layerTagControl = defineToolcraftCustomControlType("layerTag");

// The images of the edited layer as a thumbnail grid (reorder, remove, add).
export const layerImagesControl = defineToolcraftCustomControlType("layerImages");

// Text fields for the texts the edited layer draws; values are replacements keyed by the original text.
export const layerTextsControl = defineToolcraftCustomControlType("layerTexts");

// One uploaded picture (mockup background, sticky item); the value is the picture as a data URL.
export const imageSlotControl = defineToolcraftCustomControlType("imageSlot");

// The ratios the sticky items show on (multi-select chips).
export const stickyRatiosControl = defineToolcraftCustomControlType("stickyRatios");

// Presets of the sticky settings, kept for every project.
export const stickyPresetsControl = defineToolcraftCustomControlType("stickyPresets");

// The interaction kit items on the timeline (which icon, when, and where it follows).
export const interactionListControl = defineToolcraftCustomControlType("interactionList");

// Which kind of motion the project is: a plain animation or a landing page (Dashboard and App come later).
export const motionTypeControl = defineToolcraftCustomControlType("motionType");

// The frame a Landing Page is shown in (none, fill, browser, image; device later).
export const landingMockupControl = defineToolcraftCustomControlType("landingMockup");

// The vertical page bar of a Landing Page: loading, scroll stops, interactions and sections.
export const scrollPlanControl = defineToolcraftCustomControlType("scrollPlan");

// How the layers of each section of a Landing Page move in (fade, blur, scale, slide) and loop, saved per section name.
export const sectionMotionControl = defineToolcraftCustomControlType("sectionMotion");
