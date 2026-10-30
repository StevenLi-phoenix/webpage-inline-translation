import { getSettings } from "../shared/settings";
import { providerOrigins, requestOrigins, translationOrigins } from "../shared/access";
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
  // Ask first and wait: the browser only prompts while it still sees the key press, and the
  // translation below would otherwise fail while the dialog is still open. A refusal still runs
  // the command so the page shows why it cannot translate.
  const settings = await getSettings();
  const origins = [...translationOrigins(settings), ...(command === "translate-input" ? providerOrigins(pickInputProvider(settings)) : [])];
  await requestOrigins(origins).catch(() => false);
  await ensureContent(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "EXECUTE_TRANSLATION_SHORTCUT", command } satisfies RuntimeRequest, { frameId: 0 });
}
