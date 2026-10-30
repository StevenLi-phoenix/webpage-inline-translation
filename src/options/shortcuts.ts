import { DEFAULT_SHORTCUTS, DEFAULT_SHORTCUT_ENABLED, normalizeShortcutEnabled, normalizeShortcuts, TRANSLATION_SHORTCUTS,
  type ShortcutEnabledSettings, type ShortcutSettings, type TranslationShortcut } from "../shared/shortcuts";
import { setupLocalShortcutSettings } from "./local-shortcuts";
import type { LocalShortcutSettings } from "../shared/local-shortcuts";

export function setupShortcutSettings(root: HTMLElement): {
  render: (value: unknown, enabled?: unknown, local?: unknown) => void;
  read: () => ShortcutSettings;
  readEnabled: () => ShortcutEnabledSettings;
  readLocal: () => LocalShortcutSettings;
} {
  const bindings = root.querySelector<HTMLElement>("#shortcutBindings")!;
  const status = root.querySelector<HTMLElement>("#shortcutStatus")!;
  const events = new AbortController();
  let values = { ...DEFAULT_SHORTCUTS };
  let enabled = { ...DEFAULT_SHORTCUT_ENABLED };
  let ready = false;
  let localControls: ReturnType<typeof setupLocalShortcutSettings> | undefined;
  const switches = new Map<keyof ShortcutEnabledSettings, { button: HTMLButtonElement; row: HTMLElement }>();

  function createSwitch(name: keyof ShortcutEnabledSettings, label: string, row: HTMLElement): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button"; button.className = "shortcut-switch";
    button.dataset.shortcutToggle = name;
    button.setAttribute("role", "switch"); button.setAttribute("aria-label", `${label}快捷键`);
    switches.set(name, { button, row });
    button.addEventListener("click", () => {
      if (!ready || (name in values ? !values[name as TranslationShortcut] : localControls?.isEmpty(name as import("../shared/shortcuts").LocalShortcut))) return;
      enabled[name] = !enabled[name];
      refresh();
      status.textContent = enabled[name] ? "快捷键已开启，点击「保存」后生效。" : "快捷键已关闭，保留原按键；点击「保存」后生效。";
    }, { signal: events.signal });
    return button;
  }

  function refresh(): void {
    localControls?.refresh(ready);
    for (const [name, { button, row }] of switches) {
      const empty = name in values ? !values[name as TranslationShortcut] : Boolean(localControls?.isEmpty(name as import("../shared/shortcuts").LocalShortcut));
      button.disabled = !ready || empty;
      button.setAttribute("aria-checked", String(enabled[name]));
      button.title = empty ? "请先设置快捷键，再启用" : enabled[name] ? "关闭快捷键，保留当前按键" : "开启快捷键";
      row.dataset.enabled = String(enabled[name]);
    }
  }

  void renderBrowserCommands(bindings, root.querySelector<HTMLButtonElement>("#openBrowserShortcuts"), events.signal);
  localControls = setupLocalShortcutSettings(root, {
    status, createSwitch, getGlobal: () => values, signal: events.signal,
    setEnabled: (name, value) => { enabled[name] = value; },
    changed: () => { refresh(); }
  });
  root.querySelector<HTMLButtonElement>("#resetShortcuts")!.addEventListener("click", () => {
    values = { ...DEFAULT_SHORTCUTS };
    enabled = { ...DEFAULT_SHORTCUT_ENABLED };
    localControls.reset();
    refresh(); status.textContent = "已恢复默认快捷键，点击底部「保存」后生效。";
  }, { signal: events.signal });
  window.addEventListener("pagehide", event => { if (!event.persisted) events.abort(); }, { signal: events.signal });
  refresh();
  return {
    render(value, activation, local) {
      values = normalizeShortcuts(value); ready = true;
      localControls!.render(local);
      enabled = normalizeShortcutEnabled(activation, values, localControls!.read());
        refresh(); status.textContent = "";
    },
    read: () => ({ ...values }),
    readEnabled: () => ({ ...enabled }),
    readLocal: () => localControls!.read()
  };
}

const BROWSER_SHORTCUTS_URL = "chrome://extensions/shortcuts";

/** Translation shortcuts are browser commands: list their live bindings and link to the browser's editor. */
async function renderBrowserCommands(list: HTMLElement, open: HTMLButtonElement | null, signal: AbortSignal): Promise<void> {
  const mac = /Mac/.test(navigator.platform);
  open?.addEventListener("click", () => { void chrome.tabs.create({ url: BROWSER_SHORTCUTS_URL }).catch(() => undefined); }, { signal });
  const commands = await chrome.commands?.getAll?.().catch(() => []) ?? [];
  list.replaceChildren(...TRANSLATION_SHORTCUTS.map(shortcut => {
    const row = document.createElement("div"); row.className = "shortcut-row";
    const title = document.createElement("dt"); title.textContent = shortcut.label;
    const value = document.createElement("dd"); value.className = "shortcut-editor";
    const binding = commands.find(command => command.name === shortcut.name)?.shortcut ?? "";
    const key = document.createElement("kbd"); key.className = "shortcut-browser-key";
    key.textContent = binding ? (mac ? binding.replace(/⌥/gu, "Option＋") : binding.replace(/\+/gu, "＋")) : "未设置";
    key.dataset.command = shortcut.name; key.dataset.bound = String(Boolean(binding));
    value.append(key); row.append(title, value);
    return row;
  }));
}
