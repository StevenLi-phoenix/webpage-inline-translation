import { VIDEO_PLATFORMS } from "../video/platforms";
import { AUTO_TRANSLATION_PRESETS, normalizeSitePattern } from "./auto-translation";
import type { ExtensionSettings, ProviderConfig } from "./types";

/** Match patterns for "every website"; granted only when the user opts in. */
export const ALL_SITES = ["http://*/*", "https://*/*"];

/** Hosts the offline-model installers download from. */
export const LOCAL_MODEL_ORIGINS = ["https://firefox-settings-attachments.cdn.mozilla.net/*"];
export const OCR_MODEL_ORIGINS = ["https://paddle-model-ecology.bj.bcebos.com/*"];
const GOOGLE_ORIGINS = ["https://translate.googleapis.com/*"];

/** `https://host/*` for an http(s) URL; undefined for anything else (file:, chrome:, data:…). */
export function originPattern(address: string | undefined): string | undefined {
  try {
    const url = new URL(address ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? `${url.protocol}//${url.hostname}/*` : undefined;
  } catch { return undefined; }
}

/** Host access needed to read the page itself from an extension tab (e.g. a PDF address). */
export function documentOrigin(address: string | undefined): string | undefined {
  return address?.startsWith("file:") ? "file:///*" : originPattern(address);
}

/** Ask for host access, then fetch from an extension page; prompts only if it was not granted yet. */
export async function fetchWithAccess(url: string, init?: RequestInit): Promise<Response> {
  const origin = documentOrigin(url);
  if (origin && !(await hasOrigins([origin]))) await requestOrigins([origin]);
  return fetch(url, init);
}

/** Origins the background must reach to translate with this provider. */
export function providerOrigins(provider: ProviderConfig | undefined): string[] {
  if (!provider) return [];
  if (provider.type === "google-web-translate") return GOOGLE_ORIGINS;
  if (provider.type === "openai-compatible" || provider.type === "anthropic-compatible") {
    const origin = originPattern(provider.baseURL);
    return origin ? [origin] : [];
  }
  return [];
}

/** Match patterns for one auto-translation / video site rule (domain, subdomains and `*.` wildcards). */
export function sitePatternToMatches(pattern: string): string[] {
  let normalized: string;
  try { normalized = normalizeSitePattern(pattern); } catch { return []; }
  const protocol = /^(https?):\/\//u.exec(normalized)?.[1];
  const scheme = protocol ?? "*";
  const host = normalized.replace(/^https?:\/\//u, "").split("/")[0].replace(/:\d+$/u, "");
  if (host.startsWith("*.")) return [`${scheme}://${host}/*`];
  return [`${scheme}://${host}/*`, ...(/^(?:\d+\.){3}\d+$|^\[/u.test(host) || host === "localhost" ? [] : [`${scheme}://*.${host}/*`])];
}

/** Everything that must stay injected without a click, derived from the saved settings. */
export function persistentSiteMatches(settings: ExtensionSettings): string[] {
  const auto = settings.autoTranslation;
  const matches = new Set<string>();
  if (auto?.enabled) {
    if (auto.nonTargetLanguage) ALL_SITES.forEach(match => matches.add(match));
    const removed = new Set(auto.removedPresetSites ?? []);
    const presets = new Set(AUTO_TRANSLATION_PRESETS.map(preset => preset.domain));
    for (const domain of auto.presetSites) if (presets.has(domain) && !removed.has(domain)) sitePatternToMatches(domain).forEach(match => matches.add(match));
    for (const site of auto.customSites) if (site.enabled) sitePatternToMatches(site.pattern).forEach(match => matches.add(match));
  }
  for (const site of settings.videoTranslation?.enabledSites ?? []) sitePatternToMatches(site).forEach(match => matches.add(match));
  return [...matches];
}

/** Sites whose captions need the page-level (MAIN world) bridge from document start. */
export function videoBridgeMatches(): string[] {
  return VIDEO_PLATFORMS.filter(platform => platform.bridge).flatMap(platform => platform.hosts.flatMap(host => sitePatternToMatches(host)));
}

/** Dictionary hosts used by selection translation. */
export const DICTIONARY_ORIGINS = ["https://dict.youdao.com/*", "https://cn.bing.com/*"];

/** Every origin the saved settings need the background to reach (not including per-tab activeTab access). */
export function requiredOrigins(settings: ExtensionSettings): string[] {
  const active = settings.providers.find(provider => provider.id === settings.activeProviderId);
  return [...new Set([
    ...providerOrigins(active),
    ...(settings.selectionTranslation?.enabled ? DICTIONARY_ORIGINS : []),
    ...(settings.imageTranslationEnabled ? ALL_SITES : []),
    ...persistentSiteMatches(settings)
  ])];
}

const permissionsApi = (): typeof chrome.permissions | undefined => typeof chrome === "undefined" ? undefined : chrome.permissions;

export async function hasOrigins(origins: string[]): Promise<boolean> {
  // Hosts without the permissions API (and bare test stubs) cannot gate access; let the network decide.
  const api = permissionsApi();
  if (!origins.length || !api?.contains) return true;
  try { return await api.contains({ origins }); } catch { return false; }
}

/**
 * Ask the user for host access. Call it first thing inside a click or key handler so the
 * browser still sees the gesture. Resolves true when everything is (already) granted.
 */
export async function requestOrigins(origins: string[]): Promise<boolean> {
  const api = permissionsApi();
  if (!origins.length || !api?.request) return true;
  try {
    if (await api.contains({ origins })) return true;
    return await api.request({ origins });
  } catch { return false; }
}
