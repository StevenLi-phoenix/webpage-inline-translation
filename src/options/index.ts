import { providerOrigins, requestOrigins, requiredOrigins } from "../shared/access";
import { BUILT_IN_PROVIDER_IDS, DEFAULT_SETTINGS } from "../shared/defaults";
import { normalizeFrameTranslation } from "../shared/frame-session";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../shared/languages";
import { TRANSLATION_DISPLAY_MODES } from "../shared/display-modes";
import { sendRuntimeMessage } from "../shared/messaging";
import type { ExtensionSettings, ProviderConfig } from "../shared/types";
import "./styles.css";
import { setImageTranslationToggle, setupOcrControl } from "../shared/ocr-control";
import { setupLocalModelControl } from "../local/control";
import { setupAutoTranslationControls } from "./auto-translation";
import { setupSettingsNavigation } from "./navigation";
import { setupShortcutSettings } from "./shortcuts";
import { setupAppearanceControls } from "./appearance";
import "../shared/appearance.css";
import { normalizeSelectionTranslation, type DictionaryProvider, type SelectionTriggerStyle } from "../shared/dictionary";
import { renderUiIcons } from "../shared/ui-icons";

renderUiIcons();

const settingsNavigation = setupSettingsNavigation(query<HTMLElement>(".settings"));
const shortcutControls = setupShortcutSettings(query<HTMLElement>("#shortcutSettings"));
const appearanceControls = setupAppearanceControls(query<HTMLElement>("#appearanceSettings"));

const targetLang = query<HTMLSelectElement>("#targetLang");
const sourceLang = query<HTMLSelectElement>("#sourceLang");
const chunkSize = query<HTMLInputElement>("#chunkSize");
const concurrency = query<HTMLInputElement>("#concurrency");
const pdfTranslationScope = query<HTMLSelectElement>("#pdfTranslationScope");
const pdfTranslationPageRadius = query<HTMLInputElement>("#pdfTranslationPageRadius");
const pdfTranslationPageRadiusField = query<HTMLElement>("#pdfTranslationPageRadiusField");
const cacheEnabled = query<HTMLInputElement>("#cacheEnabled");
const selectionTranslationEnabled = query<HTMLInputElement>("#selectionTranslationEnabled");
const selectionTranslationFields = query<HTMLFieldSetElement>("#selectionTranslationFields");
const selectionDictionary = query<HTMLSelectElement>("#selectionDictionary");
const selectionTriggerStyle = query<HTMLSelectElement>("#selectionTriggerStyle");
const imageTranslationEnabled = query<HTMLInputElement>("#imageTranslationEnabled");
const translateCodeComments = query<HTMLInputElement>("#translateCodeComments");
const translationDisplayMode = query<HTMLSelectElement>("#translationDisplayMode");
const translationDisplayModeDescription = query<HTMLSpanElement>("#translationDisplayModeDescription");
const providerSelect = query<HTMLSelectElement>("#providerSelect");
const providerEnabled = query<HTMLInputElement>("#providerEnabled");
const deleteProviderButton = query<HTMLButtonElement>("#deleteProvider");
const addProviderButton = query<HTMLButtonElement>("#addProvider");
const providerForm = query<HTMLDivElement>("#providerForm");
const providerPerformance = query<HTMLDivElement>("#providerPerformance");
const providerDialog = query<HTMLDialogElement>("#providerDialog");
const providerDialogForm = query<HTMLFormElement>("#providerDialogForm");
const cancelProviderButton = query<HTMLButtonElement>("#cancelProvider");
const customProviderName = query<HTMLInputElement>("#customProviderName");
const customLlmFormat = query<HTMLSelectElement>("#customLlmFormat");
const saveButton = query<HTMLButtonElement>("#save");
const restoreButton = query<HTMLButtonElement>("#restore");
const status = query<HTMLParagraphElement>("#status");
const autoTranslationControls = setupAutoTranslationControls(
  query<HTMLElement>("#autoTranslationSettings"), field => {
    settingsNavigation.reveal(field);
    field.scrollIntoView?.({ block: "center" });
  }
);
const frameTranslationEnabled = query<HTMLInputElement>("#frameTranslationEnabled");
const frameTranslationExcluded = query<HTMLTextAreaElement>("#frameTranslationExcluded");

const MODEL_SUGGESTIONS: Record<"openai-compatible" | "anthropic-compatible", string[]> = {
  "openai-compatible": ["gpt-4o-mini"],
  "anthropic-compatible": ["claude-haiku-5-5"]
};
const DEFAULT_LLM_PROMPT =
  "You are a translation engine. Translate each input item into {{targetLang}}. Preserve meaning, numbers, links, code-like tokens, placeholders like ⟪WUPAGE0⟫, and formatting. Return only a JSON array of strings in the same order.";

let settings: ExtensionSettings;
let editingProviderId: string | undefined;
let disposeLocalControl: (() => void) | undefined;
let activeProviderTest: { providerId: string; status: HTMLElement; message: string } | undefined;

void init().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

async function init(): Promise<void> {
  settings = await sendRuntimeMessage<ExtensionSettings>({ type: "GET_SETTINGS" });
  render();
  setupOcrControl(imageTranslationEnabled, () => { settings.imageTranslationEnabled = false; setImageTranslationToggle(imageTranslationEnabled, false); });
  const imageNotice = new URLSearchParams(location.search).get("imageTranslationNotice");
  if (imageNotice === "setup") setStatus("使用右键图片翻译前，请先点击扳手安装 OCR 模型，开启图片翻译并保存。");
  if (imageNotice === "refresh") setStatus("无法连接图片所在页面。请刷新刚才的网页，再右键点击图片翻译；部分嵌入页面暂不支持。");
  if (imageNotice) {
    settingsNavigation.reveal(imageTranslationEnabled);
    imageTranslationEnabled.closest(".image-feature")?.scrollIntoView?.({ block: "center" });
  }
  if (new URLSearchParams(location.search).get("pageTranslationNotice") === "refresh") {
    setStatus("无法连接网页。请刷新刚才的网页，再右键选择全文翻译。");
  }

  providerSelect.addEventListener("change", () => {
    void handleProviderAction("select", providerSelect.value);
  });
  providerEnabled.addEventListener("change", () => {
    void handleProviderAction("toggle", getEditingProvider().id);
  });
  deleteProviderButton.addEventListener("click", () => {
    void handleProviderAction("delete", getEditingProvider().id);
  });
  addProviderButton.addEventListener("click", openProviderDialog);
  cancelProviderButton.addEventListener("click", () => providerDialog.close());
  providerDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addCustomProvider();
  });
  saveButton.addEventListener("click", () => { void save().catch(() => {}); });
  restoreButton.addEventListener("click", restoreDefaults);
  providerForm.addEventListener("input", invalidateProviderTest);
  providerForm.addEventListener("change", invalidateProviderTest);
  pdfTranslationScope.addEventListener("change", updatePdfTranslationScope);
  sourceLang.addEventListener("change", updateLocalControl);
  targetLang.addEventListener("change", updateLocalControl);
}

function render(): void {
  shortcutControls.render(settings.shortcuts, settings.shortcutEnabled, settings.localShortcuts);
  appearanceControls.render(settings.appearance);
  autoTranslationControls.render(settings.autoTranslation);
  const frameTranslation = normalizeFrameTranslation(settings.frameTranslation);
  frameTranslationEnabled.checked = frameTranslation.enabled;
  frameTranslationExcluded.value = frameTranslation.excludeMatches.join("\n");
  renderLanguageOptions(targetLang, settings.targetLang, TARGET_LANGUAGES);
  renderLanguageOptions(sourceLang, settings.sourceLang, SOURCE_LANGUAGES);
  chunkSize.value = String(settings.chunkSize);
  concurrency.value = String(settings.concurrency);
  pdfTranslationScope.value = settings.pdfTranslationPageRadius === null ? "unlimited" : "nearby";
  pdfTranslationPageRadius.value = String(settings.pdfTranslationPageRadius ?? DEFAULT_SETTINGS.pdfTranslationPageRadius);
  updatePdfTranslationScope();
  cacheEnabled.checked = settings.cacheEnabled;
  const selection = normalizeSelectionTranslation(settings.selectionTranslation);
  selectionTranslationEnabled.checked = selection.enabled;
  selectionTranslationFields.disabled = !selection.enabled;
  selectionDictionary.value = selection.provider;
  selectionTriggerStyle.value = selection.style;
  setImageTranslationToggle(imageTranslationEnabled, settings.imageTranslationEnabled === true);
  translateCodeComments.checked = settings.translateCodeComments;
  translationDisplayMode.innerHTML = TRANSLATION_DISPLAY_MODES
    .map((mode) => `<option value="${mode.value}">${mode.label}</option>`)
    .join("");
  translationDisplayMode.value = settings.translationDisplayMode;
  updateTranslationDisplayModeDescription();
  renderProviderSelect();
  renderProviderForm();
}

translationDisplayMode.addEventListener("change", updateTranslationDisplayModeDescription);
selectionTranslationEnabled.addEventListener("change", () => { selectionTranslationFields.disabled = !selectionTranslationEnabled.checked; });

function updatePdfTranslationScope(): void {
  pdfTranslationPageRadiusField.hidden = pdfTranslationScope.value === "unlimited";
  pdfTranslationPageRadius.disabled = pdfTranslationPageRadiusField.hidden;
}

function updateTranslationDisplayModeDescription(): void {
  translationDisplayModeDescription.textContent = TRANSLATION_DISPLAY_MODES.find(
    (mode) => mode.value === translationDisplayMode.value
  )?.description ?? "";
}

function renderLanguageOptions(
  select: HTMLSelectElement,
  value: string,
  languages: ReadonlyArray<{ code: string; label: string }>
): void {
  const options = languages.some((entry) => entry.code === value)
    ? languages
    : [{ code: value, label: value }, ...languages];
  select.innerHTML = options
    .map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}</option>`)
    .join("");
  select.value = value;
}

function renderProviderSelect(): void {
  const activeProvider = getEditingProvider();
  providerSelect.replaceChildren(...settings.providers.map((provider) =>
    new Option(provider.enabled === false ? `${provider.label}（已停用）` : provider.label, provider.id)));
  providerSelect.value = activeProvider.id;
  providerEnabled.checked = activeProvider.enabled !== false;
  deleteProviderButton.hidden = BUILT_IN_PROVIDER_IDS.has(activeProvider.id);
  query<HTMLElement>("#disabledProviderHint").hidden = activeProvider.enabled !== false;
}

function renderProviderForm(): void {
  invalidateProviderTest();
  disposeLocalControl?.(); disposeLocalControl = undefined;
  const provider = getEditingProvider();
  providerPerformance.innerHTML = provider.type === "firefox-local"
    ? '<p class="hint">本地翻译使用固定分块大小 800、并发数 1。</p>'
    : renderProviderPerformance(provider);
  providerPerformance.querySelector("[data-field='inheritPerformance']")
    ?.addEventListener("change", updateProviderPerformanceFields);
  updateProviderPerformanceFields();
  if (provider.type === "firefox-local") {
    setProviderFormMarkup(provider, `<div class="grid"><label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label></div><div data-local-model-control></div>`);
    updateLocalControl();
    return;
  }
  if (provider.type === "google-web-translate") {
    setProviderFormMarkup(provider, `
      <div class="grid">
        <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
      </div>
      <p class="hint">使用 Google 翻译网页接口，无需 API Key。待译文本会发送到 Google。</p>
    `);
    return;
  }

  const isAnthropic = provider.type === "anthropic-compatible";
  setProviderFormMarkup(provider, `
    <div class="grid">
      <label>显示名称 <input data-field="label" type="text" value="${escapeAttr(provider.label)}" /></label>
      <label>Base URL <input data-field="baseURL" type="url" value="${escapeAttr(provider.baseURL)}" /></label>
      <label>API key（可选） <input data-field="apiKey" type="password" value="${escapeAttr(provider.apiKey)}" autocomplete="off" /></label>
      ${renderModelControl(provider)}
    </div>
    <label>系统提示词 <textarea data-field="systemPrompt">${escapeHtml(provider.systemPrompt)}</textarea></label>
    <p class="hint">接口格式：${isAnthropic ? "Anthropic Messages" : "OpenAI Chat Completions"}。</p>
  `);
}

function updateLocalControl(): void {
  const container = providerForm.querySelector<HTMLElement>("[data-local-model-control]");
  if (!container) return;
  disposeLocalControl?.();
  disposeLocalControl = setupLocalModelControl(container, sourceLang.value, targetLang.value);
}

function setProviderFormMarkup(provider: ProviderConfig, markup: string): void {
  providerForm.dataset.providerId = provider.id;
  providerForm.innerHTML = markup;
  providerForm.insertAdjacentHTML("beforeend", `<div class="provider-test-action">${renderTestButton()}</div>`);
  providerForm.insertAdjacentHTML("beforeend", '<p data-role="provider-test-status" class="hint" role="status" hidden></p>');
  providerForm.querySelector("#test")?.addEventListener("click", testProvider);
}

type ModelProvider = Extract<ProviderConfig, { model: string }>;

function renderTestButton(): string {
  return '<button id="test" type="button" class="secondary">测试服务</button>';
}

function renderModelControl(provider: ModelProvider): string {
  const suggestions = MODEL_SUGGESTIONS[provider.type];
  return `<label>模型
    <input id="providerModel" data-field="model" type="text" list="providerModelList" value="${escapeAttr(provider.model)}" autocomplete="off" spellcheck="false" />
    <datalist id="providerModelList">${suggestions.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}</datalist>
  </label>`;
}

function renderProviderPerformance(provider: ProviderConfig): string {
  const inherited = provider.performanceMode !== "custom";
  return `
    <fieldset class="provider-performance">
      <legend>当前服务：${escapeHtml(provider.label)}</legend>
      <label class="setting-toggle performance-inherit">
        <span>继承通用性能设置</span>
        <input data-field="inheritPerformance" type="checkbox" role="switch" ${inherited ? "checked" : ""} />
        <span class="setting-toggle-control" aria-hidden="true"></span>
      </label>
      <div class="grid performance-overrides" data-role="performanceOverrides" ${inherited ? "hidden" : ""}>
        <label>分块大小
          <input data-field="chunkSize" type="number" min="200" max="4000" value="${provider.chunkSize ?? settings.chunkSize}" />
        </label>
        <label>服务商并发数
          <input data-field="concurrency" type="number" min="1" max="${settings.concurrency}" value="${provider.concurrency ?? settings.concurrency}" />
        </label>
      </div>
      <p class="hint">服务商并发数不会超过通用设置中的全局最大并发数。</p>
    </fieldset>
  `;
}

function updateProviderPerformanceFields(): void {
  const inherit = providerPerformance.querySelector<HTMLInputElement>("[data-field='inheritPerformance']");
  const overrides = providerPerformance.querySelector<HTMLElement>("[data-role='performanceOverrides']");
  if (!inherit || !overrides) return;
  overrides.hidden = inherit.checked;
  overrides.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.disabled = inherit.checked;
  });
}

async function handleProviderAction(action: string, providerId: string): Promise<void> {
  try {
    if (action === "select") await selectProvider(providerId);
    if (action === "toggle") await toggleProvider(providerId);
    if (action === "delete") await deleteProvider(providerId);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function selectProvider(providerId: string): Promise<void> {
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider) return;
  invalidateProviderTest();
  settings = readSettingsFromForm();
  if (provider.enabled !== false) settings.activeProviderId = providerId;
  await persistSettings(false);
  editingProviderId = providerId;
  renderProviderSelect();
  renderProviderForm();
  setStatus(provider.enabled === false ? "已选中停用服务，可编辑配置。" : "已切换当前服务。");
}

async function toggleProvider(providerId: string): Promise<void> {
  settings = readSettingsFromForm();
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider) return;
  const nextEnabled = provider.enabled === false;
  if (!nextEnabled) {
    const hasOtherEnabled = settings.providers.some(
      (entry) => entry.id !== providerId && entry.enabled !== false
    );
    if (!hasOtherEnabled) {
      providerEnabled.checked = true;
      setStatus("至少需要启用一个翻译服务。");
      return;
    }
  }
  settings.providers = settings.providers.map((entry) =>
    entry.id === providerId ? { ...entry, enabled: nextEnabled } : entry
  );
  if (!nextEnabled && settings.activeProviderId === providerId) {
    settings.activeProviderId = settings.providers.find((entry) => entry.enabled !== false)!.id;
  }
  await persistSettings(false);
  renderProviderSelect();
  renderProviderForm();
  setStatus(nextEnabled ? "已启用服务。" : "已停用服务。");
}

async function deleteProvider(providerId: string): Promise<void> {
  if (BUILT_IN_PROVIDER_IDS.has(providerId)) return;
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider || !window.confirm(`删除“${provider.label}”？`)) return;
  settings = readSettingsFromForm();
  settings.providers = settings.providers.filter((entry) => entry.id !== providerId);
  if (settings.activeProviderId === providerId) {
    settings.activeProviderId = settings.providers.find((entry) => entry.enabled !== false)?.id
      ?? DEFAULT_SETTINGS.activeProviderId;
  }
  if (editingProviderId === providerId) editingProviderId = settings.activeProviderId;
  await persistSettings(false);
  renderProviderSelect();
  renderProviderForm();
  setStatus("已删除自定义服务。");
}

function openProviderDialog(): void {
  customProviderName.value = "";
  customLlmFormat.value = "openai";
  providerDialog.showModal();
  window.setTimeout(() => customProviderName.focus(), 0);
}

async function addCustomProvider(): Promise<void> {
  try {
    settings = readSettingsFromForm();
    const provider = createCustomProvider(customProviderName.value.trim(), customLlmFormat.value);
    settings.providers = [...settings.providers, provider];
    settings.activeProviderId = provider.id;
    await persistSettings(false);
    editingProviderId = provider.id;
    providerDialog.close();
    render();
    setStatus("已添加自定义服务，请完成配置后保存。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function createCustomProvider(name: string, llmFormat: string): ProviderConfig {
  const id = createCustomProviderId(llmFormat === "anthropic" ? "anthropic" : "openai");
  if (llmFormat === "anthropic") {
    return {
      type: "anthropic-compatible",
      id,
      label: name || "自定义 Anthropic 兼容",
      enabled: true,
      performanceMode: "custom",
      chunkSize: 3200,
      concurrency: settings.concurrency,
      baseURL: "https://api.anthropic.com",
      apiKey: "",
      model: "claude-haiku-5-5",
      systemPrompt: DEFAULT_LLM_PROMPT
    };
  }
  return {
    type: "openai-compatible",
    id,
    label: name || "自定义 OpenAI 兼容",
    enabled: true,
    performanceMode: "custom",
    chunkSize: 3200,
    concurrency: settings.concurrency,
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    systemPrompt: DEFAULT_LLM_PROMPT
  };
}

function createCustomProviderId(kind: string): string {
  return `custom-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function save(showSavedStatus = true): Promise<void> {
  try {
    settings = readSettingsFromForm();
    // Ask while the click is fresh: the active service, LLM endpoints the user filled in with a key,
    // and the opted-in sites. Untouched default entries are never requested.
    const granted = await requestOrigins([...new Set([...requiredOrigins(settings), ...settings.providers
      .filter(provider => provider.enabled !== false && "apiKey" in provider && provider.apiKey.trim())
      .flatMap(provider => providerOrigins(provider))])]);
    await persistSettings(false);
    render();
    if (showSavedStatus) setStatus(granted ? "已保存。" : "已保存，但未授予访问权限，相关服务暂时无法使用。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function persistSettings(showSavedStatus: boolean): Promise<void> {
  await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings });
  settings = await sendRuntimeMessage<ExtensionSettings>({ type: "GET_SETTINGS" });
  if (showSavedStatus) setStatus("已保存。");
}

function invalidateProviderTest(): void {
  const previous = activeProviderTest;
  activeProviderTest = undefined;
  if (!previous) return;
  previous.status.hidden = true;
  previous.status.textContent = "";
  if (previous.message && status.textContent === previous.message) setStatus("");
}

async function testProvider(): Promise<void> {
  invalidateProviderTest();
  const inlineStatus = providerForm.querySelector<HTMLElement>("[data-role='provider-test-status']");
  if (!inlineStatus) return;
  const run = { providerId: getEditingProvider().id, status: inlineStatus, message: "" };
  activeProviderTest = run;
  const isCurrent = (): boolean => activeProviderTest === run
    && getEditingProvider().id === run.providerId && run.status.isConnected;
  const report = (message: string): void => {
    if (!isCurrent()) return;
    run.message = message;
    setStatus(message);
    run.status.hidden = false;
    run.status.textContent = message;
  };
  try {
    settings = readSettingsFromForm();
    const granted = await requestOrigins(providerOrigins(settings.providers.find(provider => provider.id === run.providerId)));
    if (!granted) { report("需要先授予该服务的访问权限才能测试。"); return; }
    report("测试中...");
    await persistSettings(false);
    if (!isCurrent()) return;
    const result = await sendRuntimeMessage<{ translation: string }>({
      type: "TEST_PROVIDER",
      providerId: run.providerId
    });
    report(`测试通过：${result.translation}`);
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
  }
}

async function restoreDefaults(): Promise<void> {
  try {
    settings = cloneSettings(DEFAULT_SETTINGS);
    editingProviderId = undefined;
    await persistSettings(false);
    render();
    setStatus("已恢复默认设置。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function readSettingsFromForm(): ExtensionSettings {
  let appearance: ReturnType<typeof appearanceControls.read>;
  try { appearance = appearanceControls.read(); }
  catch (error) {
    settingsNavigation.reveal(query<HTMLElement>("#appearanceSettings"));
    query<HTMLElement>("#appearanceSettings [aria-invalid='true']").focus();
    throw error;
  }
  const editing = getEditingProvider();
  const activeProvider = {
    ...readProviderFromForm(editing),
    ...(editing.type === "firefox-local" ? { performanceMode: "custom", chunkSize: 800, concurrency: 1 }
      : readProviderPerformance())
  } as ProviderConfig;
  return {
    ...settings,
    appearance,
    shortcuts: shortcutControls.read(),
    localShortcuts: shortcutControls.readLocal(),
    shortcutEnabled: shortcutControls.readEnabled(),
    autoTranslation: autoTranslationControls.read(),
    frameTranslation: normalizeFrameTranslation({ enabled: frameTranslationEnabled.checked,
      excludeMatches: frameTranslationExcluded.value.split(/\r?\n/u) }),
    targetLang: targetLang.value.trim() || "zh-CN",
    sourceLang: sourceLang.value.trim() || "auto",
    activeProviderId: settings.activeProviderId,
    chunkSize: Number(chunkSize.value),
    concurrency: Number(concurrency.value),
    pdfTranslationPageRadius: pdfTranslationScope.value === "unlimited" ? null
      : pdfTranslationPageRadius.value === "" ? DEFAULT_SETTINGS.pdfTranslationPageRadius : Number(pdfTranslationPageRadius.value),
    cacheEnabled: cacheEnabled.checked,
    selectionTranslation: {
      enabled: selectionTranslationEnabled.checked,
      provider: selectionDictionary.value as DictionaryProvider,
      style: selectionTriggerStyle.value as SelectionTriggerStyle
    },
    imageTranslationEnabled: imageTranslationEnabled.checked,
    translateCodeComments: translateCodeComments.checked,
    translationDisplayMode: translationDisplayMode.value as ExtensionSettings["translationDisplayMode"],
    providers: settings.providers.map((provider) =>
      provider.id === activeProvider.id ? activeProvider : provider
    )
  };
}

function readProviderPerformance(): Pick<
  ProviderConfig,
  "performanceMode" | "chunkSize" | "concurrency"
> {
  const inherit = providerPerformance.querySelector<HTMLInputElement>("[data-field='inheritPerformance']");
  if (!inherit || inherit.checked) {
    return {
      performanceMode: "inherit",
      chunkSize: undefined,
      concurrency: undefined
    };
  }
  const providerChunkSize = providerPerformance.querySelector<HTMLInputElement>("[data-field='chunkSize']");
  const providerConcurrency = providerPerformance.querySelector<HTMLInputElement>("[data-field='concurrency']");
  return {
    performanceMode: "custom",
    chunkSize: Number(providerChunkSize?.value),
    concurrency: Number(providerConcurrency?.value)
  };
}

function readProviderFromForm(provider: ProviderConfig): ProviderConfig {
  const field = (name: string) =>
    providerForm.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field="${name}"]`
    )?.value ?? "";

  if (provider.type === "openai-compatible" || provider.type === "anthropic-compatible") {
    return {
      ...provider,
      label: field("label").trim() || provider.label,
      baseURL: field("baseURL").trim(),
      apiKey: field("apiKey"),
      model: field("model").trim(),
      systemPrompt: field("systemPrompt")
    };
  }
  return { ...provider, label: field("label").trim() || provider.label };
}

function getEditingProvider(): ProviderConfig {
  const provider = settings.providers.find((entry) => entry.id === editingProviderId)
    ?? settings.providers.find((entry) => entry.id === settings.activeProviderId);
  if (!provider) throw new Error("找不到当前翻译服务。");
  editingProviderId = provider.id;
  return provider;
}

function setStatus(value: string): void {
  status.textContent = value;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function cloneSettings(value: ExtensionSettings): ExtensionSettings {
  return JSON.parse(JSON.stringify(value)) as ExtensionSettings;
}
