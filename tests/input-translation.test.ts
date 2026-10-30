// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("../src/content/runtime", () => ({ sendRuntimeRequest: send }));
import { findInputTarget, translateFocusedInput } from "../src/content/input-translation";

const notice = () => document.getElementById("wupage-shortcut-notice")?.shadowRoot?.querySelector("p")?.textContent ?? "";
beforeEach(() => {
  send.mockReset();
  send.mockImplementation(async (request: { type: string; text: string }) => ({ translation: `EN:${request.text}`, providerLabel: "LLM" }));
});
afterEach(() => { document.body.replaceChildren(); document.getElementById("wupage-shortcut-notice")?.remove(); window.getSelection()?.removeAllRanges(); });

describe("translate the focused input", () => {
  it("replaces the whole value of a textarea and notifies listeners like a user edit", async () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const field = document.querySelector<HTMLTextAreaElement>("#t")!;
    field.value = "你好，世界"; field.focus();
    const events: string[] = [];
    field.addEventListener("input", () => events.push(field.value));
    await translateFocusedInput();
    expect(send).toHaveBeenCalledWith({ type: "TRANSLATE_INPUT", text: "你好，世界" });
    expect(field.value).toBe("EN:你好，世界");
    expect(events).toEqual(["EN:你好，世界"]);
    expect(notice()).toContain("已用 LLM 翻译");
  });
  it("translates only the selected part of an input", async () => {
    document.body.innerHTML = '<input id="i" type="text">';
    const field = document.querySelector<HTMLInputElement>("#i")!;
    field.value = "keep 选中的这句 keep"; field.focus(); field.setSelectionRange(5, 10);
    await translateFocusedInput();
    expect(send).toHaveBeenCalledWith({ type: "TRANSLATE_INPUT", text: "选中的这句" });
    expect(field.value).toBe("keep EN:选中的这句 keep");
  });
  it("uses the document execCommand path when the browser offers it, so undo keeps working", async () => {
    document.body.innerHTML = '<textarea id="t">你好</textarea>';
    const field = document.querySelector<HTMLTextAreaElement>("#t")!; field.focus();
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    try {
      await translateFocusedInput();
      expect(exec).toHaveBeenCalledWith("insertText", false, "EN:你好");
    } finally { delete (document as unknown as Record<string, unknown>).execCommand; }
  });
  it("finds and translates a rich-text editor, honouring a selection inside it", async () => {
    document.body.innerHTML = '<div id="e" contenteditable="true"><p>第一段</p><p id="second">第二段</p></div>';
    const editor = document.querySelector<HTMLElement>("#e")!;
    Object.defineProperty(editor, "isContentEditable", { value: true });
    editor.focus();
    expect(findInputTarget()).toBe(editor);
    const range = document.createRange(); range.selectNodeContents(document.querySelector("#second")!);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await translateFocusedInput();
    expect(send).toHaveBeenCalledWith({ type: "TRANSLATE_INPUT", text: "第二段" });
    expect(editor.textContent).toContain("EN:第二段");
    expect(editor.textContent).toContain("第一段");
  });
  it("explains what to do when nothing editable is focused or the field is empty", async () => {
    document.body.innerHTML = '<p>text</p><textarea id="t"></textarea>';
    await translateFocusedInput();
    expect(notice()).toContain("点进要翻译的输入框");
    document.querySelector<HTMLTextAreaElement>("#t")!.focus();
    await translateFocusedInput();
    expect(notice()).toContain("没有可翻译的文字");
    expect(send).not.toHaveBeenCalled();
  });
  it("ignores password, read-only and disabled fields", () => {
    document.body.innerHTML = '<input id="p" type="password"><input id="r" readonly><input id="d" disabled>';
    for (const id of ["p", "r"]) { document.querySelector<HTMLInputElement>(`#${id}`)!.focus(); expect(findInputTarget()).toBeNull(); }
  });
  it("reports a model failure in the page and leaves the typed text untouched", async () => {
    document.body.innerHTML = '<textarea id="t">hello</textarea>';
    const field = document.querySelector<HTMLTextAreaElement>("#t")!; field.focus();
    send.mockRejectedValueOnce(new Error("输入框翻译需要大模型"));
    await translateFocusedInput();
    expect(field.value).toBe("hello");
    expect(notice()).toContain("需要大模型");
  });
  it("ignores a second press while a translation is running", async () => {
    document.body.innerHTML = '<textarea id="t">hello</textarea>';
    document.querySelector<HTMLTextAreaElement>("#t")!.focus();
    let finish!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = translateFocusedInput();
    await translateFocusedInput();
    expect(send).toHaveBeenCalledOnce();
    finish({ translation: "hi", providerLabel: "LLM" }); await first;
  });
});
