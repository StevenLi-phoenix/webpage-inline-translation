import { DEFAULT_SETTINGS, SETTINGS_KEY } from "./defaults";
import { isLlmProvider } from "./performance";
import { normalizeAutoTranslation } from "./auto-translation";
import { normalizeSelectionTranslation } from "./dictionary";
import { normalizeAppearance } from "./appearance";
import { normalizeShortcutEnabled, normalizeShortcuts } from "./shortcuts";
import { normalizeLocalShortcuts } from "./local-shortcuts";
import { normalizeVideoTranslation } from "./video";
import type { ExtensionSettings, ProviderConfig } from "./types";
import { normalizeFrameTranslation } from "./frame-session";

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export function normalizeSettings(value: unknown): ExtensionSettings {
  const input = isRecord(value) ? value : {};
  const chunkSize = clampNumber(input.chunkSize, 200, 4000, DEFAULT_SETTINGS.chunkSize);
  const concurrency = clampNumber(input.concurrency, 1, 8, DEFAULT_SETTINGS.concurrency);
  const storedProviders = Array.isArray(input.providers)
    ? input.providers.map(migrateLegacyProvider).filter(isProviderConfig)
    : [];
  const requestedProviderId = readString(input.activeProviderId, DEFAULT_SETTINGS.activeProviderId);
  const providers = mergeProviders(storedProviders, chunkSize, concurrency);
  ensureEnabledProvider(providers);
  const isUsable = (provider: ProviderConfig): boolean => provider.enabled !== false;
  const activeProviderId =
    providers.find((provider) => provider.id === requestedProviderId && isUsable(provider))?.id
    ?? providers.find((provider) => provider.id === DEFAULT_SETTINGS.activeProviderId && isUsable(provider))?.id
    ?? providers.find(isUsable)?.id
    ?? DEFAULT_SETTINGS.activeProviderId;

  return {
    ...DEFAULT_SETTINGS,
    ...input,
    ...(input.videoTranslation !== undefined ? { videoTranslation: normalizeVideoTranslation(input.videoTranslation) } : {}),
    providers,
    shortcuts: normalizeShortcuts(input.shortcuts),
    localShortcuts: normalizeLocalShortcuts(input.localShortcuts),
    shortcutEnabled: normalizeShortcutEnabled(input.shortcutEnabled, input.shortcuts, input.localShortcuts),
    appearance: normalizeAppearance(input.appearance),
    autoTranslation: normalizeAutoTranslation(input.autoTranslation),
    frameTranslation: normalizeFrameTranslation(input.frameTranslation),
    selectionTranslation: normalizeSelectionTranslation(input.selectionTranslation),
    targetLang: readString(input.targetLang, DEFAULT_SETTINGS.targetLang),
    sourceLang: readString(input.sourceLang, DEFAULT_SETTINGS.sourceLang),
    activeProviderId,
    chunkSize,
    concurrency,
    pdfTranslationPageRadius: input.pdfTranslationPageRadius === null
      ? null
      : clampNumber(input.pdfTranslationPageRadius, 0, 1000, DEFAULT_SETTINGS.pdfTranslationPageRadius!),
    cacheEnabled:
      typeof input.cacheEnabled === "boolean"
        ? input.cacheEnabled
        : DEFAULT_SETTINGS.cacheEnabled,
    translateCodeComments:
      typeof input.translateCodeComments === "boolean"
        ? input.translateCodeComments
        : DEFAULT_SETTINGS.translateCodeComments,
    imageTranslationEnabled: input.imageTranslationEnabled === true,
    contextMenuTranslationEnabled: input.contextMenuTranslationEnabled === true,
    translationDisplayMode: isTranslationDisplayMode(input.translationDisplayMode)
      ? input.translationDisplayMode
      : DEFAULT_SETTINGS.translationDisplayMode
  };
}

/**
 * Settings saved by older versions may hold provider types and fields that no longer exist.
 * DeepSeek and Zhipu GLM speak the OpenAI protocol, so a configured entry (one with an
 * API key) becomes an openai-compatible provider; every other removed type is dropped by
 * the type check in isProviderConfig.
 */
function migrateLegacyProvider(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { requestTemplate: _template, ollamaCompatibility: _ollama, customModels: _models, ...rest } = value;
  if (rest.type !== "deepseek" && rest.type !== "zhipu-glm") return rest;
  if (typeof rest.apiKey !== "string" || !rest.apiKey.trim()) return undefined;
  return { ...rest, type: "openai-compatible" };
}

function isTranslationDisplayMode(value: unknown): value is ExtensionSettings["translationDisplayMode"] {
  return value === "replace" || value === "bilingual" || value === "bilingual-accent";
}

function mergeProviders(
  storedProviders: ProviderConfig[],
  globalChunkSize: number,
  globalConcurrency: number
): ProviderConfig[] {
  const byId = new Map(
    DEFAULT_SETTINGS.providers.map((provider) => [
      provider.id,
      normalizeProvider(provider, globalChunkSize, globalConcurrency)
    ])
  );
  for (const provider of storedProviders) {
    byId.set(provider.id, normalizeProvider(provider, globalChunkSize, globalConcurrency));
  }
  return Array.from(byId.values());
}

function normalizeProvider(
  provider: ProviderConfig,
  globalChunkSize: number,
  globalConcurrency: number
): ProviderConfig {
  const previousLabels: Record<string, string[]> = {
    "google-web-translate": ["Google Web Translate", "Google Cloud Translation"],
    "openai-compatible": ["OpenAI Compatible"]
  };
  if (previousLabels[provider.id]?.includes(provider.label)) {
    provider = { ...provider, label: DEFAULT_SETTINGS.providers.find(entry => entry.id === provider.id)!.label };
  }
  const legacyPerformance = provider.performanceMode === undefined;
  const performanceMode = provider.performanceMode === "custom"
    || (legacyPerformance && isLlmProvider(provider))
    ? "custom"
    : "inherit";
  if (performanceMode === "inherit") {
    return {
      ...provider,
      enabled: provider.enabled !== false,
      performanceMode,
      chunkSize: undefined,
      concurrency: undefined
    };
  }
  return {
    ...provider,
    enabled: provider.enabled !== false,
    performanceMode,
    chunkSize: clampNumber(
      provider.chunkSize,
      200,
      4000,
      legacyPerformance && isLlmProvider(provider) ? Math.max(3200, globalChunkSize) : globalChunkSize
    ),
    concurrency: clampNumber(provider.concurrency, 1, 8, globalConcurrency)
  };
}

function ensureEnabledProvider(providers: ProviderConfig[]): void {
  if (providers.some((provider) => provider.enabled !== false)) return;
  const fallback = providers.find((provider) => provider.id === DEFAULT_SETTINGS.activeProviderId)
    ?? providers[0];
  if (fallback) fallback.enabled = true;
}

function isProviderConfig(value: unknown): value is ProviderConfig {
  if (!isRecord(value)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  if (
    value.performanceMode !== undefined
    && value.performanceMode !== "inherit"
    && value.performanceMode !== "custom"
  ) return false;
  if (value.chunkSize !== undefined && typeof value.chunkSize !== "number") return false;
  if (value.concurrency !== undefined && typeof value.concurrency !== "number") return false;
  if (value.type === "google-web-translate" || value.type === "firefox-local") {
    return ["id", "label"].every((key) => typeof value[key] === "string");
  }

  if (value.type === "openai-compatible" || value.type === "anthropic-compatible") {
    return ["id", "label", "baseURL", "apiKey", "model", "systemPrompt"].every((key) =>
      typeof value[key] === "string"
    );
  }

  return false;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
