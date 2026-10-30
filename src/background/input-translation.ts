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

/** Loopback and private-network hosts (Ollama, LM Studio…) legitimately run without an API key. */
function isLocalEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname;
    return host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(host) || host === "[::1]";
  } catch { return false; }
}

/** The first configured LLM endpoint: the active one, then any other. Untouched defaults without a key do not count. */
export function pickInputProvider(settings: ExtensionSettings): LlmConfig | undefined {
  const usable = (provider: ExtensionSettings["providers"][number]): provider is LlmConfig =>
    (provider.type === "openai-compatible" || provider.type === "anthropic-compatible")
    && provider.enabled !== false && Boolean(provider.baseURL.trim() && provider.model.trim())
    && (Boolean(provider.apiKey.trim()) || isLocalEndpoint(provider.baseURL));
  const active = settings.providers.find(provider => provider.id === settings.activeProviderId);
  if (active && usable(active)) return active;
  return settings.providers.find(usable);
}

/** One uncached LLM call: typed text is never written to the translation cache. */
export async function translateInput(settings: ExtensionSettings, text: string, signal?: AbortSignal): Promise<{ translation: string; providerLabel: string }> {
  const config = pickInputProvider(settings);
  if (!config) throw new Error("输入框翻译需要大模型：请先在「设置 → 翻译服务」填写 OpenAI 兼容或 Anthropic 兼容端点的地址、模型和 API Key。");
  if (!text.trim()) throw new Error("输入框里没有可翻译的文字。");
  if (text.length > 8000) throw new Error("文字过长（上限 8000 字符），请选中一部分后再翻译。");
  const target = settings.inputTargetLang ?? "en";
  const secondary = target === settings.targetLang ? (target === "en" ? "zh-CN" : "en") : settings.targetLang;
  const provider = createProvider({ ...config, systemPrompt: inputPrompt(languageName(secondary)) });
  const [translation] = await provider.translateBatch({ texts: [text], sourceLang: "auto", targetLang: languageName(target) }, signal);
  if (!translation?.trim()) throw new Error("大模型没有返回译文。");
  return { translation, providerLabel: config.label };
}
