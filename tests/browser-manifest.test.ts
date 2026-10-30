import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { browserManifest } from "../build/manifest";

describe("browser package boundaries", () => {
  it("preserves the Chromium manifest and leaves the shared source untouched", () => {
    const snapshot = structuredClone(manifest);
    expect(browserManifest(manifest, false)).toEqual(snapshot);
    const firefox = browserManifest(manifest, true);
    expect(manifest).toEqual(snapshot);
    expect(firefox.background).toEqual({ scripts: ["background.js"], type: "module" });
    expect(firefox.permissions).not.toContain("offscreen");
    expect(firefox.permissions).toEqual(expect.arrayContaining(["activeTab", "scripting"]));
    expect(firefox.content_security_policy.sandbox).toContain("moz-extension:");
    expect(firefox.content_security_policy.sandbox).not.toContain("chrome-extension:");
    expect(firefox.browser_specific_settings?.gecko).toMatchObject({
      strict_min_version: "154.0", data_collection_permissions: { required: ["websiteContent", "authenticationInfo"] }
    });
    expect(firefox.version).toBe(manifest.version);
  });

  it("requests site access only on demand and wires the shortcuts as browser commands", () => {
    const shared = manifest as Record<string, unknown>;
    // No standing access: pages are injected after a click, shortcut or context-menu action.
    expect(shared.content_scripts).toBeUndefined();
    expect(shared.host_permissions).toBeUndefined();
    expect(shared.optional_host_permissions).toEqual(expect.arrayContaining(["https://*/*", "http://*/*"]));
    expect(manifest.permissions).toEqual(expect.arrayContaining(["activeTab", "scripting"]));
    const commands = shared.commands as Record<string, { suggested_key?: { default: string } }>;
    expect(commands["translate-input"].suggested_key?.default).toBe("Alt+A");
    expect(Object.values(commands).filter(command => command.suggested_key)).toHaveLength(4);
  });
});
