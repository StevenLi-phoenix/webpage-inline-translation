// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { canonicalLocalShortcut, DEFAULT_LOCAL_SHORTCUTS, formatLocalShortcut, localShortcutFromEvent,
  matchesLocalShortcut, matchesParagraphClick, normalizeLocalShortcuts } from "../src/shared/local-shortcuts";
import { normalizeSettings } from "../src/shared/settings";

describe("custom local shortcuts", () => {
  it("migrates old settings, retains cleared keys and keeps independent defaults", () => {
    const settings = normalizeSettings({ localShortcuts: { "selection-submit": "" } });
    expect(settings.localShortcuts?.["paragraph-click"]).toBe("Ctrl");
    expect(settings.shortcutEnabled?.["selection-submit"]).toBe(false);
    settings.localShortcuts!["paragraph-click"] = "Alt";
    expect(normalizeLocalShortcuts(undefined)).toEqual(DEFAULT_LOCAL_SHORTCUTS);
  });
  it("accepts local navigation keys and exact modifier chords without widening page shortcut syntax", () => {
    expect(canonicalLocalShortcut("Escape")).toBe("Escape");
    expect(canonicalLocalShortcut("Shift+Alt+Enter")).toBe("Alt+Shift+Enter");
    expect(canonicalLocalShortcut("Enter|Space|Enter")).toBe("Enter|Space");
    expect(canonicalLocalShortcut("Shift+Meta", true)).toBe("Shift+Meta");
    for (const value of ["A", "Shift+A", "Ctrl+Ctrl+Enter", "Primary+Meta+Enter", "Enter|", "Ctrl+Click"]) expect(canonicalLocalShortcut(value)).toBeUndefined();
    expect(canonicalLocalShortcut("", true)).toBe("");
    expect(canonicalLocalShortcut("", false)).toBe("");
  });
  it("preserves Ctrl and Command submission defaults and matches configured modifiers exactly", () => {
    expect(matchesLocalShortcut(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }), "Primary+Enter")).toBe(true);
    expect(matchesLocalShortcut(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }), "Primary+Enter")).toBe(true);
    expect(matchesLocalShortcut(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, altKey: true }), "Alt+Primary+Enter")).toBe(true);
    expect(matchesLocalShortcut(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: true }), "Ctrl+Enter")).toBe(false);
    expect(matchesLocalShortcut(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }), "Enter")).toBe(false);
    expect(localShortcutFromEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyQ", altKey: true }))).toBe("Alt+Q");
  });
  it("matches only the configured primary mouse modifier chord", () => {
    expect(matchesParagraphClick(new MouseEvent("click", { altKey: true, shiftKey: true }), "Alt+Shift")).toBe(true);
    for (const event of [new MouseEvent("click", { ctrlKey: true }), new MouseEvent("click", { altKey: true, shiftKey: true, ctrlKey: true }), new MouseEvent("click", { altKey: true, shiftKey: true, button: 2 })]) expect(matchesParagraphClick(event, "Alt+Shift")).toBe(false);
  });
  it("formats local bindings for the current platform", () => {
    expect(formatLocalShortcut("Primary+Enter", true)).toBe("Command＋Enter");
    expect(formatLocalShortcut("Primary+Enter", false)).toBe("Ctrl＋Enter");
    expect(formatLocalShortcut("Enter|Space")).toBe("Enter / 空格");
  });
});
