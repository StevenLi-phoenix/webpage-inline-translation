import type { DictionaryProvider, SelectionTranslationSettings } from "./dictionary";
import type { AppearanceSettings } from "./appearance";
import type { VideoTranslationSettings } from "./video";
import type { ShortcutEnabledSettings, ShortcutSettings, TranslationShortcut } from "./shortcuts";

export type ProviderType =
  | "google-web-translate"
  | "openai-compatible"
  | "anthropic-compatible"
  | "firefox-local";

export type TranslationDisplayMode = "replace" | "bilingual" | "bilingual-accent";

export interface ProviderBaseConfig {
  id: string;
  label: string;
  enabled?: boolean;
  performanceMode?: "inherit" | "custom";
  chunkSize?: number;
  concurrency?: number;
}

export interface GoogleWebTranslateConfig extends ProviderBaseConfig {
  type: "google-web-translate";
}

export interface FirefoxLocalConfig extends ProviderBaseConfig {
  type: "firefox-local";
}

export interface OpenAICompatibleConfig extends ProviderBaseConfig {
  type: "openai-compatible";
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export interface AnthropicCompatibleConfig extends ProviderBaseConfig {
  type: "anthropic-compatible";
  baseURL: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export type LlmProviderConfig = OpenAICompatibleConfig | AnthropicCompatibleConfig;

export type ProviderConfig =
  | GoogleWebTranslateConfig
  | FirefoxLocalConfig
  | OpenAICompatibleConfig
  | AnthropicCompatibleConfig;

export interface ExtensionSettings {
  frameTranslation?: import("./frame-session").FrameTranslationSettings;
  videoTranslation?: VideoTranslationSettings;
  shortcuts?: ShortcutSettings;
  localShortcuts?: import("./local-shortcuts").LocalShortcutSettings;
  shortcutEnabled?: ShortcutEnabledSettings;
  appearance?: AppearanceSettings;
  selectionTranslation?: SelectionTranslationSettings;
  autoTranslation?: AutoTranslationSettings;
  targetLang: string;
  sourceLang: string;
  activeProviderId: string;
  chunkSize: number;
  concurrency: number;
  /** Pages to translate on each side of the reading page; null means the whole PDF. */
  pdfTranslationPageRadius: number | null;
  cacheEnabled: boolean;
  contextMenuTranslationEnabled?: boolean;
  imageTranslationEnabled?: boolean;
  /** Language the input-field translator writes in (the other direction uses `targetLang`). */
  inputTargetLang?: string;
  translateCodeComments: boolean;
  translationDisplayMode: TranslationDisplayMode;
  providers: ProviderConfig[];
}

export interface AutoTranslationSite {
  id: string;
  pattern: string;
  enabled: boolean;
}

export interface AutoTranslationSettings {
  enabled: boolean;
  nonTargetLanguage: boolean;
  presetSites: string[];
  customSites: AutoTranslationSite[];
  removedPresetSites?: string[];
  excludedSites?: string[];
}

export interface TranslateBatchRequest {
  pageSession?: { id: string; documentKey: string };
  texts: string[];
  /** Verify protected PDF formula markers before caching a translation. */
  preservePlaceholders?: boolean;
  context?: string;
  sourceLang?: string;
  targetLang: string;
  providerId?: string;
}

export interface TranslateBatchResponse {
  translations: string[];
  cached: number;
}

export interface ImageTextRegion {
  box: [number, number, number, number]; // x, y, width, height, normalized to 0–1000
  text: string;
  translation: string;
  foreground: string;
  background: string;
  align: "left" | "center" | "right";
  bold: boolean;
  sampleColors?: boolean;
}

export interface TranslateImageRequest {
  dataUrl: string;
  width: number;
  height: number;
  sourceText?: string;
}

export interface TranslateImageResponse {
  regions: ImageTextRegion[];
  targetLang: string;
  cached: boolean;
  warning?: string;
  skippedRegions?: number;
}

export type TranslationDebugTaskStatus = "queued" | "waiting" | "running" | "succeeded" | "failed";

export interface TranslationDebugTask {
  id: number;
  providerId: string;
  providerLabel: string;
  status: TranslationDebugTaskStatus;
  textCount: number;
  charCount: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  waitUntil?: number;
  sourceLang?: string;
  targetLang?: string;
  chunkSize?: number;
  concurrency?: number;
  performanceMode?: "inherit" | "custom";
  sourceTexts?: string[];
  translatedTexts?: string[];
  error?: string;
}

export interface TranslationDebugSnapshot {
  frames?: import("./frame-session").FrameDiagnostic[];
  tasks: TranslationDebugTask[];
  activeCount: number;
  queuedCount: number;
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export interface TranslatorProvider {
  id: string;
  label: string;
  translateBatch(request: TranslateBatchRequest, signal?: AbortSignal): Promise<string[]>;
  validateConfig(): ValidationResult;
}

export type RuntimeRequest =
  | import("./frame-session").FrameSessionRequest
  | { type: "EXECUTE_TRANSLATION_SHORTCUT"; command: TranslationShortcut }
  | { type: "LOOKUP_DICTIONARY"; query: string; provider: DictionaryProvider }
  | { type: "PLAY_DICTIONARY_AUDIO"; provider: DictionaryProvider; url: string }
  | { type: "STOP_DICTIONARY_AUDIO" }
  | { type: "GET_LOCAL_MODEL_STATUS" }
  | { type: "INSTALL_LOCAL_MODEL"; modelId: string }
  | { type: "CANCEL_LOCAL_MODEL_DOWNLOAD" }
  | { type: "REMOVE_LOCAL_MODEL"; modelId: string }
  | { type: "GET_OCR_STATUS" }
  | { type: "INSTALL_OCR" }
  | { type: "REMOVE_OCR" }
  | { type: "ENSURE_CONTENT"; tabId: number }
  | { type: "TRANSLATE_INPUT"; text: string }
  | { type: "TRANSLATE_PAGE" }
  | { type: "OPEN_VIDEO_SUBTITLES"; tabId?: number }
  | { type: "VIDEO_FRAME_STATUS"; videos: number; area: number; playing: boolean }
  | ({ type: "TRANSLATE_VIDEO_SUBTITLES"; sessionId: string; requestId: string } & TranslateBatchRequest)
  | { type: "CANCEL_VIDEO_SUBTITLES"; sessionId: string; requestId?: string }
  | { type: "CLEAR_TRANSLATION" }
  | { type: "GET_TRANSLATION_STATE" }
  | { type: "PAGE_TRANSLATION_STATE_CHANGED" }
  | { type: "GET_PARAGRAPH_MODE" }
  | { type: "SET_PARAGRAPH_MODE"; enabled: boolean }
  | { type: "CLEAR_CACHE" }
  | { type: "LOAD_IMAGE"; url: string }
  | { type: "TRANSLATE_CONTEXT_IMAGE"; srcUrl: string }
  | ({ type: "TRANSLATE_IMAGE" } & TranslateImageRequest)
  | ({ type: "TRANSLATE_BATCH" } & TranslateBatchRequest)
  | { type: "GET_SETTINGS" }
  | { type: "OPEN_OPTIONS_PAGE" }
  | { type: "OPEN_EMBEDDED_PDF"; url: string }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "TEST_PROVIDER"; providerId?: string };

export type RuntimeResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; errorCode?: string; retryAfterMs?: number };
