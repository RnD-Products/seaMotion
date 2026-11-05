import { describe, expect, it } from "vitest";

import { readSoundSettings, soundtrackKey, soundtrackRequest } from "./sound";

const tap = { color: "#111111", device: "desktop", duration: 0.8, id: "t", start: 1, type: "tap" };

describe("Sound", () => {
  it("is off until a switch is on", () => {
    expect(soundtrackRequest({}, 10)).toBeNull();
    expect(readSoundSettings({}).preview).toBe(true);
  });

  it("takes interaction sounds from the Reactor items only while the Reactor is on", () => {
    const values = { "interactions.enabled": true, "interactions.list": { items: [tap] }, "sound.sfx": true };
    expect(soundtrackRequest(values, 10)?.items).toHaveLength(1);
    expect(soundtrackRequest({ ...values, "interactions.enabled": false }, 10)).toBeNull();
  });

  it("builds music on its own, and its key follows what changes the sound", () => {
    const calm = soundtrackRequest({ "sound.music": true }, 12);
    const bright = soundtrackRequest({ "sound.music": true, "sound.musicMood": "bright" }, 12);
    const longer = soundtrackRequest({ "sound.music": true }, 14);
    expect(calm?.settings.musicVolume).toBeCloseTo(0.35);
    expect(new Set([soundtrackKey(calm), soundtrackKey(bright), soundtrackKey(longer)]).size).toBe(3);
    expect(soundtrackKey(soundtrackRequest({ "sound.music": true, "sound.preview": false }, 12))).toBe(soundtrackKey(calm));
  });

  it("reads the music's fade in and out and builds a new soundtrack when they change", () => {
    const base = { "sound.music": true };
    expect(readSoundSettings(base).musicFadeIn).toBe(0);
    expect(readSoundSettings({ ...base, "sound.musicFadeIn": 0.4, "sound.musicFadeOut": 99 })).toMatchObject({ musicFadeIn: 0.4, musicFadeOut: 10 });
    expect(soundtrackKey(soundtrackRequest({ ...base, "sound.musicFadeOut": 1 }, 12))).not.toBe(soundtrackKey(soundtrackRequest(base, 12)));
  });

  it("offers three sound styles, Soft by default, each its own soundtrack", () => {
    const values = { "interactions.enabled": true, "interactions.list": { items: [tap] }, "sound.sfx": true };
    expect(readSoundSettings(values).sfxStyle).toBe("soft");
    expect(readSoundSettings({ ...values, "sound.sfxStyle": "nope" }).sfxStyle).toBe("soft");
    const keys = ["soft", "crisp", "bubble"].map((style) => soundtrackKey(soundtrackRequest({ ...values, "sound.sfxStyle": style }, 10)));
    expect(new Set(keys).size).toBe(3);
  });

  it("has a pitch from -12 to +12 semitones that changes the soundtrack", () => {
    const values = { "interactions.enabled": true, "interactions.list": { items: [tap] }, "sound.sfx": true };
    expect(readSoundSettings(values).sfxPitch).toBe(0);
    expect(readSoundSettings({ ...values, "sound.sfxPitch": 30 }).sfxPitch).toBe(12);
    expect(soundtrackKey(soundtrackRequest({ ...values, "sound.sfxPitch": 5 }, 10))).not.toBe(soundtrackKey(soundtrackRequest(values, 10)));
  });

  it("adds a drag sound with its own style and volume, only with interaction sounds on", () => {
    const values = { "interactions.enabled": true, "interactions.list": { items: [tap] }, "sound.sfx": true };
    expect(readSoundSettings(values).drag).toBe(false);
    const swish = soundtrackKey(soundtrackRequest({ ...values, "sound.drag": true }, 10));
    const ticks = soundtrackKey(soundtrackRequest({ ...values, "sound.drag": true, "sound.dragStyle": "ticks" }, 10));
    expect(new Set([soundtrackKey(soundtrackRequest(values, 10)), swish, ticks]).size).toBe(3);
    expect(soundtrackRequest({ "sound.drag": true }, 10)).toBeNull();
  });

  it("has a Reel drag style and a drag fade that change the soundtrack", () => {
    const values = { "interactions.enabled": true, "interactions.list": { items: [tap] }, "sound.drag": true, "sound.sfx": true };
    expect(readSoundSettings({ ...values, "sound.dragStyle": "reel" }).dragStyle).toBe("reel");
    expect(readSoundSettings(values).dragFade).toBe(0.25);
    const reel = soundtrackKey(soundtrackRequest({ ...values, "sound.dragStyle": "reel" }, 10));
    const reelSlow = soundtrackKey(soundtrackRequest({ ...values, "sound.dragFade": 0.6, "sound.dragStyle": "reel" }, 10));
    expect(reel).not.toBe(reelSlow);
  });

  it("gives each interaction sound its own volume and pitch", () => {
    const values = { "interactions.enabled": true, "interactions.list": { items: [tap] }, "sound.sfx": true };
    const parts = readSoundSettings(values).parts;
    expect(parts.press).toEqual({ pitch: 0, volume: 1 });
    expect(readSoundSettings({ ...values, "sound.grabPitch": 40, "sound.grabVolume": 25 }).parts.grab).toEqual({ pitch: 12, volume: 0.25 });
    const base = soundtrackKey(soundtrackRequest(values, 10));
    expect(soundtrackKey(soundtrackRequest({ ...values, "sound.liftVolume": 0 }, 10))).not.toBe(base);
    expect(soundtrackKey(soundtrackRequest({ ...values, "sound.part": "grab" }, 10))).toBe(base);
  });
});
