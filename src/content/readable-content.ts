export const READABLE_ROOT_SELECTOR = [
  "main", "article", "[role='main']", ".markdown-body", ".docblock", "#main-content",
  ".entry-content", ".post-content", ".article-content"
].join(",");

// A div can be a paragraph in either a semantic document or an application.
// Cards containing headings, controls or other blocks need independent segments.
export function isDivProseBlock(element: Element): boolean {
  if (!element.matches("div") || !element.closest(READABLE_ROOT_SELECTOR)
    || element.querySelector(
      "div,p,h1,h2,h3,h4,h5,h6,li,table,ul,ol,blockquote,section,article,header,footer,aside,nav,"
      + "button,input,textarea,select,[role='button'],[role='listitem'],[contenteditable]"
    )) return false;
  // Flex/grid children are separate layout fields, even when authored as spans.
  // Merging a title and its author moves the translation out of both fields and
  // loses their typography, links, truncation and alignment.
  const display = element.ownerDocument.defaultView?.getComputedStyle(element).display ?? "";
  return !/^(?:inline-)?(?:flex|grid)$/u.test(display);
}

const BLOCK_OR_CONTROL = "div,p,h1,h2,h3,h4,h5,h6,li,table,ul,ol,blockquote,section,article,header,footer,aside,nav,"
  + "button,input,textarea,select,[role='button'],[role='listitem'],[contenteditable]";

// AI answers and snippets end a sentence with an inline source chip (a span holding a link and a
// button). The chip is control UI, not text, so the div is still one running sentence.
// Only a direct inline child that carries a button counts as a chip; anything else block-like keeps
// the div a card.
export function isInlineProseDiv(element: Element): boolean {
  if (!element.matches("div")) return false;
  const display = element.ownerDocument.defaultView?.getComputedStyle(element).display ?? "";
  if (/^(?:inline-)?(?:flex|grid)$/u.test(display)) return false;
  const hasOwnText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  if (!hasOwnText) return false;
  const chips = [...element.children].filter(child => child.matches("span") && child.querySelector("button,[role='button']"));
  if (!chips.length) return false;
  return ![...element.querySelectorAll(BLOCK_OR_CONTROL)].some(node => !chips.some(chip => chip.contains(node)));
}
