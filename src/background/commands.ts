import { getSettings } from "../shared/settings";
import { providerOrigins, requestOrigins, requiredOrigins } from "../shared/access";
import { isTranslationShortcut } from "../shared/shortcuts";
import type { RuntimeRequest } from "../shared/types";
import { ensureContent } from "./inject";
import { pickInputProvider } from "./input-translation";

/**
 * Keyboard shortcuts are browser commands: pressing one grants `activeTab` for that page,
 * so the content scripts can be injected without any standing site access.
 */
export function initCommands(): void {
  chrome.commands?.onCommand.addListener((command, tab) => {
    void runCommand(command, tab).catch(error => console.warn("WuPage command:", error));
  });
}

async function runCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  if (!isTranslationShortcut(command)) return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (tabId === undefined) return;
  // Best effort: the browser only shows its prompt while it still sees the key press.
  const settings = await getSettings();
  const origins = command === "translate-input" ? providerOrigins(pickInputProvider(settings)) : requiredOrigins(settings);
  void requestOrigins(origins).catch(() => false);
  await ensureContent(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "EXECUTE_TRANSLATION_SHORTCUT", command } satisfies RuntimeRequest, { frameId: 0 });
}
