import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/background/template";

describe("renderTemplate", () => {
  it("renders string and JSON placeholders", () => {
    expect(
      renderTemplate("{{targetLang}}: {{json texts}}", {
        targetLang: "zh-CN",
        sourceLang: "auto",
        texts: ["hello", "world"]
      })
    ).toBe('zh-CN: ["hello","world"]');
  });
});
