import type { ExtensionSettings, ProviderConfig } from "../shared/types";
import { TARGET_LANGUAGES } from "../shared/languages";
import { createProvider } from "./providers";

type LlmConfig = Extract<ProviderConfig, { type: "openai-compatible" | "anthropic-compatible" }>;

/** English names the LLM understands better than locale codes. */
const NAMES: Record<string, string> = {
  "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese", en: "English", ja: "Japanese", ko: "Korean",
  fr: "French", de: "German", es: "Spanish", ru: "Russian"
};

export function languageName(code: string): string {
  return NAMES[code] ?? TARGET_LANGUAGES.find(language => language.code === code)?.label ?? code;
}

/** The writing assistant prompt; `{{targetLang}}` is filled by the provider's own template step. */
export function inputPrompt(secondaryName: string): string {
  return [
    "You are a translation engine for text the user is typing into a form field.",
    "Translate each input item into {{targetLang}}.",
    `If an item is already written in {{targetLang}}, translate it into ${secondaryName} instead.`,
    "Keep the tone, line breaks, emoji, @mentions, #tags, URLs, numbers, code and placeholders unchanged.",
    "Output only the translation, with no explanations or quotation marks added."
  ].join(" ");
}

/** The first LLM endpoint with enough configuration to answer: the active one, then any other. */
export function pickInputProvider(settings: ExtensionSettings): LlmConfig | undefined {
  const usable = (provider: ExtensionSettings["providers"][number]): provider is LlmConfig =>
    (provider.type === "openai-compatible" || provider.type === "anthropic-compatible")
    && provider.enabled !== false && Boolean(provider.baseURL.trim() && provider.model.trim());
  const active = settings.providers.find(provider => provider.id === settings.activeProviderId);
  if (active && usable(active)) return active;
  return settings.providers.find(usable);
}

/** One uncached LLM call: typed text is never written to the translation cache. */
export async function translateInput(settings: ExtensionSettings, text: string, signal?: AbortSignal): Promise<{ translation: string; providerLabel: string }> {
  const config = pickInputProvider(settings);
  if (!config) throw new Error("输入框翻译需要大模型：请先在设置中配置 OpenAI 兼容或 Anthropic 兼容端点。");
  if (!text.trim()) throw new Error("输入框里没有可翻译的文字。");
  if (text.length > 8000) throw new Error("文字过长（上限 8000 字符），请选中一部分后再翻译。");
  const target = settings.inputTargetLang ?? "en";
  const secondary = target === settings.targetLang ? (target === "en" ? "zh-CN" : "en") : settings.targetLang;
  const provider = createProvider({ ...config, systemPrompt: inputPrompt(languageName(secondary)) });
  const [translation] = await provider.translateBatch({ texts: [text], sourceLang: "auto", targetLang: languageName(target) }, signal);
  if (!translation?.trim()) throw new Error("大模型没有返回译文。");
  return { translation, providerLabel: config.label };
}
