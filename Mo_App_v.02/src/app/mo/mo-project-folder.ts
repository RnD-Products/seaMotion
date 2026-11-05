import { MEDIA_FILE_ACCEPT } from "../media/media-layer";
export function canPickMoProjectFile(): boolean {
  return typeof document !== "undefined";
}

// Lets the user choose a file. A file input is used because it works in every browser, including embedded
// ones that have no file-picker API.
export function pickMoFile(accept: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    const cleanup = (): void => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        reject(new DOMException("No file chosen.", "AbortError"));
        return;
      }
      resolve(file);
    });
    input.addEventListener("cancel", () => {
      cleanup();
      reject(new DOMException("No file chosen.", "AbortError"));
    });
    document.body.append(input);
    input.click();
  });
}

// A project to open: a project or Lottie .json, or a video or GIF (which opens as a new project).
export function pickMoProjectFile(): Promise<File> {
  return pickMoFile(`.json,application/json,${MEDIA_FILE_ACCEPT}`);
}

// Downloads `data` as `<name>.json`, named after the project.
export function downloadMoProjectFile(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  // Named after the project; only characters files cannot contain are replaced.
  anchor.download = `${name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "project"}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
