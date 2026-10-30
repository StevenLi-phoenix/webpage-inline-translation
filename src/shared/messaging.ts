import type { RuntimeRequest, RuntimeResponse } from "./types";
import { restoreRuntimeError } from "./errors";

export async function sendRuntimeMessage<T = unknown>(request: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse | undefined;
  if (!response) throw new Error("No response from extension runtime.");
  if (!response.ok) throw restoreRuntimeError(response);
  return response.data as T;
}

/** Questions the popup asks on open; they must never cause a page to be injected. */
const QUERY_ONLY = new Set<RuntimeRequest["type"]>(["GET_TRANSLATION_STATE"]);
const NO_RECEIVER = /receiving end does not exist|could not establish connection|message port closed|extension context invalidated/iu;

/**
 * Send an action to the page. A page nobody has acted on has no content script yet, so the
 * background injects it (the click that got us here granted `activeTab`) and the call is retried once.
 */
export async function sendTabMessage<T = unknown>(
  tabId: number,
  request: RuntimeRequest
): Promise<T> {
  let response: RuntimeResponse | undefined;
  const attempt = async (): Promise<RuntimeResponse | undefined> =>
    (await chrome.tabs.sendMessage(tabId, request, { frameId: 0 })) as RuntimeResponse | undefined;
  try {
    try {
      response = await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (QUERY_ONLY.has(request.type) || !NO_RECEIVER.test(message) || !chrome.runtime?.sendMessage) throw error;
      await sendRuntimeMessage({ type: "ENSURE_CONTENT", tabId });
      response = await attempt();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (NO_RECEIVER.test(message)) throw new Error(PAGE_CONNECTION_MESSAGE);
    throw error;
  }
  if (!response) throw new Error(PAGE_CONNECTION_MESSAGE);
  if (!response.ok) throw restoreRuntimeError(response);
  return response.data as T;
}

const PAGE_CONNECTION_MESSAGE = "无法连接到当前网页。该页面可能不允许扩展访问，或扩展刚更新，请刷新网页后重试。";
