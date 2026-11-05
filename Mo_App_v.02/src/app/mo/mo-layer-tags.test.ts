import { describe, expect, it } from "vitest";

import { layersWithTag, normalizeTag, renamedTag, tagKey, TAG_RENAMES_KEY, LAYER_TAGS_KEY } from "./mo-layer-tags";

describe("layer tags", () => {
  it("accepts any short name and cleans it", () => {
    expect(normalizeTag("  Hero   card ")).toBe("Hero card");
    expect(normalizeTag("x".repeat(40))).toHaveLength(24);
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag(3)).toBeNull();
  });
  it("reads a tag the same whatever its capitals", () => {
    expect(tagKey("Hero")).toBe(tagKey("hero"));
  });
  it("applies the names the app gave tags", () => {
    expect(renamedTag("shape", { [TAG_RENAMES_KEY]: { shape: "Box" } })).toBe("Box");
    expect(renamedTag("text", {})).toBe("text");
  });
  it("finds layers by a tag picked in the app", () => {
    const layers = [{ id: "a" }, { id: "b" }];
    const params = { [LAYER_TAGS_KEY]: { a: "Hero" }, [TAG_RENAMES_KEY]: { hero: "Star" } };
    expect(layersWithTag(null, layers, params, "star").map((layer) => layer.id)).toEqual(["a"]);
  });
});
