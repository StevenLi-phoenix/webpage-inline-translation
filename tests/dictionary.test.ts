// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../src/shared/settings";
import { isDictionaryAudioUrl, isSingleDictionaryWord, normalizeDictionaryQuery, normalizeSelectionText } from "../src/shared/dictionary";
import { parseBingDictionary, parseYoudaoDictionary } from "../src/dictionary/parsers";

const bing = `<html><head><title>example - 搜索 词典</title></head><body><div class="qdef">
<h1>example</h1><div class="hd_prUS">美 [ɪɡˈzæmpəl]</div><div class="hd_pr">英 [ɪɡˈzɑːmpəl]</div>
<a id="bigaud_us" data-mp3link="/dict/mediamp3?blob=audio%2Fus.mp3"></a>
<a id="bigaud_uk" data-mp3link="/dict/mediamp3?blob=audio%2Fuk.mp3"></a>
<ul><li><span class="pos">n.</span><span class="def">例子；范例</span></li></ul></div></body></html>`;

describe("dictionary settings and input", () => {
  it("migrates old settings and rejects unknown providers/styles", () => {
    expect(normalizeSettings({}).selectionTranslation).toEqual({ enabled: false, provider: "youdao", style: "dot" });
    expect(normalizeSettings({ selectionTranslation: { enabled: false, provider: "bing", style: "underline" } }).selectionTranslation)
      .toEqual({ enabled: false, provider: "bing", style: "underline" });
    expect(normalizeSettings({ selectionTranslation: { enabled: "true", provider: "evil", style: "unknown" } }).selectionTranslation)
      .toEqual({ enabled: false, provider: "youdao", style: "dot" });
  });
  it("normalizes phrases, preserves non-Latin words and bounds selection length", () => {
    expect(normalizeDictionaryQuery("  take\n off  ")).toBe("take off");
    expect(normalizeDictionaryQuery("你好")).toBe("你好");
    expect(normalizeDictionaryQuery("e\u0301cole")).toBe("école");
    for (const value of [" ", "123.45", "a".repeat(101), "hello\0", {}, undefined]) expect(normalizeDictionaryQuery(value)).toBe("");
  });
  it("routes only single alphabetic words to the dictionary", () => {
    for (const word of ["filesystem", "Running", "don't", "well-known", "école", "e\u0301cole"]) expect(isSingleDictionaryWord(word)).toBe(true);
    for (const text of ["take off", "first\nsecond", "feat: add selection translation", "hello!", "中文没有空格", "翻訳", "한국어", "123", "a".repeat(101)]) expect(isSingleDictionaryWord(text)).toBe(false);
  });
  it("allows longer selections and preserves paragraph breaks for translation", () => {
    const paragraph = "Read this paragraph.\r\n".repeat(10).trim();
    expect(normalizeSelectionText(paragraph)).toBe(paragraph.replaceAll("\r\n", "\n"));
    expect(normalizeSelectionText("a".repeat(5000))).toHaveLength(5000);
    for (const text of ["a".repeat(5001), "hello\0", "12345", undefined]) expect(normalizeSelectionText(text)).toBe("");
  });
  it("only permits HTTPS audio from the selected dictionary's fixed endpoint", () => {
    expect(isDictionaryAudioUrl("youdao", "https://dict.youdao.com/dictvoice?audio=hello&type=1")).toBe(true);
    expect(isDictionaryAudioUrl("bing", "https://cn.bing.com/dict/mediamp3?blob=audio%2Fhello.mp3")).toBe(true);
    for (const url of ["http://dict.youdao.com/dictvoice", "https://dict.youdao.com.evil.test/dictvoice", "https://dict.youdao.com/other", "https://user@dict.youdao.com/dictvoice", "https://dict.youdao.com:4433/dictvoice", "data:audio/mpeg;base64,AAAA"]) {
      expect(isDictionaryAudioUrl("youdao", url)).toBe(false);
    }
    expect(isDictionaryAudioUrl("bing", "https://dict.youdao.com/dictvoice")).toBe(false);
  });
});

describe("dictionary response adapters", () => {
  it("reads Youdao array entries, pronunciation variants and word forms", () => {
    const entry = parseYoudaoDictionary({ ec: { word: [{ "return-phrase": { l: { i: "take off" } }, ukphone: "teɪk ɒf", usphone: "teɪk ɔːf",
      ukspeech: "take+off&type=1", usspeech: "take+off&type=2", trs: [{ tr: [{ l: { i: ["v. 起飞；脱下"] } }] }] }] } }, "take off");
    expect(entry.meanings).toEqual([{ partOfSpeech: "v.", definition: "起飞；脱下" }]);
    expect(entry.pronunciations).toEqual([
      { accent: "uk", phonetic: "teɪk ɒf", audioUrl: "https://dict.youdao.com/dictvoice?audio=take+off&type=1" },
      { accent: "us", phonetic: "teɪk ɔːf", audioUrl: "https://dict.youdao.com/dictvoice?audio=take+off&type=2" }
    ]);
  });
  it("accepts Youdao object-shaped entries and extracts annotated Chinese-English definitions as plain text", () => {
    expect(parseYoudaoDictionary({ ec: { word: { "return-phrase": "example", trs: [{ pos: "n.", tran: "例子" }] } } }, "example").meanings)
      .toEqual([{ partOfSpeech: "n.", definition: "例子" }]);
    const entry = parseYoudaoDictionary({ ce: { word: [{ phone: "nǐ hǎo", trs: [{ tr: [{ l: { i: ["", { "#text": "hello", "@href": "app:ds:hello" }, " / ", { "#text": "hi" }] } }] }] }] } }, "你好");
    expect(entry.meanings).toEqual([{ partOfSpeech: "", definition: "hello / hi" }]);
    expect(entry.pronunciations).toEqual([{ accent: "default", phonetic: "nǐ hǎo" }]);
  });
  it("distinguishes a missing word from an invalid or blocked response", () => {
    expect(parseYoudaoDictionary({ input: "nonword" }, "nonword").meanings).toEqual([]);
    expect(() => parseYoudaoDictionary({ errorCode: 411 }, "example")).toThrow("无法识别");
    expect(parseBingDictionary("<title>nonword - 搜索 词典</title>", "nonword").meanings).toEqual([]);
    expect(() => parseBingDictionary("<title>Access Denied</title>", "example")).toThrow("暂时不可用");
  });
  it("extracts Bing pronunciations, audio paths and meanings without executing or attaching remote content", () => {
    const entry = parseBingDictionary(bing + '<script>window.remoteScriptRan=true</script><img src="https://evil.test/tracker">', "example");
    expect(entry.word).toBe("example");
    expect(entry.meanings).toEqual([{ partOfSpeech: "n.", definition: "例子；范例" }]);
    expect(entry.pronunciations).toHaveLength(2);
    expect(entry.pronunciations[0]).toMatchObject({ accent: "uk", phonetic: "ɪɡˈzɑːmpəl", audioUrl: "https://cn.bing.com/dict/mediamp3?blob=audio%2Fuk.mp3" });
    expect(document.querySelector("img")).toBeNull();
    expect((window as unknown as Record<string, unknown>).remoteScriptRan).toBeUndefined();
  });
  it("ignores missing phonetics and rejects unexpected audio origins in Bing HTML", () => {
    const entry = parseBingDictionary(bing.replace('/dict/mediamp3?blob=audio%2Fuk.mp3', 'https://evil.test/audio.mp3').replace('<div class="hd_prUS">美 [ɪɡˈzæmpəl]</div>', ''), "example");
    expect(entry.pronunciations[0]).toMatchObject({ accent: "uk", audioUrl: undefined });
    expect(entry.pronunciations[1]).toMatchObject({ accent: "us", phonetic: undefined });
  });
});
