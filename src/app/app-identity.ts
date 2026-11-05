export const appIdentity = {
  id: "mo-app",
  title: "seaMotion",
} as const;

// The saved state used to live under the key of the app's earlier id. It is copied to the new key once, before the
// runtime reads it, so the browser's project list and settings carry over.
try {
  const previousKey = "toolcraft:footer-motion:state:v2";
  const nextKey = `toolcraft:${appIdentity.id}:state:v2`;
  if (typeof localStorage !== "undefined" && localStorage.getItem(nextKey) === null) {
    const previous = localStorage.getItem(previousKey);
    if (previous !== null) localStorage.setItem(nextKey, previous);
  }
} catch {
  // Storage can be blocked or full; the app then starts with its defaults.
}
