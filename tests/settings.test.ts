import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/shared/defaults";
import { getEffectiveProviderPerformance } from "../src/shared/performance";
import { getSettings, normalizeSettings, saveSettings } from "../src/shared/settings";

afterEach(() => { vi.unstubAllGlobals(); });

const PROMPT = "Translate to {{targetLang}}";

describe("normalizeSettings", () => {
  it("uses defaults for invalid input", () => {
    const settings = normalizeSettings({
      targetLang: "",
      chunkSize: 99999,
      concurrency: -1,
      providers: []
    });

    expect(settings.targetLang).toBe("zh-CN");
    expect(settings.activeProviderId).toBe("google-web-translate");
    expect(settings.chunkSize).toBe(4000);
    expect(settings.concurrency).toBe(1);
    expect(settings.translateCodeComments).toBe(true);
    expect(settings.imageTranslationEnabled).toBe(false);
    expect(settings.translationDisplayMode).toBe("bilingual");
    expect(settings.providers.length).toBeGreaterThan(0);
  });

  it("ships exactly the four supported providers", () => {
    expect(DEFAULT_SETTINGS.providers.map((provider) => [provider.id, provider.type, provider.label])).toEqual([
      ["google-web-translate", "google-web-translate", "Google 翻译"],
      ["openai-compatible", "openai-compatible", "OpenAI 兼容"],
      ["anthropic-compatible", "anthropic-compatible", "Anthropic 兼容"],
      ["firefox-local", "firefox-local", "Firefox 本地翻译（实验）"]
    ]);
    expect(DEFAULT_SETTINGS.providers.find((provider) => provider.id === "anthropic-compatible"))
      .toMatchObject({ baseURL: "https://api.anthropic.com", model: "claude-haiku-5-5" });
  });

  it("preserves a disabled code comment translation setting", () => {
    expect(normalizeSettings({ translateCodeComments: false }).translateCodeComments).toBe(false);
  });

  it("defaults older PDF settings to five pages on each side and supports current-page-only and unlimited", () => {
    expect(normalizeSettings({}).pdfTranslationPageRadius).toBe(5);
    expect(normalizeSettings({ pdfTranslationPageRadius: 0 }).pdfTranslationPageRadius).toBe(0);
    expect(normalizeSettings({ pdfTranslationPageRadius: 12 }).pdfTranslationPageRadius).toBe(12);
    expect(normalizeSettings({ pdfTranslationPageRadius: null }).pdfTranslationPageRadius).toBeNull();
    expect(normalizeSettings({ pdfTranslationPageRadius: -3 }).pdfTranslationPageRadius).toBe(0);
    expect(normalizeSettings({ pdfTranslationPageRadius: 2.7 }).pdfTranslationPageRadius).toBe(3);
    for (const invalid of ["unlimited", "5", false, NaN, Infinity]) {
      expect(normalizeSettings({ pdfTranslationPageRadius: invalid }).pdfTranslationPageRadius).toBe(5);
    }
  });
  it("only enables image translation with an explicit boolean switch", () => {
    expect(normalizeSettings({ imageTranslationEnabled: true }).imageTranslationEnabled).toBe(true);
    expect(normalizeSettings({ imageTranslationEnabled: "true" }).imageTranslationEnabled).toBe(false);
  });

  it("preserves valid translation display modes and rejects unknown values", () => {
    expect(normalizeSettings({ translationDisplayMode: "replace" }).translationDisplayMode)
      .toBe("replace");
    expect(normalizeSettings({ translationDisplayMode: "bilingual-accent" }).translationDisplayMode)
      .toBe("bilingual-accent");
    expect(normalizeSettings({ translationDisplayMode: "unknown" }).translationDisplayMode)
      .toBe("bilingual");
  });

  it("adds new built-in providers to older saved settings", () => {
    const settings = normalizeSettings({
      activeProviderId: "openai-compatible",
      providers: [
        {
          type: "openai-compatible",
          id: "openai-compatible",
          label: "OpenAI Compatible",
          baseURL: "https://example.com/v1",
          apiKey: "key",
          model: "model",
          systemPrompt: PROMPT
        }
      ]
    });

    expect(settings.activeProviderId).toBe("openai-compatible");
    expect(settings.providers.find((provider) => provider.id === "openai-compatible"))
      .toMatchObject({
        label: "OpenAI 兼容",
        performanceMode: "custom",
        chunkSize: 3200,
        concurrency: 3
      });
    expect(settings.providers.map((provider) => provider.id)).toEqual([
      "google-web-translate",
      "openai-compatible",
      "anthropic-compatible",
      "firefox-local"
    ]);
  });

  it("preserves an explicit inherited provider performance mode", () => {
    const settings = normalizeSettings({
      chunkSize: 900,
      concurrency: 2,
      providers: [
        {
          type: "anthropic-compatible",
          id: "anthropic-compatible",
          label: "Anthropic 兼容",
          performanceMode: "inherit",
          chunkSize: 3900,
          concurrency: 8,
          baseURL: "https://api.anthropic.com",
          apiKey: "",
          model: "claude-haiku-5-5",
          systemPrompt: PROMPT
        }
      ]
    });

    expect(settings.providers.find((provider) => provider.id === "anthropic-compatible"))
      .toMatchObject({ performanceMode: "inherit" });
    expect(settings.providers.find((provider) => provider.id === "anthropic-compatible")?.chunkSize)
      .toBeUndefined();
  });

  it("preserves custom providers and falls back when the active provider is disabled", () => {
    const settings = normalizeSettings({
      activeProviderId: "openai-compatible",
      providers: [
        {
          type: "openai-compatible",
          id: "openai-compatible",
          label: "OpenAI 兼容",
          enabled: false,
          baseURL: "https://api.openai.com/v1",
          apiKey: "",
          model: "gpt-4o-mini",
          systemPrompt: PROMPT
        },
        {
          type: "anthropic-compatible",
          id: "custom-anthropic-test",
          label: "Custom Anthropic",
          enabled: true,
          baseURL: "https://api.anthropic.com/v1",
          apiKey: "secret",
          model: "claude-test",
          systemPrompt: PROMPT
        }
      ]
    });

    expect(settings.providers.find((provider) => provider.id === "openai-compatible")?.enabled)
      .toBe(false);
    expect(settings.providers.some((provider) => provider.id === "custom-anthropic-test")).toBe(true);
    expect(settings.activeProviderId).toBe("google-web-translate");
  });

  it("keeps at least one provider enabled", () => {
    const disabledProviders = normalizeSettings(undefined).providers.map((provider) => ({
      ...provider,
      enabled: false
    }));
    const settings = normalizeSettings({ providers: disabledProviders });

    expect(settings.providers.filter((provider) => provider.enabled !== false)).toHaveLength(1);
    expect(settings.activeProviderId).toBe("google-web-translate");
  });

  it("drops fields of removed features from LLM providers", () => {
    const settings = normalizeSettings({
      providers: [{
        type: "openai-compatible", id: "openai-compatible", label: "OpenAI 兼容",
        baseURL: "https://example.com/v1", apiKey: "key", model: "m", systemPrompt: PROMPT,
        requestTemplate: { enabled: true, headers: "{}", body: "{}" }, ollamaCompatibility: false,
        customModels: ["a"]
      }]
    });
    const provider = settings.providers.find((entry) => entry.id === "openai-compatible")!;
    expect(provider).toMatchObject({ apiKey: "key", model: "m" });
    for (const removed of ["requestTemplate", "ollamaCompatibility", "customModels"]) {
      expect(provider).not.toHaveProperty(removed);
    }
  });
});

describe("legacy provider migration", () => {
  const removed = [
    { type: "doubao-web", id: "doubao-web", label: "豆包" },
    { type: "microsoft-web-translate", id: "microsoft-web-translate", label: "Microsoft 翻译", serviceMode: "api", api: { apiKey: "k" } },
    { type: "tencent-transmart", id: "tencent-transmart", label: "腾讯翻译" },
    { type: "yandex-web-translate", id: "yandex-web-translate", label: "Yandex 翻译" },
    { type: "volcengine-web-translate", id: "volcengine-web-translate", label: "火山翻译" },
    { type: "mymemory", id: "mymemory", label: "MyMemory" },
    { type: "microsoft-translator", id: "microsoft-translator", label: "Azure", endpoint: "https://e", apiKey: "k", region: "r" },
    { type: "google-cloud-translation", id: "google-cloud-translation", label: "GCP", apiKey: "k" },
    { type: "http-template", id: "http-template", label: "HTTP", method: "POST", url: "https://x", headers: {}, bodyTemplate: "{}", responsePath: "a" }
  ];

  it("drops providers whose type was removed", () => {
    const settings = normalizeSettings({ providers: removed });
    expect(settings.providers.map((provider) => provider.id)).toEqual([
      "google-web-translate", "openai-compatible", "anthropic-compatible", "firefox-local"
    ]);
  });

  it("falls back to Google when the stored active provider no longer exists", () => {
    for (const activeProviderId of removed.map((entry) => entry.id).concat("never-existed")) {
      expect(normalizeSettings({ activeProviderId, providers: removed }).activeProviderId)
        .toBe("google-web-translate");
    }
  });

  it("keeps Google web translate free of the old service-mode options", () => {
    const settings = normalizeSettings({
      providers: [{ type: "google-web-translate", id: "google-web-translate", label: "Google Web Translate" }]
    });
    expect(settings.providers[0]).toMatchObject({ label: "Google 翻译", type: "google-web-translate" });
  });

  it.each([
    ["deepseek", "https://api.deepseek.com", "deepseek-flash", "DeepSeek"],
    ["zhipu-glm", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash-250414", "Zhipu GLM"]
  ])("migrates a configured %s entry to openai-compatible and keeps it active", (id, baseURL, model, label) => {
    const settings = normalizeSettings({
      activeProviderId: id,
      providers: [{
        type: id, id, label, enabled: true, baseURL, apiKey: "saved-key", model, systemPrompt: "Custom prompt",
        performanceMode: "custom", chunkSize: 2000, concurrency: 2,
        requestTemplate: { enabled: true, headers: "{}", body: "{}" }, customModels: ["x"]
      }]
    });
    expect(settings.activeProviderId).toBe(id);
    const migrated = settings.providers.find((provider) => provider.id === id)!;
    expect(migrated).toMatchObject({
      type: "openai-compatible", id, label, baseURL, apiKey: "saved-key", model, systemPrompt: "Custom prompt",
      enabled: true, performanceMode: "custom", chunkSize: 2000, concurrency: 2
    });
    expect(migrated).not.toHaveProperty("customModels");
    expect(migrated).not.toHaveProperty("requestTemplate");
    expect(settings.providers.map((provider) => provider.id)).toEqual([
      "google-web-translate", "openai-compatible", "anthropic-compatible", "firefox-local", id
    ]);
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it.each(["deepseek", "zhipu-glm"])("drops an unconfigured %s entry", (id) => {
    const settings = normalizeSettings({
      activeProviderId: id,
      providers: [{ type: id, id, label: id, baseURL: "https://x", apiKey: "  ", model: "m", systemPrompt: PROMPT }]
    });
    expect(settings.providers.some((provider) => provider.id === id)).toBe(false);
    expect(settings.activeProviderId).toBe("google-web-translate");
  });

  it("round-trips through storage after migrating legacy settings", async () => {
    let saved: unknown = {
      activeProviderId: "deepseek",
      providers: [
        { type: "doubao-web", id: "doubao-web", label: "豆包", enabled: false },
        { type: "deepseek", id: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com",
          apiKey: "saved-key", model: "deepseek-flash", systemPrompt: PROMPT }
      ]
    };
    const set = vi.fn(async (value: Record<string, unknown>) => { saved = value[SETTINGS_KEY]; });
    vi.stubGlobal("chrome", { storage: { local: {
      get: vi.fn(async () => ({ [SETTINGS_KEY]: saved })), set
    } } });

    const loaded = await getSettings();
    await saveSettings(loaded);
    const reloaded = await getSettings();

    expect(reloaded).toEqual(loaded);
    expect(reloaded.activeProviderId).toBe("deepseek");
    expect(reloaded.providers.find((provider) => provider.id === "deepseek")?.type).toBe("openai-compatible");
    expect(reloaded.providers.some((provider) => provider.id === "doubao-web")).toBe(false);
  });
});

describe("provider performance", () => {
  it("lets providers override chunk size and concurrency within the global limits", () => {
    const result = normalizeSettings({
      chunkSize: 1000, concurrency: 4,
      providers: [{
        type: "openai-compatible", id: "openai-compatible", label: "OpenAI 兼容", baseURL: "https://x/v1",
        apiKey: "", model: "m", systemPrompt: PROMPT, performanceMode: "custom", chunkSize: 2400, concurrency: 8
      }]
    });
    expect(getEffectiveProviderPerformance(result, "openai-compatible")).toEqual({
      performanceMode: "custom", chunkSize: 2400, concurrency: 4
    });
    expect(getEffectiveProviderPerformance(result, "google-web-translate")).toMatchObject({
      performanceMode: "inherit", chunkSize: 1000, concurrency: 4
    });
  });

  it("keeps the local engine at fixed conservative limits", () => {
    const result = normalizeSettings({ activeProviderId: "firefox-local", chunkSize: 4000, concurrency: 8 });
    expect(getEffectiveProviderPerformance(result)).toEqual({ performanceMode: "custom", chunkSize: 800, concurrency: 1 });
  });
});
