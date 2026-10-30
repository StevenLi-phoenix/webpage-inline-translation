import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import { getSettings } from "../src/shared/settings";
import type { ExtensionSettings, RuntimeResponse } from "../src/shared/types";
import { handlePageMenuClick, initPageContextMenu, PAGE_MENU_ID, refreshPageContextMenu } from "../src/background/page-context-menu";

vi.mock("../src/background/inject", () => ({ ensureContent: vi.fn(async () => undefined) }));

vi.mock("../src/shared/settings", () => ({ getSettings: vi.fn() }));
let changed: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let activated: () => void;
let updated: (id: number, change: { status?: string; url?: string }, tab: chrome.tabs.Tab) => void;
let focused: () => void;
let stored: ExtensionSettings;
let translated: boolean;
let activeTab: number;
const info = { menuItemId: PAGE_MENU_ID, frameId: 3, editable: false };
const tab = { id: 42, active: true } as chrome.tabs.Tab;
const title = () => vi.mocked(chrome.contextMenus.update).mock.calls.at(-1)?.[1].title;

beforeEach(() => {
  stored = { ...structuredClone(DEFAULT_SETTINGS), contextMenuTranslationEnabled: true };
  translated = false; activeTab = 42;
  vi.mocked(getSettings).mockImplementation(async () => stored);
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: { onChanged: { addListener: (listener: typeof changed) => { changed = listener; } } },
    windows: { onFocusChanged: { addListener: (listener: typeof focused) => { focused = listener; } } },
    tabs: {
      query: vi.fn(async () => [{ id: activeTab }]), create: vi.fn(),
      sendMessage: vi.fn(async (_id, request) => request.type === "GET_TRANSLATION_STATE"
        ? { ok: true, data: { translated } } : { ok: true, data: { handled: true } }),
      onActivated: { addListener: (listener: typeof activated) => { activated = listener; } },
      onUpdated: { addListener: (listener: typeof updated) => { updated = listener; } }
    },
    contextMenus: {
      remove: vi.fn((_id, callback) => callback?.()),
      update: vi.fn((_id, _properties, callback) => callback?.()),
      create: vi.fn((_properties, callback) => queueMicrotask(() => callback?.())), onClicked: { addListener: vi.fn() }
    }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function initialize(): Promise<void> {
  initPageContextMenu();
  await vi.waitFor(() => expect(chrome.contextMenus.update).toHaveBeenCalledTimes(2));
}

describe("single page context menu", () => {
  it("removes both old items and registers one root entry without overlapping image contexts", async () => {
    await initialize();
    expect(chrome.contextMenus.remove).toHaveBeenCalledWith("wupage-translate-paragraph", expect.any(Function));
    expect(chrome.contextMenus.remove).toHaveBeenCalledWith("wupage-restore-paragraph", expect.any(Function));
    expect(chrome.contextMenus.create).not.toHaveBeenCalled();
    for (const [id, properties] of vi.mocked(chrome.contextMenus.update).mock.calls) {
      expect(id).toBe(PAGE_MENU_ID);
      expect(properties).toEqual({ title: "全文翻译", contexts: ["page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"], visible: true });
    }
    stored.contextMenuTranslationEnabled = false;
    changed({ [SETTINGS_KEY]: { newValue: stored } }, "local");
    await vi.waitFor(() => expect(chrome.contextMenus.update).toHaveBeenLastCalledWith(PAGE_MENU_ID,
      expect.objectContaining({ visible: false }), expect.any(Function)));
  });

  it("creates a missing entry after consuming the old-menu removal errors", async () => {
    vi.mocked(chrome.contextMenus.remove).mockImplementation((_id, callback) => {
      Object.assign(chrome.runtime, { lastError: { message: "missing" } }); callback?.();
      Reflect.deleteProperty(chrome.runtime, "lastError");
      return undefined as never;
    });
    vi.mocked(chrome.contextMenus.update).mockImplementationOnce((_id, _properties, callback) => {
      Object.assign(chrome.runtime, { lastError: { message: "missing" } }); callback?.();
      Reflect.deleteProperty(chrome.runtime, "lastError");
      return undefined as never;
    });
    await initialize();
    expect(chrome.contextMenus.create).toHaveBeenCalledOnce();
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({ id: PAGE_MENU_ID, title: "全文翻译" }), expect.any(Function));
  });

  it("tracks page state, tab changes, window focus and navigation", async () => {
    translated = true;
    await initialize();
    expect(title()).toBe("恢复原文");
    translated = false; activeTab = 43; activated();
    await vi.waitFor(() => expect(title()).toBe("全文翻译"));
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(43, { type: "GET_TRANSLATION_STATE" }, { frameId: 0 });
    translated = true; focused();
    await vi.waitFor(() => expect(title()).toBe("恢复原文"));
    translated = false; updated(43, { status: "complete" }, { ...tab, id: 43 });
    await vi.waitFor(() => expect(title()).toBe("全文翻译"));
  });

  it("refreshes only from top-frame content reports and reads the current active tab", async () => {
    await initialize();
    vi.mocked(chrome.tabs.query).mockClear();
    await refreshPageContextMenu({ tab, frameId: 3 });
    await refreshPageContextMenu({ frameId: 0 });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    translated = true; activeTab = 43;
    await refreshPageContextMenu({ tab, frameId: 0 });
    expect(title()).toBe("恢复原文");
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(43, { type: "GET_TRANSLATION_STATE" }, { frameId: 0 });
  });

  it("ignores a late state response from the previously active tab", async () => {
    await initialize();
    let finish!: (response: RuntimeResponse) => void;
    vi.mocked(chrome.tabs.sendMessage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    activated();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    activeTab = 43; translated = true; activated();
    await vi.waitFor(() => expect(title()).toBe("恢复原文"));
    finish({ ok: true, data: { translated: false } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(title()).toBe("恢复原文");
  });

  it("falls back to translation after navigation to a page without a listener", async () => {
    translated = true; await initialize();
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error("No receiver"));
    updated(42, { status: "loading" }, tab);
    await vi.waitFor(() => expect(title()).toBe("全文翻译"));
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("dispatches a live page toggle to the top frame for either displayed state", async () => {
    for (const state of [false, true]) {
      translated = state;
      await handlePageMenuClick(info, tab);
      expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42,
        { type: "EXECUTE_TRANSLATION_SHORTCUT", command: "toggle-page-translation" }, { frameId: 0 });
    }
  });

  it("ignores disabled, unrelated and missing-tab actions", async () => {
    await handlePageMenuClick({ ...info, menuItemId: "other" }, tab);
    await handlePageMenuClick(info);
    expect(getSettings).not.toHaveBeenCalled();
    stored.contextMenuTranslationEnabled = false;
    await handlePageMenuClick(info, tab);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it.each([undefined, { ok: false, error: "No receiver" }, { ok: true }])("guides a stale page to refresh (%j)", async response => {
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValueOnce(response as never);
    await handlePageMenuClick(info, tab);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://test/options.html?pageTranslationNotice=refresh" });
  });
});
