import type { ExtensionSettings } from "../shared/types";
import { SETTINGS_KEY } from "../shared/defaults";
import { findTranslatableParagraph } from "./dom";
import { translateParagraph } from "./paragraph-translation";
import { matchesParagraphClick, normalizeLocalShortcuts } from "../shared/local-shortcuts";
import { normalizeShortcutEnabled } from "../shared/shortcuts";
import { observeParagraphMode } from "../shared/paragraph-mode";
import { sendRuntimeRequest } from "./runtime";
import { showNotice } from "./notice";

const ACTIVE_CLASS = "wupage-paragraph-active";
const HIGHLIGHT_ID = "wupage-paragraph-highlight";
const OWNED = ".wupage-translation,#wupage-selection-tools,#wupage-image-tools,#wupage-shortcut-notice";

let activeParagraph: Element | null = null;
let translating = false;
let paragraphMode = false;
let paragraphModeRevision = 0;
let started = false;
let shortcutEnabled = normalizeShortcutEnabled(undefined);
let localShortcuts = normalizeLocalShortcuts(undefined);

export function getParagraphMode(): boolean {
  return paragraphMode;
}

/** Persist the global mode (broadcast) and apply it to this document. */
export async function setParagraphMode(enabled: boolean, broadcast = true): Promise<void> {
  const revision = paragraphModeRevision;
  if (broadcast && chrome.runtime?.id) {
    await sendRuntimeRequest({ type: "SET_PARAGRAPH_MODE", enabled });
    // A storage event may already have applied this or a newer global change.
    if (revision !== paragraphModeRevision) return;
  }
  paragraphModeRevision++;
  paragraphMode = enabled;
  document.documentElement.classList.toggle("wupage-paragraph-mode", paragraphMode);
  setActiveParagraph(null);
}

export function initParagraphMode(): void {
  if (started) return;
  started = true;
  createHighlight();
  observeParagraphMode(enabled => {
    if (paragraphMode !== enabled || document.documentElement.classList.contains("wupage-paragraph-mode") !== enabled) {
      void setParagraphMode(enabled, false);
    }
  });
  const apply = (settings: ExtensionSettings): void => {
    localShortcuts = normalizeLocalShortcuts(settings.localShortcuts);
    shortcutEnabled = normalizeShortcutEnabled(settings.shortcutEnabled, settings.shortcuts, localShortcuts);
    if (!shortcutEnabled["paragraph-click"]) setActiveParagraph(null);
  };
  void sendRuntimeRequest<ExtensionSettings>({ type: "GET_SETTINGS" }).then(apply).catch(() => undefined);
  chrome.storage.onChanged.addListener((changes, area) => {
    const settings = changes[SETTINGS_KEY]?.newValue as ExtensionSettings | undefined;
    if (area === "local" && settings) apply(settings);
  });
  document.addEventListener("mousemove", handlePreview, { passive: true });
  document.addEventListener("click", handleClick, true);
  window.addEventListener("scroll", updateHighlight, { passive: true });
}

function handlePreview(event: MouseEvent): void {
  if (!paragraphMode || !shortcutEnabled["paragraph-click"]) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(OWNED)) return;
  const paragraph = findTranslatableParagraph(target);
  if (paragraph !== activeParagraph) setActiveParagraph(paragraph);
}

function handleClick(event: MouseEvent): void {
  if (!paragraphMode || !shortcutEnabled["paragraph-click"] || !matchesParagraphClick(event, localShortcuts["paragraph-click"])) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(OWNED)) return;
  const paragraph = findTranslatableParagraph(target);
  if (!paragraph) return;
  event.preventDefault();
  event.stopPropagation();
  setActiveParagraph(paragraph);
  void translateActive().catch(error => showNotice(error instanceof Error ? error.message : String(error), true));
}

async function translateActive(): Promise<void> {
  if (!activeParagraph || translating) return;
  translating = true;
  try {
    const target = activeParagraph;
    await translateParagraph(target);
    setActiveParagraph(target);
  } finally {
    translating = false;
  }
}

function createHighlight(): void {
  if (document.getElementById(HIGHLIGHT_ID)) return;
  const highlight = document.createElement("div");
  highlight.id = HIGHLIGHT_ID;
  highlight.hidden = true;
  document.documentElement.append(highlight);
}

function setActiveParagraph(paragraph: Element | null): void {
  activeParagraph?.classList.remove(ACTIVE_CLASS);
  activeParagraph = paragraph;
  activeParagraph?.classList.add(ACTIVE_CLASS);
  updateHighlight();
}

function updateHighlight(): void {
  const highlight = document.getElementById(HIGHLIGHT_ID);
  if (!highlight) return;
  if (!paragraphMode || !activeParagraph || !document.documentElement.contains(activeParagraph)) {
    highlight.hidden = true;
    return;
  }
  const rect = activeParagraph.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    highlight.hidden = true;
    return;
  }
  highlight.hidden = false;
  highlight.style.left = `${Math.max(0, rect.left - 4)}px`;
  highlight.style.top = `${Math.max(0, rect.top - 4)}px`;
  highlight.style.width = `${rect.width + 8}px`;
  highlight.style.height = `${rect.height + 8}px`;
}
