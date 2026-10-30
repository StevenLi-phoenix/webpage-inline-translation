// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import { normalizeSettings } from "../src/shared/settings";
import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../src/shared/types";

describe("options provider model and test state", () => {
  let stored: ExtensionSettings;
  let testService: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    document.open();
    document.write(readFileSync(resolve(process.cwd(), "options.html"), "utf8"));
    document.close();
    stored = structuredClone(DEFAULT_SETTINGS);
    stored.activeProviderId = "openai-compatible";
    testService = vi.fn(async () => ({ ok: true, data: { translation: "你好" } }));
    vi.stubGlobal("chrome", { runtime: {
      sendMessage: async (request: RuntimeRequest): Promise<RuntimeResponse> => {
        if (request.type === "GET_SETTINGS") return { ok: true, data: structuredClone(stored) };
        if (request.type === "SAVE_SETTINGS") stored = normalizeSettings(request.settings);
        if (request.type === "TEST_PROVIDER") return testService(request.providerId);
        if (request.type === "GET_OCR_STATUS") {
          return { ok: true, data: { state: "installed", downloaded: 100, total: 100 } };
        }
        return { ok: true };
      }
    } });
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.unstubAllGlobals();
    document.documentElement.replaceChildren();
  });

  async function mount(): Promise<void> {
    await import("../src/options/index");
    await vi.waitFor(() => expect(query<HTMLElement>("#providerForm").dataset.providerId).toBe(stored.activeProviderId));
  }

  async function selectProvider(id: string): Promise<void> {
    const select = query<HTMLSelectElement>("#providerSelect");
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(query<HTMLElement>("#providerForm").dataset.providerId).toBe(id));
  }


  it("offers the four supported services in a plain select with no custom picker, tabs or usage panel", async () => {
    await mount();
    const select = query<HTMLSelectElement>("#providerSelect");
    expect(Array.from(select.options, option => option.value)).toEqual([
      "google-web-translate", "openai-compatible", "anthropic-compatible", "firefox-local"
    ]);
    expect(select.value).toBe("openai-compatible");
    for (const selector of ["#providerTrigger", "#providerMenu", "#providerAdvancedTab", "#providerUsage",
      "[data-field='serviceMode']", "[data-field='requestTemplateEnabled']", "[data-field='ollamaCompatibility']",
      "[data-action='manage-model']"]) {
      expect(document.querySelector(selector), selector).toBeNull();
    }
    expect(query<HTMLElement>("#deleteProvider").hidden).toBe(true);
    expect(query<HTMLInputElement>("#providerEnabled").checked).toBe(true);
  });

  it("shows only a name for Google and the local engine, and URL, key, model and prompt for LLM services", async () => {
    await mount();
    for (const field of ["label", "baseURL", "apiKey", "model", "systemPrompt"]) {
      expect(document.querySelector(`#providerForm [data-field='${field}']`), field).not.toBeNull();
    }
    await selectProvider("google-web-translate");
    expect(document.querySelector("#providerForm [data-field='apiKey']")).toBeNull();
    expect(document.querySelector("#providerForm [data-field='label']")).not.toBeNull();
    await selectProvider("firefox-local");
    expect(document.querySelector("#providerForm [data-local-model-control]")).not.toBeNull();
    await selectProvider("anthropic-compatible");
    expect(query<HTMLInputElement>("[data-field='model']").value).toBe("claude-haiku-5-5");
    expect(query<HTMLElement>("#providerForm").textContent).toContain("Anthropic Messages");
  });

  it("edits and saves a disabled service while retaining the enabled translation service", async () => {
    stored.providers.find(entry => entry.id === "anthropic-compatible")!.enabled = false;
    await mount();
    await selectProvider("anthropic-compatible");
    expect(stored.activeProviderId).toBe("openai-compatible");
    expect(query<HTMLElement>("#disabledProviderHint").hidden).toBe(false);
    expect(query<HTMLInputElement>("#providerEnabled").checked).toBe(false);
    query<HTMLInputElement>("[data-field='apiKey']").value = "disabled-draft-key";
    query<HTMLInputElement>("[data-field='model']").value = "claude-custom-model";
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#status").textContent).toBe("已保存。"));
    expect(query<HTMLElement>("#providerForm").dataset.providerId).toBe("anthropic-compatible");
    expect(stored.activeProviderId).toBe("openai-compatible");
    expect(stored.providers.find(entry => entry.id === "anthropic-compatible")).toMatchObject({
      enabled: false, apiKey: "disabled-draft-key", model: "claude-custom-model"
    });
    await selectProvider("openai-compatible"); await selectProvider("anthropic-compatible");
    expect(query<HTMLInputElement>("[data-field='apiKey']").value).toBe("disabled-draft-key");
    expect(query<HTMLInputElement>("[data-field='model']").value).toBe("claude-custom-model");
  });

  it("keeps a service open when disabling it and tests its draft without enabling it", async () => {
    await mount();
    query<HTMLInputElement>("#providerEnabled").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#disabledProviderHint").hidden).toBe(false));
    expect(query<HTMLElement>("#providerForm").dataset.providerId).toBe("openai-compatible");
    expect(stored.activeProviderId).toBe("google-web-translate");
    expect(query<HTMLSelectElement>("#providerSelect").value).toBe("openai-compatible");
    query<HTMLInputElement>("[data-field='apiKey']").value = "test-before-enabling";
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(testService).toHaveBeenCalledWith("openai-compatible"));
    await vi.waitFor(() => expect(query<HTMLElement>("[data-role='provider-test-status']").textContent).toBe("测试通过：你好"));
    expect(stored.providers.find(entry => entry.id === "openai-compatible")).toMatchObject({ enabled: false, apiKey: "test-before-enabling" });
    expect(stored.activeProviderId).toBe("google-web-translate");
  });

  it("refuses to disable the last enabled service", async () => {
    for (const entry of stored.providers) entry.enabled = entry.id === "openai-compatible";
    await mount();
    query<HTMLInputElement>("#providerEnabled").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#status").textContent).toBe("至少需要启用一个翻译服务。"));
    expect(query<HTMLInputElement>("#providerEnabled").checked).toBe(true);
    expect(stored.providers.find(entry => entry.id === "openai-compatible")?.enabled).toBe(true);
  });

  it("adds an OpenAI-compatible or Anthropic-compatible custom service and deletes it again", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
    await mount();
    expect(Array.from(query<HTMLSelectElement>("#customLlmFormat").options, option => option.value)).toEqual(["openai", "anthropic"]);
    query<HTMLButtonElement>("#addProvider").click();
    query<HTMLInputElement>("#customProviderName").value = "我的服务";
    query<HTMLSelectElement>("#customLlmFormat").value = "anthropic";
    query<HTMLFormElement>("#providerDialogForm").requestSubmit();
    await vi.waitFor(() => expect(stored.providers).toHaveLength(5));
    const custom = stored.providers[4];
    expect(custom).toMatchObject({ type: "anthropic-compatible", label: "我的服务", baseURL: "https://api.anthropic.com" });
    expect(stored.activeProviderId).toBe(custom.id);
    await vi.waitFor(() => expect(query<HTMLSelectElement>("#providerSelect").value).toBe(custom.id));
    expect(query<HTMLElement>("#deleteProvider").hidden).toBe(false);
    query<HTMLButtonElement>("#deleteProvider").click();
    await vi.waitFor(() => expect(stored.providers).toHaveLength(4));
    expect(stored.activeProviderId).toBe("google-web-translate");
    await vi.waitFor(() => expect(query<HTMLElement>("#deleteProvider").hidden).toBe(true));
    expect(query<HTMLSelectElement>("#providerSelect").value).toBe("google-web-translate");
  });

  it("reveals the default language checkbox with the master switch and preserves an unchecked choice", async () => {
    await mount();
    const enabled = query<HTMLInputElement>("#autoTranslateEnabled");
    const foreign = query<HTMLInputElement>("#autoTranslateNonTarget");
    const option = query<HTMLElement>("#autoTranslateNonTargetOption");
    const siteInput = query<HTMLInputElement>(".auto-site-pattern");
    expect(option.hidden).toBe(true);
    expect(foreign.disabled).toBe(true);
    enabled.click();
    expect(option.hidden).toBe(false);
    expect(foreign.type).toBe("checkbox");
    expect(foreign.disabled).toBe(false);
    expect(foreign.checked).toBe(true);
    foreign.click();
    enabled.click();
    expect(option.hidden).toBe(true);
    expect(foreign.disabled).toBe(true);
    enabled.click();
    expect(foreign.checked).toBe(false);
    expect(query<HTMLInputElement>(".auto-site-pattern")).toBe(siteInput);
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation).toMatchObject({ enabled: true, nonTargetLanguage: false }));
    expect(option.hidden).toBe(false);
    expect(foreign.checked).toBe(false);
  });

  it.each([false, true])("preserves the saved site-only choice when automatic translation is enabled: %s", async enabled => {
    stored.autoTranslation = { enabled, nonTargetLanguage: false, presetSites: ["github.com"], customSites: [] };
    await mount();
    expect(query<HTMLElement>("#autoTranslateNonTargetOption").hidden).toBe(!enabled);
    if (!enabled) query<HTMLInputElement>("#autoTranslateEnabled").click();
    expect(query<HTMLElement>("#autoTranslateNonTargetOption").hidden).toBe(false);
    expect(query<HTMLInputElement>("#autoTranslateNonTarget").checked).toBe(false);
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation).toMatchObject({ enabled: true, nonTargetLanguage: false, presetSites: ["github.com"] }));
  });

  it("saves preset, custom-site and language rules with the current provider settings", async () => {
    await mount();
    query<HTMLInputElement>("#autoTranslateEnabled").checked = true;
    query<HTMLInputElement>("#autoTranslateNonTarget").checked = true;
    query<HTMLInputElement>("#autoTranslateSites input[data-preset='github.com']").checked = true;
    query<HTMLButtonElement>("#addAutoTranslateSite").click();
    query<HTMLInputElement>(".auto-site-row:nth-last-child(2) .auto-site-pattern").value = "Example.COM/docs/*";
    expect(document.querySelectorAll(".auto-site-row")).toHaveLength(7);
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#status").textContent).toBe("已保存。"));
    expect(stored.autoTranslation).toMatchObject({ enabled: true, nonTargetLanguage: true,
      presetSites: ["github.com"], customSites: [{ pattern: "example.com/docs/*", enabled: true }] });
    query<HTMLInputElement>(".auto-site-row:nth-last-child(2) .auto-site-enabled").click();
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation?.customSites[0].enabled).toBe(false));
    await selectProvider("anthropic-compatible");
    expect(query<HTMLInputElement>("#autoTranslateEnabled").checked).toBe(true);
    query<HTMLButtonElement>(".auto-site-row:nth-last-child(2) button").click();
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation?.customSites).toHaveLength(0));
    query<HTMLButtonElement>(".auto-site-row[data-site-id='preset-github.com'] button").click();
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation?.removedPresetSites).toContain("github.com"));
    expect(document.querySelector(".auto-site-row[data-site-id='preset-github.com']")).toBeNull();
    expect(stored.autoTranslation?.presetSites).toEqual([]);
  });

  it("edits preset sites inline and keeps the original preset removed after saving", async () => {
    await mount();
    query<HTMLInputElement>(".auto-site-row[data-site-id='preset-github.com'] .auto-site-pattern").value = "docs.example.com/*";
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation?.customSites).toEqual([
      { id: "preset-github.com", pattern: "docs.example.com/*", enabled: false }
    ]));
    expect(stored.autoTranslation?.removedPresetSites).toEqual(["github.com"]);
    expect(document.querySelectorAll(".auto-site-row")).toHaveLength(6);
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#status").textContent).toBe("已保存。"));
    expect(document.querySelector("input[data-preset='github.com']")).toBeNull();
  });

  it("keeps invalid or duplicate draft rows editable instead of saving incomplete rules", async () => {
    await mount();
    query<HTMLButtonElement>("#addAutoTranslateSite").click();
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#autoTranslateSiteStatus").textContent).toContain("第 7 行"));
    const input = query<HTMLInputElement>(".auto-site-row:nth-last-child(2) .auto-site-pattern");
    expect(document.activeElement).toBe(input);
    input.value = "GITHUB.COM";
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#autoTranslateSiteStatus").textContent).toContain("已经存在"));
    expect(stored.autoTranslation?.customSites).toEqual([]);
    input.value = "example.com/docs/*";
    query<HTMLButtonElement>("#save").click();
    await vi.waitFor(() => expect(stored.autoTranslation?.customSites[0].pattern).toBe("example.com/docs/*"));
  });


  it.each([true, false])("ignores a late test result after switching services (success: %s)", async success => {
    const pending = deferred<RuntimeResponse>();
    testService.mockReturnValueOnce(pending.promise);
    await mount();
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(testService).toHaveBeenCalledWith("openai-compatible"));
    await selectProvider("anthropic-compatible");
    const message = query<HTMLElement>("#status").textContent;
    pending.resolve(testResult(success, "旧服务结果"));
    await flush();
    expect(query<HTMLElement>("[data-role='provider-test-status']").hidden).toBe(true);
    expect(query<HTMLElement>("#status").textContent).toBe(message);
  });

  it("does not restore an old result after switching away and back to the same service", async () => {
    const pending = deferred<RuntimeResponse>();
    testService.mockReturnValueOnce(pending.promise);
    await mount();
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(testService).toHaveBeenCalledTimes(1));
    await selectProvider("anthropic-compatible");
    await selectProvider("openai-compatible");
    pending.resolve(testResult(true, "离开前的结果"));
    await flush();
    expect(query<HTMLElement>("[data-role='provider-test-status']").hidden).toBe(true);
    expect(query<HTMLElement>("#status").textContent).toBe("已切换当前服务。");
  });

  it.each([true, false])("keeps the latest test result when an earlier request finishes (success: %s)", async success => {
    const pending = deferred<RuntimeResponse>();
    testService.mockReturnValueOnce(pending.promise);
    await mount();
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(testService).toHaveBeenCalledTimes(1));
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#status").textContent).toBe("测试通过：你好"));
    pending.resolve(testResult(success, "较早的结果"));
    await flush();
    expect(query<HTMLElement>("[data-role='provider-test-status']").textContent).toBe("测试通过：你好");
    expect(query<HTMLElement>("#status").textContent).toBe("测试通过：你好");
  });

  it.each([
    ["model", "gpt-4.1-mini", "input"],
    ["apiKey", "updated-test-key", "input"],
    ["baseURL", "https://updated.example/v1", "input"]
  ])("clears test feedback when %s changes and allows testing the updated configuration", async (field, value, event) => {
    const pending = deferred<RuntimeResponse>();
    testService.mockReturnValueOnce(pending.promise);
    await mount();
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(testService).toHaveBeenCalledTimes(1));
    const control = query<HTMLInputElement>(`[data-field='${field}']`);
    control.value = value;
    control.dispatchEvent(new Event(event, { bubbles: true }));
    expect(query<HTMLElement>("[data-role='provider-test-status']").hidden).toBe(true);
    expect(query<HTMLElement>("#status").textContent).toBe("");
    pending.resolve(testResult(true, "旧模型的结果"));
    await flush();
    expect(query<HTMLElement>("[data-role='provider-test-status']").hidden).toBe(true);
    query<HTMLButtonElement>("#test").click();
    await vi.waitFor(() => expect(query<HTMLElement>("#status").textContent).toBe("测试通过：你好"));
    expect(stored.providers.find(entry => entry.id === "openai-compatible")).toMatchObject({ [field]: value });
  });
});

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function testResult(success: boolean, message: string): RuntimeResponse {
  return success ? { ok: true, data: { translation: message } } : { ok: false, error: message };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

