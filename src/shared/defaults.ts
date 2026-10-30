import type { ExtensionSettings } from "./types";
import { DEFAULT_SELECTION_TRANSLATION } from "./dictionary";
import { DEFAULT_APPEARANCE } from "./appearance";
import { DEFAULT_SHORTCUTS, DEFAULT_SHORTCUT_ENABLED } from "./shortcuts";
import { DEFAULT_LOCAL_SHORTCUTS } from "./local-shortcuts";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcuts: { ...DEFAULT_SHORTCUTS },
  localShortcuts: { ...DEFAULT_LOCAL_SHORTCUTS },
  shortcutEnabled: { ...DEFAULT_SHORTCUT_ENABLED },
  appearance: { ...DEFAULT_APPEARANCE, customSchemes: [] },
  selectionTranslation: { ...DEFAULT_SELECTION_TRANSLATION },
  autoTranslation: { enabled: false, nonTargetLanguage: false, presetSites: [], customSites: [] },
  frameTranslation: { enabled: true, excludeMatches: [] },
  targetLang: "zh-CN",
  sourceLang: "auto",
  activeProviderId: "google-web-translate",
  chunkSize: 1200,
  concurrency: 3,
  pdfTranslationPageRadius: 5,
  cacheEnabled: true,
  contextMenuTranslationEnabled: false,
  imageTranslationEnabled: false,
  translateCodeComments: true,
  translationDisplayMode: "bilingual",
  providers: [
    {
      type: "google-web-translate",
      id: "google-web-translate",
      label: "Google 翻译",
      enabled: true
    },
    {
      type: "openai-compatible",
      id: "openai-compatible",
      label: "OpenAI 兼容",
      enabled: true,
      performanceMode: "custom",
      chunkSize: 3200,
      concurrency: 3,
      baseURL: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      systemPrompt:
        "You are a translation engine. Translate each input item into {{targetLang}}. Preserve meaning, numbers, links, code-like tokens, placeholders like ⟪WUPAGE0⟫, and formatting. Return only a JSON array of strings in the same order."
    },
    {
      type: "anthropic-compatible",
      id: "anthropic-compatible",
      label: "Anthropic 兼容",
      enabled: true,
      performanceMode: "custom",
      chunkSize: 3200,
      concurrency: 3,
      baseURL: "https://api.anthropic.com",
      apiKey: "",
      model: "claude-haiku-5-5",
      systemPrompt:
        "You are a translation engine. Translate each input item into {{targetLang}}. Preserve meaning, numbers, links, code-like tokens, placeholders like ⟪WUPAGE0⟫, and formatting. Return only a JSON array of strings in the same order."
    },
    {
      type: "firefox-local",
      id: "firefox-local",
      label: "Firefox 本地翻译（实验）",
      enabled: true,
      performanceMode: "custom",
      chunkSize: 800,
      concurrency: 1
    }
  ]
};

export const SETTINGS_KEY = "wupage.settings";
export const CACHE_PREFIX = "wupage.cache.";
export const BUILT_IN_PROVIDER_IDS = new Set(
  DEFAULT_SETTINGS.providers.map((provider) => provider.id)
);
