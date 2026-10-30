import { sendRuntimeMessage, sendTabMessage } from "../shared/messaging";
import { documentOrigin, requestOrigins, requiredOrigins } from "../shared/access";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../shared/languages";
import { TRANSLATION_DISPLAY_MODES } from "../shared/display-modes";
import type { ExtensionSettings } from "../shared/types";
import "./styles.css";
import "../shared/appearance.css";
import { setupAppearance } from "../shared/appearance-runtime";
import { setImageTranslationToggle, setupOcrControl } from "../shared/ocr-control";
import { getExtensionDetailsUrl, isLikelyPdfUrl, openPdfWorkspaceInNewTab } from "../pdf/launch";
import { localProviderNotice } from "../shared/local-notice";
import { enhanceProviderSelect } from "../shared/provider-picker";
import { addAutoTranslationWebsite, currentWebsitePattern, excludeAutoTranslationWebsite, hasAutoTranslationWebsite, normalizeAutoTranslation, setAutoTranslationEnabled } from "../shared/auto-translation";
import { normalizeSelectionTranslation } from "../shared/dictionary";
import { SETTINGS_KEY } from "../shared/defaults";
import { doubaoProviderNotice, isDoubaoProviderUnavailable, syncDoubaoTargetControls } from "../shared/doubao-ui";
import { renderUiIcons, uiIconMarkup } from "../shared/ui-icons";
import { createSettingsSnapshot } from "../shared/settings-snapshot";
import { observeParagraphMode } from "../shared/paragraph-mode";
import { normalizeVideoTranslation } from "../shared/video";
import { normalizeAppearance } from "../shared/appearance";
import { applyPopupMenuLayout } from "../shared/popup-menu";
import { paragraphClickHint } from "../shared/local-shortcuts";

renderUiIcons();

const targetLang = query<HTMLSelectElement>("#targetLang");
const sourceLang = query<HTMLSelectElement>("#sourceLang");
const provider = query<HTMLSelectElement>("#provider");
const translationDisplayMode = query<HTMLSelectElement>("#translationDisplayMode");
const status = query<HTMLParagraphElement>("#status");
const pageToggleButton = query<HTMLButtonElement>("#pageToggle");
const openPdfWorkspaceButton = query<HTMLButtonElement>("#openPdfWorkspace");
const videoTranslationButton = query<HTMLButtonElement>("#videoTranslation");
const fileAccessHelp = query<HTMLDivElement>("#fileAccessHelp");
const openFileAccessSettingsButton = query<HTMLButtonElement>("#openFileAccessSettings");
const paragraphModeButton = query<HTMLButtonElement>("#paragraphMode");
const paragraphModeHint = query<HTMLSpanElement>("#paragraphModeHint");
const contextMenuTranslationButton = query<HTMLButtonElement>("#contextMenuTranslation");
const autoTranslationButton = query<HTMLButtonElement>("#autoTranslation");
const addAutoTranslationSiteButton = query<HTMLButtonElement>("#addAutoTranslationSite");
const selectionTranslationButton = query<HTMLButtonElement>("#selectionTranslation");
const imageTranslationButton = query<HTMLButtonElement>("#imageTranslation");
const clearCacheButton = query<HTMLButtonElement>("#clearCache");
const optionsButton = query<HTMLButtonElement>("#openOptions");
const githubButton = query<HTMLButtonElement>("#openGithub");
const websiteButton = query<HTMLButtonElement>("#openWebsite");
const GITHUB_URL = "https://github.com/mr-wuliu/wupage";
const WEBSITE_URL = "https://wupage.mrwuliu.top/";

let settings: ExtensionSettings;
let paragraphMode = false;
let paragraphModeRevision = 0;
let paragraphModeAvailable = true;
let paragraphModeError: string | undefined;
let autoTranslationNotice: string | undefined;
let pageTranslated = false;
let pageActionVersion = 0;
let activeTabIsPdf = false;
let activePageURL: string | undefined;
let pageTranslationAvailable = true;
let settingsReady = false;
let settingsSave: Promise<unknown> = Promise.resolve();
const settingsSnapshot = createSettingsSnapshot(() => sendRuntimeMessage<ExtensionSettings>({ type: "GET_SETTINGS" }));

void init().catch((error: unknown) => {
  pageTranslationAvailable = false;
  updatePageActionAvailability();

  setStatus(error instanceof Error ? error.message : String(error));
});

async function init(): Promise<void> {
  const stopParagraphMode = observeParagraphMode(enabled => {
    paragraphModeRevision++;
    paragraphMode = enabled;
    updateParagraphModeButton();
  });
  window.addEventListener("pagehide", stopParagraphMode, { once: true });
  chrome.storage?.onChanged?.addListener(settingsChanged);
  window.addEventListener("pagehide", () => chrome.storage?.onChanged?.removeListener?.(settingsChanged), { once: true });
  openFileAccessSettingsButton.addEventListener("click", () => {
    void chrome.tabs.create({ url: getExtensionDetailsUrl(chrome.runtime.id, navigator.userAgent) })
      .then(() => window.close()).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
  });
  // Manual selection works even when file access hides the active tab's URL.
  openPdfWorkspaceButton.addEventListener("click", () => {
    void openPdfWorkspaceInNewTab(
      (properties) => chrome.tabs.create(properties),
      (path) => chrome.runtime.getURL(path)
    ).then(() => window.close()).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  });
  settings = await settingsSnapshot.read();
  setupAppearance(settings.appearance);
  renderLanguageOptions(sourceLang, settings.sourceLang, SOURCE_LANGUAGES);
  renderLanguageOptions(targetLang, settings.targetLang, TARGET_LANGUAGES);
  provider.innerHTML = settings.providers
    .filter((entry) => entry.enabled !== false)
    .map((entry) => `<option value="${escapeHtml(entry.id)}" ${isDoubaoProviderUnavailable(entry) ? 'disabled title="此浏览器暂不支持豆包翻译"' : ""}>${escapeHtml(entry.label)}</option>`)
    .join("");
  provider.value = settings.activeProviderId;
  enhanceProviderSelect(provider, settings.providers);
  syncDoubaoTargetControls(settings, targetLang);
  updateLocalNotice();
  translationDisplayMode.innerHTML = TRANSLATION_DISPLAY_MODES
    .map((mode) => `<option value="${mode.value}">${mode.label}</option>`)
    .join("");
  const pointerMedia = window.matchMedia?.("(any-hover: none) and (any-pointer: coarse)");
  const updateParagraphVisibility = () => {
    paragraphModeButton.hidden = pointerMedia?.matches === true;
    refreshMenuLayout();
    updateParagraphModeButton();
  };
  updateParagraphVisibility();
  pointerMedia?.addEventListener("change", updateParagraphVisibility);
  window.addEventListener("pagehide", () => pointerMedia?.removeEventListener("change", updateParagraphVisibility), { once: true });
  translationDisplayMode.value = settings.translationDisplayMode;
  updateAutoTranslationButton();
  autoTranslationButton.addEventListener("click", toggleAutoTranslation);
  addAutoTranslationSiteButton.addEventListener("click", toggleCurrentAutoTranslationSite);
  updateSelectionTranslationButton();
  selectionTranslationButton.addEventListener("click", toggleSelectionTranslation);
  selectionTranslationButton.disabled = false;
  setImageTranslationToggle(imageTranslationButton, settings.imageTranslationEnabled === true);
  setupOcrControl(imageTranslationButton, () => { settings.imageTranslationEnabled = false; setImageTranslationToggle(imageTranslationButton, false); });
  settingsReady = true;
  applyPopupSettings(settingsSnapshot.current() ?? settings);
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activePageURL = activeTab?.url;
  updateAutoTranslationSiteButton();
  fileAccessHelp.hidden = Boolean(activeTab?.url);
  activeTabIsPdf = isLikelyPdfUrl(activeTab?.url);
  pageTranslationAvailable = activeTabIsPdf || isSupportedPageUrl(activeTab?.url);
  if (pageTranslationAvailable && !activeTabIsPdf) {
    await loadParagraphMode();
    await loadTranslationState();
  } else if (!pageTranslationAvailable) {
    paragraphModeAvailable = false;
    paragraphModeButton.title = "浏览器设置页和扩展内部页面不支持段落模式。";
    pageToggleButton.title = "请切换到普通网页后再翻译。";
    setStatus(activeTab?.url
      ? "此页面不支持翻译，请切换到网页或 PDF。"
      : "无法读取当前页面地址。若为本地 PDF，请开启扩展的文件访问权限，或点击“打开 PDF”选择文件。");
  }
  if (activeTabIsPdf) {
    paragraphModeAvailable = false;
    paragraphModeButton.title = "PDF 使用独立的双栏翻译页面。";
    updatePageToggleButton();
  }
  updatePageActionAvailability();

  const saveSelection = () => { void savePopupSettings().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error))); };
  targetLang.addEventListener("change", saveSelection);
  sourceLang.addEventListener("change", saveSelection);
  provider.addEventListener("change", saveSelection);
  pageToggleButton.addEventListener("click", togglePageTranslation);
  videoTranslationButton.addEventListener("click", toggleVideoTranslation);
  videoTranslationButton.disabled = false;
  translationDisplayMode.addEventListener("change", saveSelection);
  paragraphModeButton.addEventListener("click", toggleParagraphMode);
  contextMenuTranslationButton.addEventListener("click", toggleContextMenuTranslation);
  updateContextMenuTranslationButton();
  translationDisplayMode.disabled = false;
  contextMenuTranslationButton.disabled = false;
  imageTranslationButton.addEventListener("click", async () => {
    const previous = settings.imageTranslationEnabled === true;
    if (!previous && !await authorize({ ...settings, imageTranslationEnabled: true })) return;
    setButtonBusy(imageTranslationButton, true);
    try {
      await updatePopupSettings({ imageTranslationEnabled: !previous });
      setStatus(!previous ? "图片翻译已开启，点击图片旁的“译”按钮即可覆盖翻译。" : "图片翻译已关闭，已恢复原图。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setButtonBusy(imageTranslationButton, false);
    }
  });
  clearCacheButton.addEventListener("click", clearCache);
  optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  githubButton.addEventListener("click", () => {
    void chrome.tabs.create({ url: GITHUB_URL });
  });
  websiteButton.addEventListener("click", () => {
    void chrome.tabs.create({ url: WEBSITE_URL });
  });
  let syncing = false;
  const timer = !activeTabIsPdf && pageTranslationAvailable && activeTab?.id
    ? window.setInterval(() => {
      if (syncing || pageToggleButton.getAttribute("aria-busy") === "true") return;
      syncing = true;
      const version = pageActionVersion;
      void sendTabMessage<{ translated: boolean }>(activeTab.id!, { type: "GET_TRANSLATION_STATE" }).then(result => {
        if (version !== pageActionVersion || pageToggleButton.getAttribute("aria-busy") === "true") return;
        if (pageTranslated !== result.translated) { pageTranslated = result.translated; updatePageToggleButton(); }
      }).catch(() => {}).finally(() => { syncing = false; });
    }, 500) : undefined;
  window.addEventListener("pagehide", () => {
    if (timer !== undefined) clearInterval(timer);
  }, { once: true });
}

async function savePopupSettings(): Promise<void> {
  syncLanguageValue(sourceLang);
  syncLanguageValue(targetLang);
  const patch: Partial<ExtensionSettings> = {};
  if (sourceLang.value !== settings.sourceLang) patch.sourceLang = sourceLang.value || "auto";
  if (targetLang.value !== settings.targetLang) patch.targetLang = targetLang.value || "zh-CN";
  if (provider.value !== settings.activeProviderId) patch.activeProviderId = provider.value;
  if (translationDisplayMode.value !== settings.translationDisplayMode) {
    patch.translationDisplayMode = translationDisplayMode.value as ExtensionSettings["translationDisplayMode"];
  }
  // Capture the newest control selection while earlier saves are still queued.
  settings = { ...settings, ...patch };
  syncDoubaoTargetControls(settings, targetLang);
  await updatePopupSettings(patch);
}

function settingsChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  const incoming = changes[SETTINGS_KEY]?.newValue as ExtensionSettings | undefined;
  if (area !== "local" || !incoming) return;
  settingsSnapshot.receive(incoming);
  if (settingsReady) applyPopupSettings(incoming);
}

function applyPopupSettings(incoming: ExtensionSettings): void {
  settings = incoming;
  refreshMenuLayout();
  if (sourceLang.value !== settings.sourceLang) renderLanguageOptions(sourceLang, settings.sourceLang, SOURCE_LANGUAGES);
  if (targetLang.value !== settings.targetLang) renderLanguageOptions(targetLang, settings.targetLang, TARGET_LANGUAGES);
  const providers = settings.providers.filter(entry => entry.enabled !== false);
  const signature = JSON.stringify(providers.map(({ id, label, type }) => [id, label, type]));
  if (provider.dataset.options !== signature || provider.value !== settings.activeProviderId) {
    provider.replaceChildren(...providers.map(entry => {
      const option = new Option(entry.label, entry.id);
      option.disabled = isDoubaoProviderUnavailable(entry);
      return option;
    }));
    if (!providers.some(entry => entry.id === settings.activeProviderId)) {
      const unavailable = new Option("当前服务不可用，请选择其他服务", settings.activeProviderId);
      unavailable.disabled = true;
      provider.prepend(unavailable);
    }
    provider.dataset.options = signature;
    provider.value = settings.activeProviderId;
    enhanceProviderSelect(provider, settings.providers);
  }
  if (translationDisplayMode.value !== settings.translationDisplayMode) translationDisplayMode.value = settings.translationDisplayMode;
  if (paragraphModeButton.getAttribute("aria-busy") !== "true") updateParagraphModeButton();
  if (videoTranslationButton.getAttribute("aria-busy") !== "true") updateVideoTranslationButton();
  if (contextMenuTranslationButton.getAttribute("aria-busy") !== "true") updateContextMenuTranslationButton();
  if (autoTranslationButton.getAttribute("aria-busy") !== "true") updateAutoTranslationButton();
  if (selectionTranslationButton.getAttribute("aria-busy") !== "true") updateSelectionTranslationButton();
  if (imageTranslationButton.getAttribute("aria-busy") !== "true") setImageTranslationToggle(imageTranslationButton, settings.imageTranslationEnabled === true);
  syncDoubaoTargetControls(settings, targetLang);
  updateLocalNotice();
}

function updatePopupSettings(change: Partial<ExtensionSettings> | ((previous: ExtensionSettings) => Partial<ExtensionSettings>)): Promise<void> {
  const save = settingsSave.catch(() => undefined).then(async () => {
    const previous = await settingsSnapshot.read();
    const patch = typeof change === "function" ? change(previous) : change;
    try {
      await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: { ...previous, ...patch } });
      applyPopupSettings(await settingsSnapshot.read());
    } catch (error) {
      applyPopupSettings(settingsSnapshot.current() ?? previous);
      throw error;
    }
  });
  settingsSave = save;
  return save;
}

function updateLocalNotice(): void {
  let notice = document.getElementById("localProviderNotice");
  const message = localProviderNotice(settings) ?? doubaoProviderNotice(settings);
  if (!notice && message) {
    notice = document.createElement("p"); notice.id = "localProviderNotice";
    notice.setAttribute("role", "status"); notice.style.cssText = "line-height:1.6;font-size:12px;padding:10px;border:1px solid #c7a557;border-radius:8px";
    provider.closest("label")?.after(notice);
  }
  if (notice) { notice.textContent = message ?? ""; notice.hidden = !message; }
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
  syncLanguageValue(select);
}

function syncLanguageValue(select: HTMLSelectElement): void {
  const label = select.parentElement?.querySelector<HTMLElement>(".language-value");
  if (label) label.textContent = select.selectedOptions[0]?.textContent ?? select.value;
}

/** Request host access for the saved settings (plus extra origins) from the current click. */
async function authorize(projected: ExtensionSettings, ...extra: Array<string | undefined>): Promise<boolean> {
  const granted = await requestOrigins([...requiredOrigins(projected), ...extra.filter((origin): origin is string => !!origin)]);
  if (!granted) setStatus("没有获得访问权限，该功能暂不可用。");
  return granted;
}

async function togglePageTranslation(): Promise<void> {
  if (!pageTranslationAvailable) {
    setStatus("此页面不支持翻译，请切换到普通网页。");
    return;
  }
  // Ask for host access first: the browser only shows its prompt while this click is fresh.
  const chosen = { ...settings, activeProviderId: provider.value || settings.activeProviderId };
  if (!pageTranslated && !await authorize(chosen, activeTabIsPdf ? documentOrigin(activePageURL) : undefined)) return;
  if (activeTabIsPdf) {
    setPageToggleBusy(true);
    setStatus("正在打开 PDF 并开始翻译...");
    try {
      await openPdfTranslator();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setPageToggleBusy(false);
    }
    return;
  }
  const previous = pageTranslated;
  const version = ++pageActionVersion;
  const request = { type: previous ? "CLEAR_TRANSLATION" : "TRANSLATE_PAGE" } as const;
  pageTranslated = !previous;
  updatePageToggleButton();
  setPageToggleBusy(request.type === "TRANSLATE_PAGE", true);
  setStatus(request.type === "TRANSLATE_PAGE" ? "正在翻译..." : "正在显示原文...");
  try {
    // Stop immediately even when the original settings save or page request is
    // still pending. Its late completion must not restart or repaint the action.
    if (request.type === "TRANSLATE_PAGE") await savePopupSettings();
    if (version !== pageActionVersion) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (version !== pageActionVersion) return;
    if (!tab.id) throw new Error("没有活动标签页。");
    const result = await sendTabMessage<{
      translated?: number;
      cached?: number;
      failed?: number;
      error?: string;
      remaining?: number;
      pending?: number;
      cancelled?: boolean;
      cleared?: boolean;
    }>(
      tab.id,
      request
    );
    if (version !== pageActionVersion) return;
    if (request.type === "CLEAR_TRANSLATION") {
      setStatus(result.cleared ? "已显示原文。" : "没有可清除的译文。");
    } else if (result.cancelled) {
      setStatus("页面或翻译状态已变化，本次翻译已取消。");
      await loadTranslationState();
    } else {
      const failed = result.failed ?? 0;
      setStatus(
        failed > 0
          ? `已翻译 ${result.translated ?? 0} 段，失败 ${failed} 段：${result.error ?? ""}`
          : result.pending
            ? "正在翻译当前区域，后续内容将自动继续翻译。"
            : result.remaining
              ? `已翻译当前区域 ${result.translated ?? 0} 段，滚动页面将继续翻译。`
              : result.translated
                ? `已翻译 ${result.translated} 段，缓存命中 ${result.cached ?? 0} 段。`
                : "当前区域暂无可翻译内容，新内容加载后将自动翻译。"
      );
    }
  } catch (error) {
    if (version !== pageActionVersion) return;
    pageTranslated = previous;
    updatePageToggleButton();
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    if (version === pageActionVersion) setPageToggleBusy(false);
  }
}

function setButtonBusy(button: HTMLButtonElement | HTMLSelectElement, value: boolean): void {
  button.disabled = value;
  button.setAttribute("aria-busy", String(value));
  if (!value && settingsReady) applyPopupSettings(settingsSnapshot.current() ?? settings);
}

async function openPdfTranslator(): Promise<void> {
  await savePopupSettings();
  const pageUrl = new URL(chrome.runtime.getURL("pdf.html"));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && isLikelyPdfUrl(tab.url)) {
    pageUrl.searchParams.set("url", tab.url);
    pageUrl.searchParams.set("translate", "1");
  }
  await chrome.tabs.create({ url: pageUrl.toString() });
  window.close();
}

function isSupportedPageUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function setPageToggleBusy(value: boolean, cancellable = false): void {
  pageToggleButton.disabled = (value && !cancellable) || !pageTranslationAvailable;
  pageToggleButton.classList.toggle("is-loading", value);
  pageToggleButton.setAttribute("aria-busy", String(value));
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

async function loadParagraphMode(): Promise<void> {
  const revision = paragraphModeRevision;
  try {
    const result = await sendRuntimeMessage<{ enabled: boolean }>({ type: "GET_PARAGRAPH_MODE" });
    if (revision === paragraphModeRevision) paragraphMode = result.enabled;
    paragraphModeButton.removeAttribute("title");
    updateParagraphModeButton();
  } catch (error) {
    // A missing/old content script is a connection state, not a capability
    // verdict. Keep the button enabled so a later attempt can reconnect.
    paragraphModeError = error instanceof Error ? error.message : String(error);
    paragraphModeButton.title = paragraphModeError;
    setStatus(paragraphModeError);
  }
}

async function loadTranslationState(): Promise<void> {
  const version = pageActionVersion;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;
    const result = await sendTabMessage<{ translated: boolean }>(tab.id, {
      type: "GET_TRANSLATION_STATE"
    });
    if (version !== pageActionVersion) return;
    pageTranslated = result.translated;
    updatePageToggleButton();
  } catch {
    if (version !== pageActionVersion) return;
    pageTranslated = false;
    updatePageToggleButton();
  }
}

async function toggleAutoTranslation(): Promise<void> {
  if (autoTranslationNotice && status.textContent === autoTranslationNotice) setStatus("");
  autoTranslationNotice = undefined;
  const enabled = autoTranslationButton.getAttribute("aria-pressed") !== "true";
  if (enabled && !await authorize({ ...settings, autoTranslation: setAutoTranslationEnabled(normalizeAutoTranslation(settings.autoTranslation), true) })) return;
  setButtonBusy(autoTranslationButton, true);
  updateAutoTranslationSiteButton();
  try {
    await updatePopupSettings(latest => ({ autoTranslation: setAutoTranslationEnabled(normalizeAutoTranslation(latest.autoTranslation), enabled) }));
    updateAutoTranslationButton();
    const rules = settings.autoTranslation!;
    if (enabled && !rules.nonTargetLanguage && !rules.presetSites.length && !rules.customSites.some(site => site.enabled)) {
      autoTranslationNotice = "自动翻译已开启，请在设置中启用站点或语言规则。";
      setStatus(autoTranslationNotice);
    }
  } catch (error) {
    updateAutoTranslationButton();
    autoTranslationNotice = error instanceof Error ? error.message : String(error);
    setStatus(autoTranslationNotice);
  } finally {
    setButtonBusy(autoTranslationButton, false);
    updateAutoTranslationSiteButton();
  }
}

function updateAutoTranslationButton(): void {
  const rules = normalizeAutoTranslation(settings.autoTranslation);
  if (autoTranslationButton.getAttribute("aria-pressed") !== String(rules.enabled)) autoTranslationButton.setAttribute("aria-pressed", String(rules.enabled));
  const title = rules.nonTargetLanguage ? "自动翻译非目标语言页面；可在设置中限定站点" : "按已配置的站点规则自动翻译";
  if (autoTranslationButton.title !== title) autoTranslationButton.title = title;
  if (autoTranslationButton.hasAttribute("data-loading")) {
    void autoTranslationButton.offsetWidth;
    autoTranslationButton.removeAttribute("data-loading");
    autoTranslationButton.disabled = false;
  }
  updateAutoTranslationSiteButton();
}

function updateAutoTranslationSiteButton(): void {
  const enabled = normalizeAutoTranslation(settings.autoTranslation).enabled;
  const pattern = currentWebsitePattern(activePageURL);
  const added = hasAutoTranslationWebsite(settings.autoTranslation, activePageURL);
  if (addAutoTranslationSiteButton.hidden !== !enabled) addAutoTranslationSiteButton.hidden = !enabled;
  const disabled = !pattern || autoTranslationButton.getAttribute("aria-busy") === "true"
    || addAutoTranslationSiteButton.getAttribute("aria-busy") === "true";
  if (addAutoTranslationSiteButton.disabled !== disabled) addAutoTranslationSiteButton.disabled = disabled;
  const icon = added ? "tick" : "plus";
  if (addAutoTranslationSiteButton.querySelector("svg")?.dataset.icon !== icon) addAutoTranslationSiteButton.innerHTML = uiIconMarkup(icon);
  if (addAutoTranslationSiteButton.getAttribute("aria-pressed") !== String(added)) addAutoTranslationSiteButton.setAttribute("aria-pressed", String(added));
  const label = !pattern ? "请切换到普通网页后再添加网站" : added ? `将 ${pattern} 排除自动翻译` : `将 ${pattern} 加入自动翻译列表`;
  if (addAutoTranslationSiteButton.title !== label) addAutoTranslationSiteButton.title = label;
  if (addAutoTranslationSiteButton.getAttribute("aria-label") !== label) addAutoTranslationSiteButton.setAttribute("aria-label", label);
}

async function toggleCurrentAutoTranslationSite(): Promise<void> {
  if (addAutoTranslationSiteButton.disabled) return;
  const include = addAutoTranslationSiteButton.getAttribute("aria-pressed") !== "true";
  if (include && !await authorize({ ...settings, autoTranslation: addAutoTranslationWebsite(settings.autoTranslation, activePageURL) })) return;
  if (autoTranslationNotice && status.textContent === autoTranslationNotice) setStatus("");
  autoTranslationNotice = undefined;
  setButtonBusy(addAutoTranslationSiteButton, true);
  setButtonBusy(autoTranslationButton, true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activePageURL = tab?.url;
    await updatePopupSettings(latest => ({ autoTranslation: include ? addAutoTranslationWebsite(latest.autoTranslation, activePageURL) : excludeAutoTranslationWebsite(latest.autoTranslation, activePageURL) }));
    autoTranslationNotice = include ? `已将 ${currentWebsitePattern(activePageURL)} 加入自动翻译列表。` : `已将 ${currentWebsitePattern(activePageURL)} 排除自动翻译。`;
  } catch (error) {
    autoTranslationNotice = error instanceof Error ? error.message : String(error);
  } finally {
    setButtonBusy(autoTranslationButton, false);
    setButtonBusy(addAutoTranslationSiteButton, false);
    updateAutoTranslationButton();
    if (autoTranslationNotice) setStatus(autoTranslationNotice);
  }
}

async function toggleSelectionTranslation(): Promise<void> {
  const enabled = selectionTranslationButton.getAttribute("aria-pressed") !== "true";
  if (enabled && !await authorize({ ...settings, selectionTranslation: { ...normalizeSelectionTranslation(settings.selectionTranslation), enabled } })) return;
  setButtonBusy(selectionTranslationButton, true);
  try {
    await updatePopupSettings(latest => ({ selectionTranslation: { ...normalizeSelectionTranslation(latest.selectionTranslation), enabled } }));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    updateSelectionTranslationButton();
    setButtonBusy(selectionTranslationButton, false);
  }
}

function updateSelectionTranslationButton(): void {
  const value = String(normalizeSelectionTranslation(settings.selectionTranslation).enabled);
  if (selectionTranslationButton.getAttribute("aria-pressed") !== value) selectionTranslationButton.setAttribute("aria-pressed", value);
}

async function toggleParagraphMode(): Promise<void> {
  const revision = paragraphModeRevision;
  const enabled = !paragraphMode;
  setButtonBusy(paragraphModeButton, true);
  if (paragraphModeError && status.textContent === paragraphModeError) setStatus("");
  paragraphModeError = undefined;
  try {
    if (!paragraphModeAvailable) throw new Error("此页面不支持段落模式。");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有活动标签页。");
    const result = await sendTabMessage<{ enabled: boolean }>(tab.id, { type: "SET_PARAGRAPH_MODE", enabled });
    if (revision === paragraphModeRevision) paragraphMode = result.enabled;
    paragraphModeButton.removeAttribute("title");
  } catch (error) {
    paragraphModeError = error instanceof Error ? error.message : String(error);
    setStatus(paragraphModeError);
  } finally {
    updateParagraphModeButton();
    setButtonBusy(paragraphModeButton, false);
  }
}

async function toggleContextMenuTranslation(): Promise<void> {
  const previous = settings.contextMenuTranslationEnabled === true;
  setButtonBusy(contextMenuTranslationButton, true);
  try {
    await updatePopupSettings({ contextMenuTranslationEnabled: !previous });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    updateContextMenuTranslationButton();
    setButtonBusy(contextMenuTranslationButton, false);
  }
}

function updateContextMenuTranslationButton(): void {
  const value = String(settings.contextMenuTranslationEnabled === true);
  if (contextMenuTranslationButton.getAttribute("aria-pressed") !== value) contextMenuTranslationButton.setAttribute("aria-pressed", value);
}

async function clearCache(): Promise<void> {
  setButtonBusy(clearCacheButton, true);
  setStatus("正在清除缓存...");
  try {
    const result = await sendRuntimeMessage<{ removed: number }>({
      type: "CLEAR_CACHE"
    });
    setStatus(`已清除 ${result.removed} 条缓存。`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    setButtonBusy(clearCacheButton, false);
  }
}

function refreshMenuLayout(): void {
  applyPopupMenuLayout(document, normalizeAppearance(settings.appearance).popupMenu);
  document.querySelector(".popup")?.removeAttribute("data-menu-loading");
}

function updateVideoTranslationButton(): void {
  const value = String(normalizeVideoTranslation(settings.videoTranslation).enabled);
  if (videoTranslationButton.getAttribute("aria-pressed") !== value) videoTranslationButton.setAttribute("aria-pressed", value);
  videoTranslationButton.removeAttribute("data-loading");
}

async function toggleVideoTranslation(): Promise<void> {
  const enabled = !normalizeVideoTranslation(settings.videoTranslation).enabled;
  setButtonBusy(videoTranslationButton, true);
  try {
    await updatePopupSettings(latest => ({ videoTranslation: { ...normalizeVideoTranslation(latest.videoTranslation), enabled } }));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    updateVideoTranslationButton();
    setButtonBusy(videoTranslationButton, false);
  }
}

function updateParagraphModeButton(): void {
  const hint = paragraphClickHint(settings.localShortcuts, settings.shortcutEnabled?.["paragraph-click"] !== false);
  if (paragraphModeHint.textContent !== hint) paragraphModeHint.textContent = hint;
  const value = String(paragraphMode);
  if (paragraphModeButton.getAttribute("aria-pressed") !== value) paragraphModeButton.setAttribute("aria-pressed", value);
  const hideHint = !paragraphMode || paragraphModeButton.hidden || paragraphModeButton.hasAttribute("data-popup-menu-hidden");
  if (paragraphModeHint.hidden !== hideHint) paragraphModeHint.hidden = hideHint;
}

function updatePageToggleButton(): void {
  const label = activeTabIsPdf
    ? "翻译PDF"
    : pageTranslated ? "显示全文" : "翻译全文";
  if (pageToggleButton.textContent !== label) pageToggleButton.textContent = label;
}

function updatePageActionAvailability(): void {
  pageToggleButton.disabled = !pageTranslationAvailable;
  paragraphModeButton.disabled = !paragraphModeAvailable;
}
