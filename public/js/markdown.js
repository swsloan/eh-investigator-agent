const { marked, DOMPurify, hljs } = window;

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(el, raw) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(raw));
  el.querySelectorAll('pre code').forEach((code) => {
    try { hljs.highlightElement(code); } catch { /* unknown lang */ }
  });
}

export function highlightCode(code) {
  try { hljs.highlightElement(code); } catch { /* fine unhighlighted */ }
}
