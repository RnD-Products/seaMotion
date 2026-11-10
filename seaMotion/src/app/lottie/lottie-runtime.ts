import { prepareLottie } from "./lottie-data";

// The lottie-web canvas player without expressions, as source text. It runs inside the animation sandbox,
// so a Lottie project plays there exactly like a drawing script does, and the preview shows what players
// without expressions show.
export async function loadLottiePlayerSource(): Promise<string> {
  const module = await import("lottie-web/build/player/lottie_light_canvas.min.js?raw");
  return module.default;
}

// The drawing script every Lottie Animation project runs in the sandbox (instead of its own `code`).
// `api.lottie` is the project's Lottie JSON and `api.lottiePlayer` the lottie-web player. Each render prepares
// the data for the visible layers and the Layer section's blend and opacity, plays it on its own canvas at
// the frame's pixel size and copies the picture into the frame.
export const LOTTIE_SCRIPT = `
const player = api.lottiePlayer;
const source = api.lottie;
const prepare = (${prepareLottie.toString()});
const ids = source.layers.map((layer, index) => "lottie-" + (layer && typeof layer.ind === "number" ? layer.ind : index));
const totalFrames = source.op - source.ip;
// A few loaded players (the preview and a small measuring picture can alternate sizes).
const players = [];
const MAX_PLAYERS = 2;
async function playerFor(width, height, key, options) {
  const found = players.find((item) => item.key === key && item.width === width && item.height === height);
  if (found) return found;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  const anim = player.loadAnimation({
    animationData: prepare(source, options),
    autoplay: false,
    loop: false,
    renderer: "canvas",
    rendererSettings: { clearCanvas: true, context, preserveAspectRatio: "xMidYMid meet" },
  });
  await new Promise((resolve, reject) => {
    if (anim.isLoaded) return resolve();
    anim.addEventListener("DOMLoaded", () => resolve());
    anim.addEventListener("data_failed", () => reject(new Error("The Lottie animation could not be loaded.")));
    setTimeout(resolve, 8000);
  });
  const item = { anim, canvas, height, key, width };
  players.unshift(item);
  while (players.length > MAX_PLAYERS) players.pop().anim.destroy();
  return item;
}
return {
  async render(context, frame) {
    const params = frame.params || {};
    const shown = new Set(frame.layerStack);
    const options = {
      background: null,
      hidden: ids.filter((id) => !shown.has(id)),
      styles: params.__layerStyle && typeof params.__layerStyle === "object" ? params.__layerStyle : {},
    };
    const item = await playerFor(frame.pixelWidth, frame.pixelHeight, JSON.stringify(options), options);
    let at = (frame.timeSeconds * source.fr) % totalFrames;
    if (at < 0) at += totalFrames;
    item.anim.goToAndStop(at, true);
    context.drawImage(item.canvas, 0, 0);
  },
  dispose() {
    for (const item of players.splice(0)) item.anim.destroy();
  },
};
`;
