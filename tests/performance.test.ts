import { describe, expect, it } from "vitest";
import { getEffectiveProviderPerformance } from "../src/shared/performance";
import { normalizeSettings } from "../src/shared/settings";

describe("provider performance", () => {
  it("inherits global values when no provider override is active", () => {
    const settings = normalizeSettings({ chunkSize: 900, concurrency: 4 });

    expect(getEffectiveProviderPerformance(settings, "google-web-translate")).toEqual({
      chunkSize: 900,
      concurrency: 4,
      performanceMode: "inherit"
    });
  });

  it("uses provider values while keeping concurrency under the global limit", () => {
    const settings = normalizeSettings({
      chunkSize: 900,
      concurrency: 2,
      providers: [
        {
          type: "openai-compatible",
          id: "llm-provider",
          label: "OpenAI 兼容",
          performanceMode: "custom",
          chunkSize: 3600,
          concurrency: 6,
          baseURL: "https://example.com/v1",
          apiKey: "",
          model: "gpt-4o-mini",
          systemPrompt: "Translate to {{targetLang}}"
        }
      ]
    });

    expect(getEffectiveProviderPerformance(settings, "llm-provider")).toEqual({
      chunkSize: 3600,
      concurrency: 2,
      performanceMode: "custom"
    });
  });
});
