import { sendRuntimeRequest } from "./runtime";
import { hasPageTranslations } from "./dom";
import { getPageTranslationState } from "./page-translation";

let lastTranslated: boolean | undefined;

/** Keep the browser menu in sync without sending a message for each batch. */
export function refreshPageContextState(translated: boolean): void {
  if (translated === lastTranslated) return;
  lastTranslated = translated;
  void sendRuntimeRequest({ type: "PAGE_TRANSLATION_STATE_CHANGED" }).catch(() => undefined);
}

/** Report whether this page currently shows translations (page state or paragraph cards). */
export function refreshTranslationState(): void {
  refreshPageContextState(getPageTranslationState().active || hasPageTranslations());
}
