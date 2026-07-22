import {
  INVESTIGATION_PLAN_SCHEMA_VERSION,
  PLAN_TYPE_LABELS,
} from './constants.js';
import { publicPlanView, validateStoredState } from './schema.js';
import { marked } from 'marked';

const TYPE_ACCENTS = Object.freeze({
  threat_hunt: '#EC0889',
  security_investigation: '#7F2854',
  performance_investigation: '#00AAEF',
});

const TYPE_TEXT_ACCENTS = Object.freeze({
  threat_hunt: '#A40761',
  security_investigation: '#7F2854',
  performance_investigation: '#006B99',
});

const TYPE_DARK_TEXT_ACCENTS = Object.freeze({
  threat_hunt: '#FF75C5',
  security_investigation: '#E1ADCA',
  performance_investigation: '#62D5FF',
});

const TYPE_BADGE_ACCENTS = Object.freeze({
  threat_hunt: '#A40761',
  security_investigation: '#7F2854',
  performance_investigation: '#261F63',
});

const STATUS_LABELS = Object.freeze({
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
  skipped: 'Skipped',
  superseded: 'Superseded',
});

const STATUS_ICONS = Object.freeze({
  pending: '○',
  in_progress: '▶',
  completed: '✓',
  blocked: '!',
  skipped: '↷',
  superseded: '↪',
});

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeMarkdown(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]{}<>#+.!|~-])/g, '\\$1')
    .replace(/\r\n?/g, '\n');
}

function markdownInline(value) {
  return escapeMarkdown(value).replace(/\n+/g, ' ');
}

function markdownParagraph(value) {
  return markdownInline(value);
}

function markdownCode(value) {
  const content = String(value).replace(/\r\n?|\n/g, ' ');
  const longestRun = Math.max(0, ...(content.match(/`+/g) || []).map((run) => run.length));
  const delimiter = '`'.repeat(longestRun + 1);
  const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function markdownTask(task) {
  const checked = ['completed', 'skipped', 'superseded'].includes(task.status);
  const label = task.status === 'pending' ? '' : ` **${STATUS_LABELS[task.status]}:**`;
  const title = task.status === 'skipped' || task.status === 'superseded'
    ? ` ~~${markdownInline(task.title)}~~`
    : ` ${markdownInline(task.title)}`;
  const parts = [`- [${checked ? 'x' : ' '}]${label}${title}`];
  if (task.why) parts.push(`  - Why: ${markdownParagraph(task.why)}`);
  if (task.evidence.length) {
    parts.push(`  - Evidence intent: ${task.evidence.map(markdownCode).join(', ')}`);
  }
  if (task.outcome) parts.push(`  - Outcome: ${markdownParagraph(task.outcome)}`);
  if (task.evidence_refs.length) {
    parts.push(`  - Evidence files: ${task.evidence_refs.map(markdownCode).join(', ')}`);
  }
  return parts.join('\n');
}

export function renderInvestigationPlanMarkdown(state) {
  validateStoredState(state);
  const lines = [
    '<!-- artifact-kind: investigation-plan -->',
    `<!-- generated-by: investigation-plan; schema-version: ${INVESTIGATION_PLAN_SCHEMA_VERSION}; revision: ${state.revision} -->`,
    `# ${markdownInline(state.title)}`,
    '',
    `**Plan type:** ${PLAN_TYPE_LABELS[state.plan_type]}`,
    '',
    '## Objective',
    '',
    markdownParagraph(state.objective),
    '',
    '## Scope',
    '',
    markdownParagraph(state.scope),
    '',
    '## Working hypothesis',
    '',
    markdownParagraph(state.hypothesis),
    '',
    '## Evidence strategy',
    '',
    markdownParagraph(state.strategy),
    '',
    '## Completion criteria',
    '',
    markdownParagraph(state.completion_criteria),
    '',
    '## Checklist',
    '',
    ...state.tasks.flatMap((task) => [markdownTask(task), '']),
    '## Plan updates',
    '',
  ];

  const history = [
    ...state.changes
      .filter((change) => change.kind === 'tasks_added')
      .map((change) => ({ kind: 'tasks_added', revision: change.revision, change })),
    ...state.pivots.map((pivot) => ({ kind: 'pivot', revision: pivot.revision, pivot })),
  ].sort((left, right) => left.revision - right.revision);
  if (!history.length) {
    lines.push('_No checklist expansions or material pivots recorded._', '');
  } else {
    for (const entry of history) {
      if (entry.kind === 'tasks_added') {
        const addition = entry.change;
        lines.push(`### Checklist expansion — revision ${addition.revision}`, '');
        lines.push(markdownParagraph(addition.reason), '');
        lines.push(`**Added tasks:** ${addition.task_ids.map(markdownCode).join(', ')}`, '');
        continue;
      }
      const { pivot } = entry;
      lines.push(`> **Pivot ${pivot.id} — ${escapeMarkdown(pivot.at)}**`, '>');
      lines.push(`> **Trigger:** ${markdownParagraph(pivot.trigger)}`, '>');
      lines.push(`> **Decision:** ${markdownParagraph(pivot.decision)}`);
      if (pivot.revised_objective) {
        lines.push('>', `> **Revised objective:** ${markdownParagraph(pivot.revised_objective)}`);
      }
      if (pivot.revised_hypothesis) {
        lines.push('>', `> **Revised hypothesis:** ${markdownParagraph(pivot.revised_hypothesis)}`);
      }
      if (pivot.revised_strategy) {
        lines.push('>', `> **Revised strategy:** ${markdownParagraph(pivot.revised_strategy)}`);
      }
      if (pivot.revised_scope) {
        lines.push('>', `> **Revised scope:** ${markdownParagraph(pivot.revised_scope)}`);
      }
      if (pivot.revised_completion_criteria) {
        lines.push('>', `> **Revised completion criteria:** ${markdownParagraph(pivot.revised_completion_criteria)}`);
      }
      if (pivot.from_plan_type !== pivot.to_plan_type) {
        lines.push(
          '>',
          `> **Reclassified:** ${PLAN_TYPE_LABELS[pivot.from_plan_type]} → ${PLAN_TYPE_LABELS[pivot.to_plan_type]}`,
        );
      }
      if (pivot.superseded.length) {
        lines.push('>', `> **Superseded tasks:** ${pivot.superseded.map(markdownCode).join(', ')}`);
      }
      if (pivot.added.length) {
        lines.push('>', `> **Added tasks:** ${pivot.added.map(markdownCode).join(', ')}`);
      }
      if (pivot.evidence_refs.length) {
        lines.push('>', `> **Evidence files:** ${pivot.evidence_refs.map(markdownCode).join(', ')}`);
      }
      lines.push('');
    }
  }

  lines.push(
    `---`,
    '',
    `Generated deterministically from structured plan revision ${state.revision}. Use the investigation plan interface to make changes.`,
    '',
  );
  return lines.join('\n');
}

function paragraphs(value) {
  return String(value || '')
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function evidenceRefs(refs = []) {
  if (!refs.length) return '';
  return `<div class="evidence-refs"><strong>Evidence files</strong>${refs.map((ref) => `<code>${escapeHtml(ref)}</code>`).join('')}</div>`;
}

function taskList(view) {
  return view.tasks.map((task) => `
    <li class="task status-${escapeHtml(task.status)}">
      <div class="task-marker" aria-hidden="true">${STATUS_ICONS[task.status]}</div>
      <div class="task-copy">
        <div class="task-heading"><code>${escapeHtml(task.id)}</code><strong>${escapeHtml(task.title)}</strong><span>${STATUS_LABELS[task.status]}</span></div>
        ${task.why ? `<p class="task-why">${escapeHtml(task.why)}</p>` : ''}
        ${task.evidence.length ? `<div class="evidence-intent">${task.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${task.outcome ? `<div class="task-outcome"><strong>Outcome</strong>${paragraphs(task.outcome)}</div>` : ''}
        ${evidenceRefs(task.evidence_refs)}
      </div>
    </li>`).join('');
}

function planTimeline(view) {
  const history = [
    ...(view.changes || [])
      .filter((change) => change.kind === 'tasks_added')
      .map((change) => ({ kind: 'tasks_added', revision: change.revision, change })),
    ...view.pivots.map((pivot) => ({ kind: 'pivot', revision: pivot.revision, pivot })),
  ].sort((left, right) => left.revision - right.revision);
  if (!history.length) return '<p class="empty">No checklist expansions or material pivots have been recorded.</p>';
  const entries = history.map((entry) => {
    if (entry.kind === 'tasks_added') {
      const { change } = entry;
      return `
        <article class="pivot checklist-change">
          <div class="pivot-meta"><strong>Tasks added · revision ${change.revision}</strong><time>${escapeHtml(change.at)}</time></div>
          <p>${escapeHtml(change.reason || 'Checklist expanded.')}</p>
          <p class="pivot-links"><strong>Added</strong> ${(change.task_ids || []).map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')}</p>
        </article>`;
    }
    const { pivot } = entry;
    return `
      <article class="pivot">
        <div class="pivot-meta"><strong>${escapeHtml(pivot.id)} · revision ${pivot.revision}</strong><time>${escapeHtml(pivot.at)}</time></div>
        <dl>
          <div><dt>Trigger</dt><dd>${escapeHtml(pivot.trigger)}</dd></div>
          <div><dt>Decision</dt><dd>${escapeHtml(pivot.decision)}</dd></div>
          ${pivot.revised_objective ? `<div><dt>Revised objective</dt><dd>${escapeHtml(pivot.revised_objective)}</dd></div>` : ''}
          ${pivot.revised_hypothesis ? `<div><dt>Revised hypothesis</dt><dd>${escapeHtml(pivot.revised_hypothesis)}</dd></div>` : ''}
          ${pivot.revised_strategy ? `<div><dt>Revised strategy</dt><dd>${escapeHtml(pivot.revised_strategy)}</dd></div>` : ''}
          ${pivot.revised_scope ? `<div><dt>Revised scope</dt><dd>${escapeHtml(pivot.revised_scope)}</dd></div>` : ''}
          ${pivot.revised_completion_criteria ? `<div><dt>Revised completion criteria</dt><dd>${escapeHtml(pivot.revised_completion_criteria)}</dd></div>` : ''}
          ${pivot.from_plan_type !== pivot.to_plan_type ? `<div><dt>Reclassified</dt><dd>${escapeHtml(PLAN_TYPE_LABELS[pivot.from_plan_type])} → ${escapeHtml(PLAN_TYPE_LABELS[pivot.to_plan_type])}</dd></div>` : ''}
        </dl>
        ${pivot.superseded.length ? `<p class="pivot-links"><strong>Superseded</strong> ${pivot.superseded.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')}</p>` : ''}
        ${pivot.added.length ? `<p class="pivot-links"><strong>Added</strong> ${pivot.added.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ')}</p>` : ''}
        ${evidenceRefs(pivot.evidence_refs)}
      </article>`;
  }).join('');
  return `<div class="timeline">${entries}</div>`;
}

function typeSpecificBody(view) {
  if (view.plan_type === 'threat_hunt') {
    return `
      <section class="type-section hunt-framing">
        <div class="section-heading"><span>01</span><h2>Hunt hypothesis and falsification</h2></div>
        <div class="two-up"><article><h3>Question being tested</h3>${paragraphs(view.objective)}</article><article><h3>Working hypothesis</h3>${paragraphs(view.hypothesis)}</article></div>
        <article class="accent-callout"><h3>Exit and falsification criteria</h3>${paragraphs(view.completion_criteria)}</article>
      </section>
      <section class="type-section hunt-coverage">
        <div class="section-heading"><span>02</span><h2>Coverage and search strategy</h2></div>
        <div class="two-up"><article><h3>Population, window, and boundaries</h3>${paragraphs(view.scope)}</article><article><h3>Signals and evidence ladder</h3>${paragraphs(view.strategy)}</article></div>
      </section>`;
  }
  if (view.plan_type === 'security_investigation') {
    return `
      <section class="type-section incident-framing">
        <div class="section-heading"><span>01</span><h2>Incident framing and decision question</h2></div>
        <article class="accent-callout"><h3>Investigation objective</h3>${paragraphs(view.objective)}</article>
        <div class="two-up"><article><h3>Affected scope and window</h3>${paragraphs(view.scope)}</article><article><h3>Current assessment hypothesis</h3>${paragraphs(view.hypothesis)}</article></div>
      </section>
      <section class="type-section incident-evidence">
        <div class="section-heading"><span>02</span><h2>Evidence and disposition path</h2></div>
        <div class="two-up"><article><h3>Evidence sequence</h3>${paragraphs(view.strategy)}</article><article><h3>Decision-ready completion</h3>${paragraphs(view.completion_criteria)}</article></div>
      </section>`;
  }
  return `
    <section class="type-section performance-framing">
      <div class="section-heading"><span>01</span><h2>Service impact and baseline</h2></div>
      <article class="accent-callout"><h3>Symptom and operational objective</h3>${paragraphs(view.objective)}</article>
      <div class="two-up"><article><h3>Service scope, window, and peers</h3>${paragraphs(view.scope)}</article><article><h3>Performance hypothesis</h3>${paragraphs(view.hypothesis)}</article></div>
    </section>
    <section class="type-section performance-measurement">
      <div class="section-heading"><span>02</span><h2>Measurement and dependency strategy</h2></div>
      <div class="two-up"><article><h3>Latency, errors, volume, and saturation</h3>${paragraphs(view.strategy)}</article><article><h3>Baseline and success criteria</h3>${paragraphs(view.completion_criteria)}</article></div>
    </section>`;
}

function structuredBody(view) {
  return `
    <header class="masthead">
      <div class="eyebrow"><span class="type-pill">${escapeHtml(view.plan_type_label)}</span><span class="revision-chip">Revision ${view.revision}</span></div>
      <h1>${escapeHtml(view.title)}</h1>
      <div class="masthead-meta"><span class="plan-state">${escapeHtml(view.state)}</span><span>${view.progress.resolved} of ${view.progress.total} tasks resolved</span><span>Updated ${escapeHtml(view.updated_at)}</span></div>
      <div class="progress" role="progressbar" aria-label="Plan progress" aria-valuemin="0" aria-valuemax="${view.progress.total}" aria-valuenow="${view.progress.resolved}"><span style="width:${view.progress.percent}%"></span></div>
    </header>
    <main>
      ${typeSpecificBody(view)}
      <section class="checklist-section">
        <div class="section-heading"><span>03</span><h2>Active investigation checklist</h2></div>
        <div class="progress-grid">
          <div><strong>${view.progress.pending}</strong><span>Pending</span></div>
          <div><strong>${view.progress.in_progress}</strong><span>In progress</span></div>
          <div><strong>${view.progress.blocked}</strong><span>Blocked</span></div>
          <div><strong>${view.progress.completed}</strong><span>Completed</span></div>
          <div><strong>${view.progress.skipped + view.progress.superseded}</strong><span>Closed by plan change</span></div>
        </div>
        <ol class="task-list">${taskList(view)}</ol>
      </section>
      <section class="pivot-section">
        <div class="section-heading"><span>04</span><h2>Plan evolution and decision history</h2></div>
        ${planTimeline(view)}
      </section>
    </main>
    <footer>Generated deterministically from structured investigation plan revision ${view.revision}. Plan content is reasoning context, not evidence.</footer>`;
}

function renderLegacyMarkdown(markdown) {
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function renderLink({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const safeHref = /^(?:https?:\/\/|#[a-z0-9_.:-]+$)/i.test(href || '') ? href : '';
    if (!safeHref) return label;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    const externalAttributes = /^https?:\/\//i.test(safeHref)
      ? ' target="_blank" rel="noopener noreferrer"'
      : '';
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute}${externalAttributes}>${label}</a>`;
  };
  renderer.image = ({ text }) => `<span class="image-alt">Image: ${escapeHtml(text || 'untitled')}</span>`;
  return marked.parse(String(markdown || ''), {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });
}

function unstructuredBody(view) {
  const title = view.title || (view.legacy ? 'Legacy investigation plan' : 'Investigation plan awaiting initialization');
  return `
    <header class="masthead"><div class="eyebrow"><span class="type-pill">${view.legacy ? 'Legacy plan' : 'Awaiting plan'}</span></div><h1>${escapeHtml(title)}</h1></header>
    <main>
      <section class="type-section">
        <div class="section-heading"><span>—</span><h2>${view.legacy ? 'Preserved Markdown plan' : 'Structured plan not initialized'}</h2></div>
        ${view.legacy
          ? `<p class="empty">This historical plan is preserved without conversion or overwrite.</p><article class="legacy-markdown">${renderLegacyMarkdown(view.markdown)}</article>`
          : '<p class="empty">The investigator has not initialized the structured plan yet.</p>'}
      </section>
    </main>`;
}

function htmlShell(view, body) {
  const accent = TYPE_ACCENTS[view.plan_type] || '#7F2854';
  const textAccent = TYPE_TEXT_ACCENTS[view.plan_type] || '#7F2854';
  const darkTextAccent = TYPE_DARK_TEXT_ACCENTS[view.plan_type] || '#E1ADCA';
  const badgeAccent = TYPE_BADGE_ACCENTS[view.plan_type] || '#7F2854';
  const template = String(view.plan_type || 'unstructured').replaceAll('_', '-');
  return `<!doctype html>
<html lang="en" data-report-theme="light" data-plan-type="${escapeHtml(view.plan_type || 'unstructured')}" data-plan-template="${escapeHtml(template)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(view.title || 'Investigation plan')}</title>
<link rel="stylesheet" href="/vendor/source-sans-3/source-sans-3.css">
<style>
/* Mirrors public/styles.css: same surfaces, hairlines, chips, and type scale,
   with the plan-type accent applied only as quiet color-mix tints. */
:root{--sapphire:#261F63;--plum:#7F2854;--type-accent:${accent};--type-text:${textAccent};--type-dark-text:${darkTextAccent};--type-badge:${badgeAccent};
  --canvas:#f4f4f8;--paper:#ffffff;--panel:#fcfcfe;
  --ink:#16151f;--text-2:#3c3b47;--muted:#898a8d;--faint:#adadb6;
  --hairline:#e9e9ef;--chip-bg:#f1f0fa;--chip-border:#e2e0f2;--track:#ececf2;
  --ok:#2bb673;--warn:#f05918;
  --active-mark-bg:var(--type-badge);--active-mark-fg:#ffffff;
  --shadow-soft:0 1px 2px rgba(22,21,31,.04),0 8px 24px rgba(38,31,99,.06);
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-family:"Source Sans 3",Arial,sans-serif;color-scheme:light}
html[data-report-theme="dark"]{--sapphire:#b3a8f2;--plum:#d171a0;--type-text:var(--type-dark-text);
  --canvas:#131218;--paper:#1a1922;--panel:#201f29;
  --ink:#ececf2;--text-2:#c4c3cf;--muted:#9b9ba6;--faint:#74737f;
  --hairline:#2e2d3a;--chip-bg:#2a2740;--chip-border:#3a3656;--track:#2a2935;
  --ok:#3cc98a;--warn:#ff8a4c;
  --active-mark-bg:color-mix(in srgb,var(--type-text) 20%,var(--paper));--active-mark-fg:var(--type-text);
  --shadow-soft:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.keyline{height:4px;background:linear-gradient(135deg,#261F63,#7F2854)}

.masthead{padding:38px clamp(24px,6vw,64px) 30px;background:color-mix(in srgb,var(--type-accent) 3%,var(--paper));border-bottom:1px solid var(--hairline)}
.eyebrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.type-pill{padding:3px 10px;border:1px solid color-mix(in srgb,var(--type-accent) 28%,var(--hairline));border-radius:999px;background:color-mix(in srgb,var(--type-accent) 7%,var(--paper));color:var(--type-text);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.revision-chip{padding:3px 9px;border:1px solid var(--chip-border);border-radius:999px;background:var(--chip-bg);color:var(--text-2);font-family:var(--mono);font-size:10.5px;font-weight:700}
.masthead h1{max-width:820px;margin:14px 0 10px;font-size:clamp(1.6rem,3.2vw,2.3rem);font-weight:700;line-height:1.12;letter-spacing:-.02em}
.masthead-meta{display:flex;flex-wrap:wrap;color:var(--text-2);font-size:13.5px}
.masthead-meta span+span::before{content:"·";margin:0 10px;color:var(--faint)}
.plan-state{color:var(--type-text);font-weight:700;text-transform:capitalize}
.progress{height:6px;max-width:560px;margin-top:18px;background:var(--track);border-radius:999px;overflow:hidden}
.progress span{display:block;height:100%;background:var(--type-text);border-radius:inherit}

main{max-width:980px;margin:0 auto;padding:30px clamp(18px,4vw,32px) 48px}
.type-section,.checklist-section,.pivot-section{margin-bottom:20px;padding:clamp(20px,3vw,28px);background:var(--paper);border:1px solid var(--hairline);border-radius:12px;box-shadow:var(--shadow-soft)}
.section-heading{display:flex;align-items:center;gap:10px;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--hairline)}
.section-heading>span{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:22px;padding:0 8px;border-radius:7px;background:color-mix(in srgb,var(--type-accent) 10%,var(--paper));color:var(--type-text);font-family:var(--mono);font-size:11px;font-weight:800}
.section-heading h2{margin:0;color:var(--sapphire);font-size:1.15rem;font-weight:700;letter-spacing:-.01em}
.two-up{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.two-up article,.accent-callout{padding:16px 18px;background:var(--panel);border:1px solid var(--hairline);border-radius:10px}
.accent-callout{margin-bottom:12px;border-left:3px solid var(--type-accent)}
h3{margin:0 0 6px;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
p{margin:.4em 0;color:var(--text-2)}

.progress-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:18px}
.progress-grid div{padding:12px 8px;text-align:center;background:var(--panel);border:1px solid var(--hairline);border-radius:10px}
.progress-grid strong{display:block;color:var(--ink);font-size:1.35rem;font-weight:700;font-variant-numeric:tabular-nums}
.progress-grid span{color:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}

.task-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.task{display:grid;grid-template-columns:28px 1fr;gap:12px;align-items:start;padding:14px 16px;background:var(--panel);border:1px solid var(--hairline);border-radius:10px}
.task-marker{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:var(--chip-bg);color:var(--sapphire);font-size:12px;font-weight:800}
.task.status-in_progress{border-color:color-mix(in srgb,var(--type-accent) 30%,var(--hairline));background:color-mix(in srgb,var(--type-accent) 3%,var(--panel))}
.task.status-in_progress .task-marker{background:var(--active-mark-bg);color:var(--active-mark-fg);font-size:10px}
.task.status-completed .task-marker{background:var(--ok);color:#fff}
.task.status-blocked .task-marker{background:color-mix(in srgb,var(--warn) 12%,var(--paper));color:var(--warn)}
.task.status-skipped .task-marker,.task.status-superseded .task-marker{color:var(--faint)}
.task.status-skipped .task-heading strong,.task.status-superseded .task-heading strong{color:var(--muted);text-decoration:line-through;text-decoration-color:var(--faint)}
.task-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}
.task-heading code,.pivot code,.evidence-refs code,.pivot-links code{padding:2px 6px;border:1px solid var(--chip-border);border-radius:5px;background:var(--chip-bg);color:var(--sapphire);font-family:var(--mono);font-size:11.5px}
.task-heading strong{color:var(--ink);font-size:15px}
.task-heading>span{margin-left:auto;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.task-why{color:var(--muted);font-size:13.5px}
.evidence-intent,.evidence-refs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.evidence-intent span{padding:2px 9px;border:1px solid var(--chip-border);border-radius:999px;color:var(--text-2);font-size:12px}
.evidence-refs strong{margin-right:2px;color:var(--muted);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.task-outcome{margin-top:10px;padding:10px 14px;background:color-mix(in srgb,var(--type-accent) 4%,var(--panel));border-left:3px solid var(--type-accent);border-radius:0 8px 8px 0}
.task-outcome>strong{color:var(--muted);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}

.timeline{position:relative}
.timeline::before{content:"";position:absolute;top:12px;bottom:12px;left:5px;width:1px;background:var(--hairline)}
.pivot{position:relative;padding:14px 0 14px 26px}
.pivot::before{content:"";position:absolute;left:1px;top:21px;width:9px;height:9px;border-radius:50%;background:var(--type-text);box-shadow:0 0 0 3px color-mix(in srgb,var(--type-accent) 12%,var(--paper))}
.pivot+.pivot{border-top:1px solid var(--hairline)}
.pivot-meta{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px}
.pivot-meta strong{color:var(--ink);font-size:14.5px}
.pivot-meta time{color:var(--muted);font-family:var(--mono);font-size:11.5px}
.pivot dl{margin:0}
.pivot dl div{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:4px 0}
.pivot dt{padding-top:3px;color:var(--muted);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.pivot dd{margin:0;color:var(--text-2)}
.pivot-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.pivot-links strong{color:var(--muted);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}

.empty{color:var(--muted)}
.legacy-markdown{padding:4px 2px;color:var(--text-2);overflow-wrap:anywhere}
.legacy-markdown>:first-child{margin-top:0}.legacy-markdown>:last-child{margin-bottom:0}
.legacy-markdown h1,.legacy-markdown h2,.legacy-markdown h3,.legacy-markdown h4{margin:1.35em 0 .5em;color:var(--ink);font-weight:700;line-height:1.2;letter-spacing:-.01em;text-transform:none}
.legacy-markdown h1{font-size:1.65rem}.legacy-markdown h2{padding-bottom:.35em;border-bottom:1px solid var(--hairline);font-size:1.3rem}.legacy-markdown h3{color:var(--sapphire);font-size:1.08rem;letter-spacing:0}.legacy-markdown h4{font-size:1rem}
.legacy-markdown p,.legacy-markdown ul,.legacy-markdown ol,.legacy-markdown blockquote,.legacy-markdown pre,.legacy-markdown table{margin:.8em 0}
.legacy-markdown ul,.legacy-markdown ol{padding-left:1.6em}.legacy-markdown li+li{margin-top:.28em}.legacy-markdown li>p{margin:.25em 0}
.legacy-markdown input[type="checkbox"]{margin:0 .45em 0 0;accent-color:var(--type-text)}
.legacy-markdown blockquote{padding:.2em 1em;border-left:3px solid var(--type-accent);background:color-mix(in srgb,var(--type-accent) 4%,var(--panel));color:var(--muted)}
.legacy-markdown code{padding:.12em .35em;border:1px solid var(--chip-border);border-radius:4px;background:var(--chip-bg);color:var(--sapphire);font-family:var(--mono);font-size:.88em}
.legacy-markdown pre{overflow:auto;padding:14px 16px;border:1px solid var(--hairline);border-radius:8px;background:var(--panel)}.legacy-markdown pre code{padding:0;border:0;background:none;color:var(--text-2)}
.legacy-markdown table{width:100%;border-collapse:collapse}.legacy-markdown th,.legacy-markdown td{padding:8px 10px;border:1px solid var(--hairline);text-align:left}.legacy-markdown th{background:var(--panel);color:var(--ink)}
.legacy-markdown a{color:var(--type-text);text-underline-offset:2px}.legacy-markdown hr{margin:1.5em 0;border:0;border-top:1px solid var(--hairline)}.legacy-markdown .image-alt{color:var(--muted);font-style:italic}
footer{padding:8px 24px 40px;text-align:center;color:var(--faint);font-size:12.5px}

@media(max-width:760px){.two-up{grid-template-columns:1fr}.progress-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pivot dl div{grid-template-columns:1fr;gap:2px}.task-heading>span{margin-left:0;width:100%}}
@media print{body{background:#fff}.masthead{padding:26px 32px;background:#fff}.type-section,.checklist-section,.pivot-section{box-shadow:none;break-inside:avoid}main{max-width:none;padding:22px 28px}.task,.pivot{break-inside:avoid}}
</style>
</head>
<body><div class="keyline" aria-hidden="true"></div>${body}</body>
</html>`;
}

export function renderInvestigationPlanHtml(input) {
  let view;
  if (input?.schema_version === INVESTIGATION_PLAN_SCHEMA_VERSION && !input?.structured) {
    view = publicPlanView(input);
  } else if (input?.plan && Object.hasOwn(input, 'initialized')) {
    const plan = input.plan;
    view = {
      structured: input.structured === true,
      legacy: input.legacy === true,
      revision: input.revision || 0,
      plan_type: plan.planType || null,
      plan_type_label: plan.planTypeLabel || PLAN_TYPE_LABELS[plan.planType] || 'Investigation plan',
      title: plan.title || 'Investigation plan',
      objective: plan.objective || '',
      scope: plan.scope || '',
      hypothesis: plan.hypothesis || '',
      strategy: plan.evidenceStrategy || '',
      completion_criteria: plan.completionCriteria || '',
      tasks: (plan.tasks || []).map((task) => ({
        ...task,
        evidence_refs: task.evidenceRefs || task.evidence_refs || [],
        evidence: task.evidence || [],
      })),
      pivots: (plan.pivots || []).map((pivot) => ({
        ...pivot,
        revised_objective: pivot.revisedObjective || pivot.revised_objective || '',
        revised_hypothesis: pivot.revisedHypothesis || pivot.revised_hypothesis || '',
        revised_strategy: pivot.revisedStrategy || pivot.revised_strategy || '',
        revised_scope: pivot.revisedScope || pivot.revised_scope || '',
        revised_completion_criteria: pivot.revisedCompletionCriteria || pivot.revised_completion_criteria || '',
        from_plan_type: pivot.fromPlanType || pivot.from_plan_type || plan.planType,
        to_plan_type: pivot.toPlanType || pivot.to_plan_type || plan.planType,
        evidence_refs: pivot.evidenceRefs || pivot.evidence_refs || [],
        superseded: pivot.superseded || [],
        added: pivot.added || [],
      })),
      changes: (plan.changes || []).map((change) => ({
        revision: change.revision,
        at: change.at,
        kind: change.kind,
        reason: change.reason || '',
        task_ids: change.taskIds || change.task_ids || [],
      })),
      progress: input.progress || {},
      state: input.progress?.state || 'active',
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
      markdown: plan.markdown || '',
    };
  } else if (input && Object.hasOwn(input, 'initialized') && !input.initialized) {
    view = {
      structured: false,
      legacy: false,
      title: 'Investigation plan awaiting initialization',
      progress: input.progress || {},
    };
  } else {
    view = input;
  }
  if (!view || typeof view !== 'object') {
    throw new TypeError('An investigation plan view or state is required.');
  }
  return htmlShell(view, view.structured ? structuredBody(view) : unstructuredBody(view));
}
