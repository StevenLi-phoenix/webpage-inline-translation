import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import type { ExtensionSettings } from "../src/shared/types";
import { inputPrompt, languageName, pickInputProvider, translateInput } from "../src/background/input-translation";

afterEach(() => vi.unstubAllGlobals());
const llm = (extra: Record<string, unknown> = {}) => ({ type: "openai-compatible", id: "oa", label: "OA", enabled: true, ollamaCompatibility: false, baseURL: "https://llm.test/v1", apiKey: "k", model: "m", systemPrompt: "x", ...extra });
const settings = (providers: unknown[], active = "google-web-translate"): ExtensionSettings =>
  ({ ...DEFAULT_SETTINGS, providers: providers as ExtensionSettings["providers"], activeProviderId: active, targetLang: "zh-CN", inputTargetLang: "en" });

describe("input translation provider", () => {
  it("prefers the active LLM and otherwise the first usable one", () => {
    const providers = [{ type: "google-web-translate", id: "google-web-translate", label: "G" }, llm({ id: "a", baseURL: "" }), llm({ id: "b" }), llm({ id: "c" })];
    expect(pickInputProvider(settings(providers))?.id).toBe("b");
    expect(pickInputProvider(settings(providers, "c"))?.id).toBe("c");
    expect(pickInputProvider(settings([providers[0], llm({ enabled: false })]))).toBeUndefined();
  });
  it("tells the user to configure an LLM when none is usable", async () => {
    await expect(translateInput(settings([{ type: "google-web-translate", id: "google-web-translate", label: "G" }]), "你好")).rejects.toThrow("OpenAI 兼容或 Anthropic 兼容");
  });
  it("rejects empty and oversized text before calling the model", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(translateInput(settings([llm()]), "  ")).rejects.toThrow("没有可翻译");
    await expect(translateInput(settings([llm()]), "x".repeat(8001))).rejects.toThrow("过长");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends one uncached request, asks for the writing language and reads the single result", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '["Hello"]' } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await translateInput(settings([llm()]), "你好");
    expect(result).toEqual({ translation: "Hello", providerLabel: "OA" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const prompt = JSON.stringify(body);
    expect(prompt).toContain("English");
    expect(prompt).toContain("Simplified Chinese");
  });
  it("flips to the reading language when the writing and reading languages coincide", () => {
    expect(inputPrompt("Japanese")).toContain("translate it into Japanese instead");
    expect(languageName("zh-CN")).toBe("Simplified Chinese");
    expect(languageName("xx")).toBe("xx");
  });
});
