import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import { documentOrigin, fetchWithAccess, originPattern, persistentSiteMatches, providerOrigins, requestOrigins, requiredOrigins, sitePatternToMatches, videoBridgeMatches } from "../src/shared/access";

afterEach(() => vi.unstubAllGlobals());

describe("site access patterns", () => {
  it("builds one origin per http(s) address and rejects everything else", () => {
    expect(originPattern("https://api.example.com:8443/v1/chat")).toBe("https://api.example.com/*");
    expect(originPattern("http://localhost:11434/v1")).toBe("http://localhost/*");
    for (const value of ["file:///a.pdf", "chrome://extensions", "data:text/plain,1", "not a url", undefined]) expect(originPattern(value)).toBeUndefined();
    expect(documentOrigin("file:///Users/me/a.pdf")).toBe("file:///*");
  });
  it("covers a domain and its subdomains, but only the subdomains of a wildcard rule", () => {
    expect(sitePatternToMatches("github.com")).toEqual(["*://github.com/*", "*://*.github.com/*"]);
    expect(sitePatternToMatches("*.example.com")).toEqual(["*://*.example.com/*"]);
    expect(sitePatternToMatches("https://news.ycombinator.com/item")).toEqual(["https://news.ycombinator.com/*", "https://*.news.ycombinator.com/*"]);
    expect(sitePatternToMatches("192.168.1.2:8080")).toEqual(["*://192.168.1.2/*"]);
    expect(sitePatternToMatches("")).toEqual([]);
  });
  it("derives provider origins from the endpoint the user configured", () => {
    const find = (id: string) => DEFAULT_SETTINGS.providers.find(provider => provider.id === id);
    expect(providerOrigins(find("google-web-translate"))).toEqual(["https://translate.googleapis.com/*"]);
    expect(providerOrigins({ ...find("openai-compatible")!, baseURL: "https://llm.internal:8443/v1" } as never)).toEqual(["https://llm.internal/*"]);
    expect(providerOrigins({ ...find("openai-compatible")!, baseURL: "" } as never)).toEqual([]);
    expect(providerOrigins(undefined)).toEqual([]);
  });
  it("keeps always-on injection limited to the sites the user listed", () => {
    expect(persistentSiteMatches({ ...DEFAULT_SETTINGS })).toEqual([]);
    const enabled = { ...DEFAULT_SETTINGS, autoTranslation: { enabled: true, nonTargetLanguage: false, presetSites: ["github.com"], customSites: [{ id: "a", pattern: "*.example.org", enabled: true }, { id: "b", pattern: "off.test", enabled: false }] } };
    expect(persistentSiteMatches(enabled)).toEqual(["*://github.com/*", "*://*.github.com/*", "*://*.example.org/*"]);
    expect(persistentSiteMatches({ ...enabled, autoTranslation: { ...enabled.autoTranslation, nonTargetLanguage: true } })).toEqual(expect.arrayContaining(["http://*/*", "https://*/*"]));
    expect(persistentSiteMatches({ ...DEFAULT_SETTINGS, videoTranslation: { ...DEFAULT_SETTINGS.videoTranslation!, enabledSites: ["youtube.com"] } } as never)).toContain("*://*.youtube.com/*");
    expect(videoBridgeMatches()).toEqual(expect.arrayContaining(["*://youtube.com/*", "*://bilibili.com/*"]));
  });
  it("lists what the saved settings need, without asking for every site by default", () => {
    const base = requiredOrigins({ ...DEFAULT_SETTINGS, activeProviderId: "google-web-translate" });
    expect(base).toContain("https://translate.googleapis.com/*");
    expect(base).not.toContain("https://*/*");
    expect(requiredOrigins({ ...DEFAULT_SETTINGS, imageTranslationEnabled: true })).toContain("https://*/*");
  });
});

describe("requesting host access", () => {
  it("asks once, only for what is missing, and reports a refusal", async () => {
    const permissions = { contains: vi.fn(async () => false), request: vi.fn(async () => true) };
    vi.stubGlobal("chrome", { permissions });
    expect(await requestOrigins(["https://a.test/*"])).toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://a.test/*"] });
    permissions.request.mockResolvedValueOnce(false as never);
    expect(await requestOrigins(["https://b.test/*"])).toBe(false);
    permissions.contains.mockResolvedValueOnce(true as never);
    permissions.request.mockClear();
    expect(await requestOrigins(["https://c.test/*"])).toBe(true);
    expect(permissions.request).not.toHaveBeenCalled();
  });
  it("proceeds when the browser has no permissions API", async () => {
    vi.stubGlobal("chrome", {});
    expect(await requestOrigins(["https://a.test/*"])).toBe(true);
  });
  it("prompts before a download from an extension page and then fetches", async () => {
    const permissions = { contains: vi.fn(async () => false), request: vi.fn(async () => true) };
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("chrome", { permissions });
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithAccess("https://files.example.com/a.pdf");
    expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://files.example.com/*"] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
