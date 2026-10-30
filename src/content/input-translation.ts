import { sendRuntimeRequest } from "./runtime";
import { showNotice } from "./notice";

type TextField = HTMLInputElement | HTMLTextAreaElement;
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);

/** The focused element, looking through open shadow roots. */
function deepActiveElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

function isTextField(element: Element | null): element is TextField {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  return element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type) && !element.readOnly && !element.disabled;
}

/** The editable host of a rich-text editor (contenteditable / role=textbox), or the field itself. */
export function findInputTarget(): TextField | HTMLElement | null {
  const active = deepActiveElement();
  if (isTextField(active)) return active;
  if (active instanceof HTMLElement) {
    const host = active.isContentEditable ? active : active.closest<HTMLElement>("[contenteditable]:not([contenteditable='false'])");
    if (host?.isContentEditable) {
      // Nested editors (comments inside an editable page) should win over the outer root.
      let root: HTMLElement = host;
      while (root.parentElement?.isContentEditable && root.parentElement !== document.body) root = root.parentElement;
      return root;
    }
  }
  const selection = window.getSelection()?.anchorNode;
  const anchor = selection instanceof Element ? selection : selection?.parentElement;
  const editable = anchor?.closest<HTMLElement>("[contenteditable]:not([contenteditable='false'])");
  return editable?.isContentEditable ? editable : null;
}

const insertText = (text: string): boolean => typeof document.execCommand === "function" && document.execCommand("insertText", false, text);

interface Source { text: string; apply: (translation: string) => void }

function readSource(target: TextField | HTMLElement): Source {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0, end = target.selectionEnd ?? 0;
    const partial = end > start;
    const from = partial ? start : 0, to = partial ? end : target.value.length;
    return { text: target.value.slice(from, to), apply: translation => {
      target.focus();
      target.setSelectionRange(from, to);
      // execCommand keeps the browser undo stack; fall back to the native setter for frameworks.
      if (!insertText(translation)) {
        const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, target.value.slice(0, from) + translation + target.value.slice(to));
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: translation }));
      }
    } };
  }
  const selection = window.getSelection();
  const inside = selection && selection.rangeCount > 0 && !selection.isCollapsed && target.contains(selection.anchorNode)
    && target.contains(selection.focusNode);
  const range = inside ? selection!.getRangeAt(0).cloneRange() : (() => {
    const whole = document.createRange(); whole.selectNodeContents(target); return whole;
  })();
  const text = range.toString();
  return { text, apply: translation => {
    target.focus();
    const current = window.getSelection()!;
    current.removeAllRanges(); current.addRange(range);
    if (!insertText(translation)) {
      range.deleteContents(); range.insertNode(document.createTextNode(translation));
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: translation }));
    }
  } };
}

let running = false;

/** Option+A with a focused field: translate what is typed (or its selection) with the configured LLM. */
export async function translateFocusedInput(): Promise<void> {
  if (running) return;
  const target = findInputTarget();
  if (!target) { showNotice("请先点进要翻译的输入框，再按快捷键。", true); return; }
  const source = readSource(target);
  if (!source.text.trim()) { showNotice("输入框里没有可翻译的文字。", true); return; }
  running = true;
  showNotice("正在翻译输入框…");
  try {
    const { translation, providerLabel } = await sendRuntimeRequest<{ translation: string; providerLabel: string }>({ type: "TRANSLATE_INPUT", text: source.text });
    // The field may have been edited or blurred while the model was answering.
    if (!target.isConnected) throw new Error("输入框已被移除，译文未写入。");
    source.apply(translation);
    showNotice(`已用 ${providerLabel} 翻译，按 Ctrl/⌘+Z 可撤销。`);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), true);
  } finally {
    running = false;
  }
}
