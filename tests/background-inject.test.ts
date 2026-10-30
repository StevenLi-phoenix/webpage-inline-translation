import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";

const executeScript = vi.fn();
const registerContentScripts = vi.fn(async (_scripts: unknown[]) => undefined);
const unregisterContentScripts = vi.fn(async (_filter: unknown) => undefined);
const getRegisteredContentScripts = vi.fn(async () => [] as Array<{ id: string }>);
let granted: Set<string>;
let stored: Record<string, unknown>;
let session: Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  granted = new Set(); stored = {}; session = {};
  executeScript.mockReset(); registerContentScripts.mockClear(); unregisterContentScripts.mockClear(); getRegisteredContentScripts.mockClear();
  vi.stubGlobal("chrome", {
    scripting: { executeScript, registerContentScripts, unregisterContentScripts, getRegisteredContentScripts },
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every(origin => granted.has(origin)) },
    storage: {
      local: { get: async () => structuredClone(stored) },
      session: { get: async (key: string) => ({ [key]: session[key] }), set: async (value: Record<string, unknown>) => { Object.assign(session, value); } }
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("on-demand injection", () => {
  it("injects the page bundle and frame bootstrap into a tab nobody has acted on", async () => {
    executeScript.mockResolvedValueOnce([{ result: false }]).mockResolvedValue([]);
    const { ensureContent } = await import("../src/background/inject");
    await ensureContent(7);
    expect(executeScript.mock.calls.map(([details]) => details.files ?? "probe")).toEqual(["probe", ["content.js"], ["frame-bootstrap.js"]]);
    expect(executeScript.mock.calls[2][0].target).toEqual({ tabId: 7, allFrames: true });
    expect(session["wupage.active-tabs"]).toEqual([7]);
  });
  it("does not inject the page bundle twice but still refreshes the frames", async () => {
    executeScript.mockResolvedValueOnce([{ result: true }]).mockResolvedValue([]);
    const { ensureContent } = await import("../src/background/inject");
    await ensureContent(7);
    expect(executeScript.mock.calls.map(([details]) => details.files ?? "probe")).toEqual(["probe", ["frame-bootstrap.js"]]);
  });
  it("joins concurrent requests for the same tab", async () => {
    executeScript.mockResolvedValueOnce([{ result: false }]).mockResolvedValue([]);
    const { ensureContent } = await import("../src/background/inject");
    await Promise.all([ensureContent(3), ensureContent(3)]);
    expect(executeScript).toHaveBeenCalledTimes(3);
  });
  it("tolerates frames the tab grant does not cover", async () => {
    executeScript.mockResolvedValueOnce([{ result: false }]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Cannot access contents of url"));
    const { ensureContent } = await import("../src/background/inject");
    await expect(ensureContent(9)).resolves.toBeUndefined();
  });
});

describe("persistent registration", () => {
  it("registers nothing until the user listed a site and granted it", async () => {
    stored[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, autoTranslation: { enabled: true, nonTargetLanguage: false, presetSites: ["github.com"], customSites: [] } };
    const { syncPersistentScripts } = await import("../src/background/inject");
    await syncPersistentScripts();
    expect(registerContentScripts).not.toHaveBeenCalled();
    granted = new Set(["*://github.com/*", "*://*.github.com/*"]);
    await syncPersistentScripts();
    const scripts = registerContentScripts.mock.calls[0][0] as Array<{ id: string; matches: string[]; js: string[] }>;
    expect(scripts.map(script => script.id)).toEqual(["wupage-content", "wupage-frames"]);
    expect(scripts[0].matches).toEqual(["*://github.com/*", "*://*.github.com/*"]);
  });
  it("replaces earlier registrations and adds the caption bridge for granted video sites", async () => {
    stored[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, videoTranslation: { ...DEFAULT_SETTINGS.videoTranslation, enabledSites: ["youtube.com"] } };
    granted = new Set(["*://youtube.com/*", "*://*.youtube.com/*"]);
    getRegisteredContentScripts.mockResolvedValueOnce([{ id: "wupage-content" }]);
    const { syncPersistentScripts } = await import("../src/background/inject");
    await syncPersistentScripts();
    expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ["wupage-content"] });
    const scripts = registerContentScripts.mock.calls[0][0] as Array<{ id: string; world?: string }>;
    expect(scripts.find(script => script.id === "wupage-video-bridge")?.world).toBe("MAIN");
  });
});
