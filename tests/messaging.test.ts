import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTabMessage } from "../src/shared/messaging";
import { ProviderError } from "../src/shared/errors";

afterEach(() => vi.unstubAllGlobals());

describe("page messaging connection errors", () => {
  it.each([
    "Could not establish connection. Receiving end does not exist.",
    "The message port closed before a response was received.",
    "Extension context invalidated."
  ])("explains how to recover from %s", async message => {
    vi.stubGlobal("chrome", { tabs: { sendMessage: vi.fn().mockRejectedValue(new Error(message)) } });
    await expect(sendTabMessage(1, { type: "GET_PARAGRAPH_MODE" })).rejects.toThrow("刷新网页后重试");
  });

  it("treats an absent response as a disconnected page", async () => {
    vi.stubGlobal("chrome", { tabs: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
    await expect(sendTabMessage(1, { type: "GET_PARAGRAPH_MODE" })).rejects.toThrow("无法连接到当前网页");
  });

  it("preserves unrelated errors and provider error details", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("Unrelated failure"))
      .mockResolvedValueOnce({ ok: false, error: "Too many requests", errorCode: "rate_limit", retryAfterMs: 5000 });
    vi.stubGlobal("chrome", { tabs: { sendMessage: send } });
    await expect(sendTabMessage(1, { type: "TRANSLATE_PAGE" })).rejects.toThrow("Unrelated failure");
    await expect(sendTabMessage(1, { type: "TRANSLATE_PAGE" })).rejects.toEqual(new ProviderError("Too many requests", "rate_limit", 5000));
  });
});
