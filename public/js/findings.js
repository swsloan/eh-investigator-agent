// Findings the agent states as it goes.
//
// Conclusions used to arrive only at the end of a turn, so a five-minute
// investigation read as silence followed by a verdict. The system prompt now asks
// for a single line whenever a result moves the agent's understanding:
//
//   FINDING: <one sentence> [leaning: expected-behavior]
//
// This module is the client half of that contract. The live-activity view shows the
// most recent finding as its own card, so the parsing lives here rather than inside
// the chat renderer.

/** The four leanings the prompt offers. Anything else is treated as unstated. */
const LEANINGS = new Set(['expected-behavior', 'suspicious', 'malicious', 'inconclusive']);

const FINDING_LINE_RE = /^[ \t]*FINDING:[ \t]*(.+?)[ \t]*$/gim;
const LEANING_RE = /\[\s*leaning\s*:\s*([a-z-]+)\s*\]\s*$/i;

const PLACEHOLDER_PREFIX = '%%EH-FINDING-';
const PLACEHOLDER_RE = /^%%EH-FINDING-(\d+)%%$/;

/**
 * One `FINDING:` body into `{ text, leaning }`, or null when there is no sentence
 * left once the tag is removed. An unrecognised leaning is dropped rather than
 * shown, so a typo cannot invent a verdict colour.
 */
export function parseFinding(body) {
  let text = String(body || '').trim();
  if (!text) return null;
  let leaning = '';
  const tag = text.match(LEANING_RE);
  if (tag) {
    const candidate = tag[1].toLowerCase();
    if (LEANINGS.has(candidate)) leaning = candidate;
    text = text.slice(0, tag.index).trim();
  }
  return text ? { text, leaning } : null;
}

/**
 * Lift finding lines out of streamed prose, leaving an ordered placeholder behind.
 *
 * Rendering happens in two steps — markdown first, then placeholders swapped for
 * chip elements — so a finding keeps its position in the narrative without any of
 * the model's text ever being concatenated into an HTML string.
 */
export function splitFindings(raw) {
  const findings = [];
  const text = String(raw || '').replace(FINDING_LINE_RE, (match, body) => {
    const parsed = parseFinding(body);
    if (!parsed) return match;
    findings.push(parsed);
    return `${PLACEHOLDER_PREFIX}${findings.length - 1}%%`;
  });
  return { text, findings };
}

/** The finding index a rendered placeholder paragraph stands for, or -1. */
export function placeholderIndex(textContent) {
  const m = PLACEHOLDER_RE.exec(String(textContent || '').trim());
  return m ? Number(m[1]) : -1;
}

/** A chip element for one finding. Text only — nothing here is parsed as markup. */
export function findingChip(finding, doc = document) {
  const chip = doc.createElement('div');
  chip.className = 'finding-chip';
  if (finding.leaning) chip.dataset.leaning = finding.leaning;
  const tag = doc.createElement('span');
  tag.className = 'finding-tag';
  tag.textContent = 'Finding';
  const body = doc.createElement('span');
  body.className = 'finding-text';
  body.textContent = finding.text;
  chip.append(tag, body);
  if (finding.leaning) {
    const lean = doc.createElement('span');
    lean.className = 'finding-leaning';
    lean.textContent = finding.leaning.replace(/-/g, ' ');
    chip.appendChild(lean);
  }
  return chip;
}

/** Swap rendered placeholder paragraphs for their chips, in place. */
export function replaceFindingPlaceholders(el, findings) {
  if (!findings.length) return;
  for (const node of [...el.querySelectorAll('p')]) {
    const index = placeholderIndex(node.textContent);
    if (index < 0 || !findings[index]) continue;
    node.replaceWith(findingChip(findings[index], el.ownerDocument || document));
  }
}
