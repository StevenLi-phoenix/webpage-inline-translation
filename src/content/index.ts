import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../shared/types";
import { hasPageTranslations, refreshTranslationColors } from "./dom";
import { initParagraphMode, setParagraphMode } from "./paragraph-mode";
import { refreshTranslationState } from "./page-context";
import { addRuntimeMessageListener, sendRuntimeRequest } from "./runtime";
import {
  getPageTranslationState,
  hidePageTranslation,
  loadPageTranslationSettings,
  startPageTranslation,
  subscribePageTranslationState,
  updatePageTranslationSettings
} from "./page-translation";
import { injectContentStyles } from "./styles";
import { initImageTranslation, translateContextImage } from "./image-translation";
import { SETTINGS_KEY } from "../shared/defaults";
import { initAutoTranslation } from "./auto-translation";
import { initSelectionTranslation } from "./selection-translation";
import { setupAppearance } from "../shared/appearance-runtime";
import { executeTranslationShortcut } from "./shortcuts";
import { initKeyboardShortcuts } from "./keyboard-shortcuts";
import { installFrameRuntime } from "./frame-runtime";
import { createDocumentKey } from "../shared/frame-session";
import { initVideoSubtitles, openVideoSubtitles } from "./video-subtitles";
import { readParagraphMode } from "../shared/paragraph-mode";



let pageActionVersion = 0;

addRuntimeMessageListener((request: RuntimeRequest, _sender, sendResponse) => {
  if (request.type.startsWith("FRAME_")) return;
  handleMessage(request)
    .then((data): RuntimeResponse => ({ ok: true, data }))
    .catch((error: unknown): RuntimeResponse => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
    .then(sendResponse);

  return true;
});

injectContentStyles();
if (chrome.runtime?.id && typeof chrome.runtime.onMessage?.addListener === "function") installFrameRuntime(createDocumentKey(), { top: true });
const appearance = setupAppearance(undefined, { extensionPage: false, onChange: scheme => {
  refreshTranslationColors({ light: scheme.colors["translation-light"], dark: scheme.colors["translation-dark"] });
} });
// Ignore an older initial read if the user saves a newer appearance while it is pending.
let appearanceRevision = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) appearanceRevision++;
});
void sendRuntimeRequest<ExtensionSettings>({ type: "GET_SETTINGS" }).then(settings => {
  if (!appearanceRevision) appearance.update(settings.appearance);
}).catch(() => undefined);
initParagraphMode();
subscribePageTranslationState(refreshTranslationState);
initImageTranslation();
initAutoTranslation();
initSelectionTranslation();
initKeyboardShortcuts(executeTranslationShortcut);
initVideoSubtitles();

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (area !== "local" || !change) return;
  const settings = change.newValue as ExtensionSettings | undefined;
  if (settings) updatePageTranslationSettings(settings);
});

async function handleMessage(request: RuntimeRequest): Promise<unknown> {
  if (request.type === "OPEN_VIDEO_SUBTITLES") {
    return openVideoSubtitles();
  }
  if (request.type === "EXECUTE_TRANSLATION_SHORTCUT") {
    await executeTranslationShortcut(request.command);
    return { handled: true };
  }
  if (request.type === "TRANSLATE_CONTEXT_IMAGE") {
    return translateContextImage(request.srcUrl);
  }
  if (request.type === "CLEAR_TRANSLATION") {
    pageActionVersion += 1;
    hidePageTranslation();
    return { cleared: true };
  }

  if (request.type === "GET_TRANSLATION_STATE") {
    return { translated: getPageTranslationState().active || hasPageTranslations() };
  }

  if (request.type === "GET_PARAGRAPH_MODE") {
    return { enabled: await readParagraphMode() };
  }

  if (request.type === "SET_PARAGRAPH_MODE") {
    await setParagraphMode(request.enabled);
    return { enabled: await readParagraphMode() };
  }

  if (request.type !== "TRANSLATE_PAGE") {
    return null;
  }

  const actionVersion = ++pageActionVersion;
  const settings = await loadPageTranslationSettings();
  if (actionVersion !== pageActionVersion) return getPageTranslationState();
  return startPageTranslation(settings);
}
