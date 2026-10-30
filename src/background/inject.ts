import { hasOrigins, persistentSiteMatches, videoBridgeMatches } from "../shared/access";
import { getSettings } from "../shared/settings";

const FLAG = "__wupageContent";
const ACTIVE_TABS_KEY = "wupage.active-tabs";
const PERSISTENT_IDS = ["wupage-content", "wupage-frames", "wupage-video-bridge"];

const pending = new Map<number, Promise<void>>();

/**
 * Inject the content scripts into a tab the user just acted on (toolbar click, shortcut or
 * context menu). `activeTab` grants the access; nothing is injected anywhere else.
 */
export function ensureContent(tabId: number): Promise<void> {
  let current = pending.get(tabId);
  if (!current) {
    current = inject(tabId).finally(() => pending.delete(tabId));
    pending.set(tabId, current);
  }
  return current;
}

async function inject(tabId: number): Promise<void> {
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId }, func: (flag: string) => Boolean((globalThis as Record<string, unknown>)[flag]), args: [FLAG]
  });
  if (!probe?.result) await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  // Frames are optional: cross-origin frames the tab grant does not cover simply stay untranslated.
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["frame-bootstrap.js"] }).catch(() => undefined);
  await rememberTab(tabId, true);
}

async function rememberTab(tabId: number, active: boolean): Promise<void> {
  try {
    const stored = (await chrome.storage.session.get(ACTIVE_TABS_KEY))[ACTIVE_TABS_KEY] as number[] | undefined;
    const tabs = new Set(stored ?? []);
    if (active) tabs.add(tabId); else tabs.delete(tabId);
    await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: [...tabs] });
  } catch { /* session storage is a convenience only */ }
}

async function isRemembered(tabId: number): Promise<boolean> {
  try {
    const stored = (await chrome.storage.session.get(ACTIVE_TABS_KEY))[ACTIVE_TABS_KEY] as number[] | undefined;
    return stored?.includes(tabId) ?? false;
  } catch { return false; }
}

/** Keep tabs the user already activated usable after a full page load (access is lost across origins). */
export function initTabReinjection(): void {
  chrome.tabs?.onRemoved?.addListener(tabId => { void rememberTab(tabId, false); });
  chrome.webNavigation?.onCompleted?.addListener(details => {
    if (details.frameId !== 0) return;
    void isRemembered(details.tabId).then(known => known ? ensureContent(details.tabId) : undefined).catch(() => rememberTab(details.tabId, false));
  });
}

let syncing: Promise<void> = Promise.resolve();

/** Register always-on scripts only for sites the user explicitly granted (auto translation, video sites). */
export function syncPersistentScripts(): Promise<void> {
  syncing = syncing.then(registerPersistentScripts).catch(error => console.warn("WuPage persistent scripts:", error));
  return syncing;
}

async function grantedOnly(matches: string[]): Promise<string[]> {
  const granted: string[] = [];
  for (const match of matches) if (await hasOrigins([match])) granted.push(match);
  return granted;
}

async function registerPersistentScripts(): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return;
  const settings = await getSettings();
  const wanted = await grantedOnly(persistentSiteMatches(settings));
  const bridge = videoBridgeMatches().filter(match => wanted.includes(match));
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: PERSISTENT_IDS });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(script => script.id) });
  const scripts: chrome.scripting.RegisteredContentScript[] = [];
  if (wanted.length) {
    scripts.push({ id: "wupage-content", js: ["content.js"], matches: wanted, runAt: "document_idle", persistAcrossSessions: true });
    scripts.push({ id: "wupage-frames", js: ["frame-bootstrap.js"], matches: wanted, allFrames: true,
      matchOriginAsFallback: true, runAt: "document_start", persistAcrossSessions: true });
  }
  if (bridge.length) {
    scripts.push({ id: "wupage-video-bridge", js: ["video-page-bridge.js"], matches: bridge, allFrames: true, world: "MAIN",
      runAt: "document_start", persistAcrossSessions: true });
  }
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

export function initPersistentScripts(): void {
  void syncPersistentScripts();
  chrome.runtime.onInstalled?.addListener(() => { void syncPersistentScripts(); });
  chrome.permissions?.onAdded?.addListener(() => { void syncPersistentScripts(); });
  chrome.permissions?.onRemoved?.addListener(() => { void syncPersistentScripts(); });
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes["wupage.settings"]) void syncPersistentScripts();
  });
}
