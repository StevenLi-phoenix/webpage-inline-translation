import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";

const ensureContent = vi.fn(async (_tabId: number) => undefined);
vi.mock("../src/background/inject", () => ({ ensureContent: (tabId: number) => ensureContent(tabId) }));

let onCommand: (command: string, tab?: { id?: number }) => void;
let order: string[];
let grant: (value: boolean) => void;

beforeEach(() => {
  vi.resetModules(); order = []; ensureContent.mockClear();
  vi.stubGlobal("chrome", {
    commands: { onCommand: { addListener: (listener: typeof onCommand) => { onCommand = listener; } } },
    storage: { local: { get: async () => ({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, activeProviderId: "google-web-translate" } }) } },
    permissions: {
      contains: async () => false,
      request: vi.fn(({ origins }: { origins: string[] }) => { order.push(`request:${origins.join()}`); return new Promise<boolean>(resolve => { grant = resolve; }); })
    },
    tabs: { sendMessage: vi.fn(async (_id: number, message: { command: string }) => { order.push(`send:${message.command}`); return { ok: true }; }) }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("browser shortcut commands", () => {
  it("waits for the access prompt before injecting and translating, and asks only for the translation service", async () => {
    const { initCommands } = await import("../src/background/commands");
    initCommands();
    onCommand("toggle-page-translation", { id: 5 });
    await vi.waitFor(() => expect(order).toEqual(["request:https://translate.googleapis.com/*"]));
    expect(ensureContent).not.toHaveBeenCalled();
    grant(true);
    await vi.waitFor(() => expect(order).toEqual(["request:https://translate.googleapis.com/*", "send:toggle-page-translation"]));
    expect(ensureContent).toHaveBeenCalledWith(5);
  });
  it("still runs after a refusal so the page can explain why it cannot translate", async () => {
    const { initCommands } = await import("../src/background/commands");
    initCommands();
    onCommand("translate-input", { id: 6 });
    await vi.waitFor(() => expect(order).toHaveLength(1));
    grant(false);
    await vi.waitFor(() => expect(order).toContain("send:translate-input"));
  });
  it("ignores unknown commands", async () => {
    const { initCommands } = await import("../src/background/commands");
    initCommands(); onCommand("something-else", { id: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(order).toEqual([]);
  });
});
