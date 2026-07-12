import fs from 'node:fs';
import path from 'node:path';
import { reasoningLevelUnion } from './backends/index.js';
import { checkCitations } from './citation-check.js';
import { redactText } from './redaction.js';

export const CHALLENGER_PROMPT_MARKER = '[[EH_CHALLENGER_AGENT]]';

const REASONING_LEVELS = new Set(['', ...reasoningLevelUnion()]);
const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_CONTEXT_CHARS = 55_000;
const MAX_FILE_CHARS = 14_000;
const MAX_USER_REQUEST_CHARS = 8_000;
const MAX_FINAL_ANSWER_CHARS = 12_000;

const TEXT_EXTS = new Set([
  '.html', '.htm', '.md', '.markdown', '.txt', '.log', '.json', '.jsonl',
  '.ndjson', '.csv', '.tsv', '.yaml', '.yml', '.xml',
]);

export function normalizeChallengerConfig(raw = {}) {
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const reasoning = typeof raw.reasoning === 'string' && REASONING_LEVELS.has(raw.reasoning)
    ? raw.reasoning
    : 'high';
  return {
    enabled: Boolean(raw.enabled),
    automatic: Boolean(raw.automatic),
    model,
    reasoning,
  };
}

function textFromContent(content = []) {
  return content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

export function latestAssistantText(session) {
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    const event = session.transcript[i];
    const message = event?.message;
    if (event?.type === 'message_end' && message?.role === 'assistant') {
      if (message.stopReason === 'error' || message.errorMessage) continue;
      const text = textFromContent(message.content);
      if (text) return text;
    }
  }
  return '';
}

export function latestUserText(session) {
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    const event = session.transcript[i];
    const message = event?.message;
    if (event?.type === 'message_end' && message?.role === 'user') {
      const text = textFromContent(message.content);
      if (text && !text.includes(CHALLENGER_PROMPT_MARKER)) return text;
    }
  }
  return '';
}

function isReviewableFile(file) {
  if (!file?.path || file.path.startsWith('uploads/')) return false;
  return !file.path.split('/').some((part) => part.startsWith('.'));
}

export function hasChallengeEvidence(session) {
  try {
    return session.listFiles().some(isReviewableFile);
  } catch {
    return false;
  }
}

export function challengeEvidenceSignature(session) {
  try {
    const parts = session.listFiles()
      .filter(isReviewableFile)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => `${file.path}:${file.size}:${Math.round(file.mtime || 0)}`);
    return parts.join('|');
  } catch {
    return '';
  }
}

function reportScore(file) {
  const name = path.basename(file.path).toLowerCase();
  const ext = path.extname(name);
  const atRoot = !file.path.includes('/');
  if (atRoot && name.startsWith('report-') && (ext === '.html' || ext === '.htm')) return 0;
  if (atRoot && (ext === '.html' || ext === '.htm')) return 1;
  if (atRoot && (ext === '.md' || ext === '.markdown' || ext === '.txt')) return 2;
  if (file.path.startsWith('evidence/metrics/')) return 3;
  if (file.path.startsWith('evidence/records/')) return 4;
  if (file.path.startsWith('evidence/packets/')) return 5;
  if (file.path.startsWith('evidence/')) return 6;
  return 7;
}

function selectReviewFiles(files, maxFiles = 8) {
  return files
    .filter(isReviewableFile)
    .filter((file) => TEXT_EXTS.has(path.extname(file.path).toLowerCase()))
    .sort((a, b) => reportScore(a) - reportScore(b) || b.mtime - a.mtime)
    .slice(0, maxFiles);
}

function isRootHtmlReport(file) {
  if (!isReviewableFile(file) || !file.path || file.path.includes('/')) return false;
  const ext = path.extname(file.path).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

export function hasRootHtmlReport(session) {
  try {
    return session.listFiles().some(isRootHtmlReport);
  } catch {
    return false;
  }
}

function selectReportFiles(files, maxFiles = 4) {
  return files
    .filter(isRootHtmlReport)
    .sort((a, b) => reportScore(a) - reportScore(b) || b.mtime - a.mtime)
    .slice(0, maxFiles);
}

function formatReportList(reportFiles = []) {
  return reportFiles
    .map((file) => (typeof file === 'string' ? file : file?.path))
    .filter(Boolean)
    .map((filePath) => `\`${filePath}\``)
    .join(', ');
}

function challengerReportStewardship(reportFiles = []) {
  const reports = formatReportList(reportFiles);
  if (!reports) return '';
  return `
Existing report stewardship:
The workspace already contains HTML report file(s): ${reports}. If you return
NOT SATISFIED, write the challenge as an incremental second-pass request. Tell
the investigator to preserve the existing report file and the
investigation-reporting template structure, then update only the sections made
necessary by new or changed evidence. Do not ask them to delete, recreate,
restyle, or replace the report unless the current report is structurally
unusable or the wrong report type; if so, require them to explain why.
`.trim();
}

function investigatorReportDiscipline(reportFiles = []) {
  const reports = formatReportList(reportFiles);
  if (!reports) return '';
  return `
Report update discipline:
Existing HTML report(s): ${reports}. Treat the existing report as the editing
target. If your re-check changes the findings, edit the current report in place
and preserve the template CSS, data attributes, theme behavior, section
structure, and app-local font link. Make targeted changes only: revise affected
verdicts, evidence pointers, tables, timelines, blind spots, and follow-up
actions. Do not delete/rebuild the report or create a replacement unless you
explicitly determine the existing file is unusable or the wrong report type, and
explain that decision in chat.
`.trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(text) {
  return decodeHtmlEntities(text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function readTextHead(abs, maxChars = MAX_FILE_CHARS) {
  const handle = fs.openSync(abs, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(maxChars * 4, 8192));
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, bytesRead).includes(0)) return { text: '', truncated: false };
    const raw = buffer.subarray(0, bytesRead).toString('utf8');
    return {
      text: raw.slice(0, maxChars),
      truncated: bytesRead < fs.statSync(abs).size || raw.length > maxChars,
    };
  } finally {
    fs.closeSync(handle);
  }
}

function fileContext(session, file, secretStore) {
  try {
    const abs = session.resolveFile(file.path);
    const ext = path.extname(file.path).toLowerCase();
    const preview = readTextHead(abs);
    let text = preview.text;
    if (!text) return '';
    if (ext === '.html' || ext === '.htm') text = htmlToText(text);
    text = redactText(text, secretStore).trim();
    if (!text) return '';
    const truncated = preview.truncated ? '\n[File preview truncated.]' : '';
    return `### ${file.path}\n\n${text}${truncated}`;
  } catch {
    return '';
  }
}

function appendSection(parts, title, body, budget) {
  const clean = body.trim();
  if (!clean || budget.remaining <= 0) return;
  const section = `\n\n## ${title}\n\n${clean}`;
  const clipped = section.slice(0, budget.remaining);
  parts.push(clipped);
  budget.remaining -= clipped.length;
}

export function collectChallengerContext(session, { secretStore = null, maxChars = DEFAULT_MAX_CONTEXT_CHARS } = {}) {
  const files = session.listFiles().filter(isReviewableFile);
  const userRequest = redactText(latestUserText(session).slice(0, MAX_USER_REQUEST_CHARS), secretStore);
  const finalAnswer = redactText(latestAssistantText(session).slice(0, MAX_FINAL_ANSWER_CHARS), secretStore);
  const fileList = files
    .sort((a, b) => b.mtime - a.mtime)
    .map((file) => `- ${file.path} (${file.size} bytes)`)
    .join('\n');
  const selectedFiles = selectReviewFiles(files);
  const reportFiles = selectReportFiles(files);
  const fileBodies = selectedFiles
    .map((file) => fileContext(session, file, secretStore))
    .filter(Boolean)
    .join('\n\n');

  const parts = [];
  const budget = { remaining: maxChars };
  appendSection(parts, 'User Request', userRequest || '(No user request was captured.)', budget);
  appendSection(parts, 'Investigator Final Answer', finalAnswer || '(No final chat answer was captured.)', budget);
  appendSection(parts, 'Workspace Files', fileList || '(No non-upload workspace files were found.)', budget);
  appendSection(parts, 'Selected Report And Evidence Content', fileBodies || '(No readable report/evidence text was available.)', budget);

  return {
    hasEvidence: files.length > 0,
    files,
    selectedFiles,
    reportFiles,
    text: parts.join('').trim(),
  };
}

export function buildChallengerPrompt(contextText, { reportFiles = [], citation = null } = {}) {
  const reportStewardship = challengerReportStewardship(reportFiles);
  const reportStewardshipBlock = reportStewardship ? `${reportStewardship}\n\n` : '';
  // Phase 2: surface deterministic citation gaps so the challenger pushes on
  // ungrounded claims (uncited, or citing a missing evidence file).
  const citationBlock = (citation && citation.has_verdict && (citation.uncited.length || citation.missing.length))
    ? `Citation check (deterministic): the verdict has ${citation.uncited.length} uncited claim(s) and ${citation.missing.length} claim(s) citing a missing evidence file. A claim with no real backing file under evidence/ is not warranted — push the investigator to produce the evidence or drop the claim:\n${[...citation.uncited.map((c) => `- uncited: ${c}`), ...citation.missing.map((s) => `- missing file: ${s}`)].join('\n')}\n\n`
    : '';
  return `
You are the Challenger Agent for an ExtraHop Investigation Agent web UI.

You are reviewing a colleague's work. Assume they worked carefully and that the
result is likely good unless the evidence below shows a concrete, material
problem. Your experience is valuable when it prevents a real miss; it is not
valuable when it creates busywork. Your default response is SATISFIED.

Judge the work against the user's actual request. For narrow factual tasks, such
as listing recent detections or summarizing one object, accept the answer if it
directly addresses the request with reasonable evidence. Do not escalate a
simple request into a full hunt, broad report, or extra research just because
more analysis would always be possible.

Return NOT SATISFIED only when a gap could materially change the conclusion,
severity, remediation, or report quality. If the only concern is style,
preference, harmless missing detail, or optional extra diligence, return
SATISFIED.

Review from first principles:
- Is this possibly a newly unknown issue, emerging threat, or software behavior
  where the investigator should have flagged the need for web/vendor research?
- Did the investigator use ExtraHop correctly: metrics and high-level trends
  first, records for deep details, packets for payload inspection/evidence?
- Did they jump straight to records or one entity and risk missing a broader
  trend, baseline, peer group, or time-window comparison?
- Did they overclaim, ignore uncertainty, or skip obvious alternate
  explanations?
- Did they get tunnel vision before understanding enough context?
- Is the requested scope simple enough that the current answer is already
  sufficient?

${reportStewardshipBlock}${citationBlock}Return exactly one of these forms:

SATISFIED

or:

NOT SATISFIED
\`\`\`challenge
Write a constructive counter-prompt for the investigator here. Be specific
about what to re-check, which evidence level to use, and what would change the
finding. Do not be performative or generic.
\`\`\`

Do not include any other prose outside the required response form.

${contextText}
`.trim();
}

export function parseChallengerResponse(raw) {
  const text = String(raw || '').trim();
  if (/^SATISFIED\s*$/i.test(text)) {
    return { status: 'satisfied', prompt: '' };
  }
  if (!/^NOT\s+SATISFIED\b/i.test(text)) {
    throw new Error('Challenger response did not start with SATISFIED or NOT SATISFIED.');
  }
  const fence = text.match(/```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/);
  const prompt = (fence ? fence[1] : text.replace(/^NOT\s+SATISFIED\b/i, '')).trim();
  if (!prompt) throw new Error('Challenger response was NOT SATISFIED but did not include a challenge prompt.');
  return { status: 'challenged', prompt };
}

async function selectedModel(config, modelCatalog) {
  const challenger = normalizeChallengerConfig(config.challenger);
  const model = challenger.model || config.mainModel || '';
  let reasoning = challenger.reasoning;
  if (model && modelCatalog?.resolveSelection) {
    try {
      const resolved = await modelCatalog.resolveSelection(model);
      if (resolved && !resolved.thinking) reasoning = 'off';
    } catch {
      // Keep the configured model/reasoning. The Pi call will surface any real failure.
    }
  }
  return { model, reasoning };
}

export async function runChallengerReview({
  session,
  config,
  modelCatalog = null,
  secretStore = null,
  oneShot,
  timeoutMs = DEFAULT_REVIEW_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const context = collectChallengerContext(session, { secretStore });
  if (!context.hasEvidence) {
    return { status: 'skipped', message: 'No non-upload workspace evidence was available to review.' };
  }

  const prompt = buildChallengerPrompt(context.text, { reportFiles: context.reportFiles, citation: checkCitations(session.workspace) });
  const { model, reasoning } = await selectedModel(config, modelCatalog);
  const stdout = await oneShot({
    prompt,
    model,
    reasoning,
    cwd: session.workspace,
    env,
    timeoutMs,
  });
  const parsed = parseChallengerResponse(redactText(stdout, secretStore));
  if (parsed.prompt) parsed.prompt = redactText(parsed.prompt, secretStore);
  parsed.reportFiles = context.reportFiles.map((file) => file.path);
  return parsed;
}

export function frameChallengePrompt(prompt, { reportFiles = [] } = {}) {
  const reportDiscipline = investigatorReportDiscipline(reportFiles);
  const reportDisciplineBlock = reportDiscipline ? `\n\n${reportDiscipline}` : '';
  return `${CHALLENGER_PROMPT_MARKER}
The Challenger Agent reviewed your prior findings and raised the following counter-perspective. Treat this as a constructive second-pass challenge: investigate anything material, update the report if the evidence changes, and explicitly say what you confirmed or ruled out.${reportDisciplineBlock}

${prompt.trim()}`;
}
