// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupShortcutSettings } from "../src/options/shortcuts";
import { DEFAULT_SHORTCUTS, DEFAULT_SHORTCUT_ENABLED, TRANSLATION_SHORTCUTS } from "../src/shared/shortcuts";

let root: HTMLElement;
let controls: ReturnType<typeof setupShortcutSettings>;
beforeEach(() => {
  const html = new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), "options.html"), "utf8"), "text/html");
  document.body.replaceChildren(html.querySelector("#shortcutSettings")!);
  root = document.querySelector("#shortcutSettings")!; root.hidden = false;
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks(); document.body.replaceChildren();
});
function mount(value: unknown = DEFAULT_SHORTCUTS): void { controls = setupShortcutSettings(root); controls.render(value); }
function press(key: string, code = key, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...modifiers });
  document.activeElement!.dispatchEvent(event); return event;
}
const altShift = { altKey: true, shiftKey: true };
const stubCommands = (shortcuts: Record<string, string>) => vi.stubGlobal("chrome", {
  commands: { getAll: async () => TRANSLATION_SHORTCUTS.map(({ name }) => ({ name, shortcut: shortcuts[name] ?? "" })) },
  tabs: { create: vi.fn(async () => ({})) }
});

describe("shortcut settings", () => {
  it("lists the browser's live bindings for every translation command, including the input translator", async () => {
    stubCommands({ "toggle-page-translation": "Alt+Shift+Y", "translate-input": "Alt+A" });
    mount();
    await vi.waitFor(() => expect(root.querySelectorAll("#shortcutBindings .shortcut-row")).toHaveLength(TRANSLATION_SHORTCUTS.length));
    const key = (name: string) => root.querySelector<HTMLElement>(`kbd[data-command='${name}']`)!;
    expect(key("translate-input").textContent).toBe("Alt＋A");
    expect(key("translate-input").dataset.bound).toBe("true");
    expect(key("cycle-display-mode").textContent).toBe("未设置");
    expect(key("cycle-display-mode").dataset.bound).toBe("false");
  });
  it("opens the browser's shortcut manager instead of recording keys in the page", async () => {
    stubCommands({});
    mount();
    root.querySelector<HTMLButtonElement>("#openBrowserShortcuts")!.click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
    expect(root.querySelectorAll("#shortcutBindings input")).toHaveLength(0);
  });
  it("keeps only the local operations switchable and restores their defaults", () => {
    stubCommands({});
    mount(); expect(root.querySelectorAll("[role='switch']")).toHaveLength(3);
    root.querySelector<HTMLButtonElement>("[data-shortcut-toggle='selection-submit']")!.click();
    expect(controls.readEnabled()["selection-submit"]).toBe(false);
    root.querySelector<HTMLButtonElement>("#resetShortcuts")!.click();
    expect(controls.readEnabled()).toEqual(DEFAULT_SHORTCUT_ENABLED);
  });
  it("displays platform modifiers on macOS", () => {
    stubCommands({});
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    mount();
    expect(root.querySelector<HTMLInputElement>('[data-local-command="selection-submit"]')?.value).toBe("Command＋Enter");
  });
  it("edits paragraph modifiers and scoped bindings, validates conflicts, clears and restores defaults", () => {
    mount();
    const modifier = root.querySelector<HTMLSelectElement>('[data-local-command="paragraph-click"]')!;
    modifier.value = "Alt+Shift"; modifier.dispatchEvent(new Event("change"));
    expect(controls.readLocal()["paragraph-click"]).toBe("Alt+Shift");
    const submit = root.querySelector<HTMLInputElement>('[data-local-command="selection-submit"]')!;
    submit.focus(); press("Enter", "Enter", { altKey: true });
    expect(controls.readLocal()["selection-submit"]).toBe("Alt+Enter");
    submit.focus(); press("Y", "KeyY", altShift);
    expect(submit.getAttribute("aria-invalid")).toBe("true"); press("Escape");
    expect(controls.readLocal()["selection-submit"]).toBe("Alt+Enter");
    submit.focus(); press("Delete");
    expect(controls.readEnabled()["selection-submit"]).toBe(false);
    root.querySelector<HTMLButtonElement>('[aria-label="恢复提交划词原文默认快捷键"]')!.click();
    expect(controls.readLocal()["selection-submit"]).toBe("Primary+Enter");
    expect(controls.readEnabled()["selection-submit"]).toBe(true);
    const dismiss = root.querySelector<HTMLInputElement>('[data-local-command="dismiss-overlays"]')!;
    dismiss.focus(); press("Enter", "Enter", { altKey: true });
    dismiss.focus(); root.querySelector<HTMLButtonElement>('[data-local-escape="dismiss-overlays"]')!.click();
    expect(controls.readLocal()["dismiss-overlays"]).toBe("Escape");
    root.querySelector<HTMLButtonElement>("#resetShortcuts")!.click();
    expect(controls.readLocal()["paragraph-click"]).toBe("Ctrl");
  });
});
