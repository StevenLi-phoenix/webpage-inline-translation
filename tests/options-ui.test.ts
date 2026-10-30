// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import { normalizeSettings } from "../src/shared/settings";
import type { ExtensionSettings, RuntimeRequest, RuntimeResponse } from "../src/shared/types";

describe("options provider controls", () => {
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
    document.documentElement?.replaceChildren();
  });

  it("adds, toggles, and deletes a custom Anthropic provider", async () => {
    document.open();
    document.write(readFileSync(resolve(process.cwd(), "options.html"), "utf8"));
    document.close();
    let stored = cloneSettings(DEFAULT_SETTINGS);
    const sendMessage = vi.fn(async (request: RuntimeRequest): Promise<RuntimeResponse> => {
      if (request.type === "GET_OCR_STATUS") return { ok: true, data: { state: "installed", total: 100, downloaded: 100 } };
      if (request.type === "GET_SETTINGS") return { ok: true, data: stored };
      if (request.type === "TEST_PROVIDER") return { ok: true, data: { translation: "你好" } };
      if (request.type === "SAVE_SETTINGS") {
        stored = normalizeSettings(request.settings);
        return { ok: true, data: null };
      }
      return { ok: true, data: null };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      }
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await import("../src/options/index");
    await vi.waitFor(() => {
      expect(query<HTMLSelectElement>("#providerSelect").selectedOptions[0]?.textContent).toBe("Google 翻译");
    });
    expect(document.querySelector("[data-field='apiKey']")).toBeNull();
    expect(document.querySelector("[data-provider-icon]")).toBeNull();
    expect(document.querySelector("#performanceSettings #pdfTranslationScope")).not.toBeNull();
    expect(document.querySelector("#performanceSettings #chunkSize")).not.toBeNull();
    expect(document.querySelector("#providerForm [data-field='inheritPerformance']")).toBeNull();
    expect(document.querySelector("footer #test")).toBeNull();
    expect(query<HTMLSelectElement>("#sourceLang").value).toBe("auto");
    expect(query<HTMLSelectElement>("#sourceLang").selectedOptions[0]?.textContent)
      .toBe("自动检测");
    expect(query<HTMLSelectElement>("#translationDisplayMode").selectedOptions[0]?.textContent)
      .toBe("原色对照");
    expect(query<HTMLSelectElement>("#pdfTranslationScope").value).toBe("nearby");
    expect(query<HTMLInputElement>("#pdfTranslationPageRadius").value).toBe("5");
    query<HTMLInputElement>("#pdfTranslationPageRadius").value = "2";
    click("#save");
    await vi.waitFor(() => expect(stored.pdfTranslationPageRadius).toBe(2));
    query<HTMLSelectElement>("#pdfTranslationScope").value = "unlimited";
    query<HTMLSelectElement>("#pdfTranslationScope").dispatchEvent(new Event("change"));
    expect(query<HTMLElement>("#pdfTranslationPageRadiusField").hidden).toBe(true);
    expect(document.querySelector("#pdfTranslationScopeDescription")).toBeNull();
    click("#save");
    await vi.waitFor(() => expect(stored.pdfTranslationPageRadius).toBeNull());
    query<HTMLSelectElement>("#pdfTranslationScope").value = "nearby";
    query<HTMLSelectElement>("#pdfTranslationScope").dispatchEvent(new Event("change"));
    expect(query<HTMLInputElement>("#pdfTranslationPageRadius").disabled).toBe(false);
    query<HTMLInputElement>("#pdfTranslationPageRadius").value = "0";
    click("#save");
    await vi.waitFor(() => expect(stored.pdfTranslationPageRadius).toBe(0));
    query<HTMLSelectElement>("#translationDisplayMode").value = "bilingual-accent";
    query<HTMLSelectElement>("#sourceLang").value = "en";
    click("#save");
    await vi.waitFor(() => expect(stored).toMatchObject({
      sourceLang: "en",
      translationDisplayMode: "bilingual-accent"
    }));
    const translateCodeComments = query<HTMLInputElement>("#translateCodeComments");
    expect(translateCodeComments.checked).toBe(true);
    const imageTranslation = query<HTMLInputElement>("#imageTranslationEnabled");
    expect(imageTranslation.checked).toBe(false);
    imageTranslation.click();
    click("#save");
    await vi.waitFor(() => expect(stored.imageTranslationEnabled).toBe(true));
    translateCodeComments.click();
    click("#save");
    await vi.waitFor(() => expect(stored.translateCodeComments).toBe(false));
    const inheritPerformance = query<HTMLInputElement>("[data-field='inheritPerformance']");
    expect(inheritPerformance.checked).toBe(true);
    inheritPerformance.click();
    expect(query<HTMLElement>("[data-role='performanceOverrides']").hidden).toBe(false);
    query<HTMLInputElement>("[data-field='chunkSize']").value = "800";
    query<HTMLInputElement>("[data-field='concurrency']").value = "2";
    click("#save");
    await vi.waitFor(() => {
      expect(stored.providers.find((entry) => entry.id === "google-web-translate"))
        .toMatchObject({ performanceMode: "custom", chunkSize: 800, concurrency: 2 });
    });

    const select = query<HTMLSelectElement>("#providerSelect");
    expect(Array.from(select.options, (option) => option.value)).toEqual(DEFAULT_SETTINGS.providers.map((provider) => provider.id));
    expect(query<HTMLElement>("#deleteProvider").hidden).toBe(true);

    const choose = (id: string): void => {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    choose("openai-compatible");
    await vi.waitFor(() => expect(query<HTMLInputElement>("[data-field='baseURL']").value).toBe("https://api.openai.com/v1"));
    expect(query<HTMLInputElement>("[data-field='model']").value).toBe("gpt-4o-mini");
    query<HTMLInputElement>("[data-field='apiKey']").value = "saved-model-test-key";
    query<HTMLInputElement>("[data-field='baseURL']").value = "https://example.com/v1";
    query<HTMLInputElement>("[data-field='model']").value = "custom-model";
    click("#save");
    await vi.waitFor(() => {
      expect(stored.providers.find((entry) => entry.id === "openai-compatible")).toMatchObject({
        model: "custom-model", apiKey: "saved-model-test-key", baseURL: "https://example.com/v1"
      });
    });
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("已保存。"));
    click("#test");
    await vi.waitFor(() => expect(document.querySelector("#status")?.textContent).toBe("测试通过：你好"));
    expect(document.querySelector("#providerForm > [data-role='provider-test-status']")?.textContent).toBe("测试通过：你好");
    expect(sendMessage).toHaveBeenCalledWith({ type: "TEST_PROVIDER", providerId: "openai-compatible" });
    choose("google-web-translate");
    await vi.waitFor(() => expect(document.querySelector("[data-field='baseURL']")).toBeNull());
    choose("openai-compatible");
    await vi.waitFor(() => expect(query<HTMLInputElement>("[data-field='model']").value).toBe("custom-model"));

    click("#addProvider");
    expect(document.querySelector("#providerDialog")?.hasAttribute("open")).toBe(true);
    expect(document.querySelector("#customProviderKind")).toBeNull();
    query<HTMLInputElement>("#customProviderName").value = "My Anthropic";
    query<HTMLSelectElement>("#customLlmFormat").value = "anthropic";
    query<HTMLFormElement>("#providerDialogForm").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    await vi.waitFor(() => {
      expect(query<HTMLSelectElement>("#providerSelect").selectedOptions[0]?.textContent).toBe("My Anthropic");
    });
    expect(stored.providers).toHaveLength(DEFAULT_SETTINGS.providers.length + 1);
    expect(stored.providers.find((provider) => provider.id === stored.activeProviderId)?.type)
      .toBe("anthropic-compatible");
    expect(query<HTMLElement>("#deleteProvider").hidden).toBe(false);

    const customId = stored.activeProviderId;
    click("#providerEnabled");
    await vi.waitFor(() => expect(stored.activeProviderId).toBe("google-web-translate"));
    expect(stored.providers.find((provider) => provider.id === customId)?.enabled).toBe(false);

    click("#deleteProvider");
    await vi.waitFor(() => {
      expect(stored.providers).toHaveLength(DEFAULT_SETTINGS.providers.length);
      expect(query<HTMLElement>("#deleteProvider").hidden).toBe(true);
    });
  });
});

function click(selector: string): void {
  query<HTMLButtonElement>(selector).click();
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function cloneSettings(value: ExtensionSettings): ExtensionSettings {
  return JSON.parse(JSON.stringify(value)) as ExtensionSettings;
}
