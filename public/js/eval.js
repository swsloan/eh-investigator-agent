// Eval tab: run the in-app eval, edit/sign-off case labels, tweak harness knobs,
// and open the full dashboard. Talks to /api/eval/*.

const $ = (id) => document.getElementById(id);
let pollTimer = null;

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const usd = (x) => `$${Number(x || 0).toFixed(2)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DISPOS = ['malicious', 'benign', 'false-positive', 'benign-authorized', 'inconclusive'];
const RUNGS = ['metrics', 'records', 'packets'];

// ---------- run status + result ----------
function renderStatus(s) {
  const box = $('eval-status');
  if (!s || s.status === 'idle') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (s.status === 'running') {
    const p = s.total ? Math.round((s.index / s.total) * 100) : 0;
    const par = s.maxParallel > 1 ? ` · ${s.maxParallel} in parallel` : '';
    box.className = 'eval-status running';
    box.innerHTML = `<div class="eval-line"><span class="spinner"></span> Running eval — ${s.index || 0} of ${s.total || '…'} cases complete${par}</div>
      <div class="eval-bar"><div class="eval-bar-fill" style="width:${p}%"></div></div>
      <div class="panel-sub">Real read-only investigations — this takes a few minutes. You can close this dialog; the run continues.</div>`;
    return;
  }
  if (s.status === 'error') { box.className = 'eval-status error'; box.textContent = `Eval failed: ${s.error || 'unknown error'}`; return; }
  const a = s.aggregates || {};
  const pass = s.gate?.pass;
  box.className = 'eval-status done';
  box.innerHTML = `<div class="eval-gate ${pass ? 'pass' : 'fail'}">${pass ? '✓ Autonomy gate: PASS' : '✗ Autonomy gate: FAIL'}</div>
    ${s.gate?.reasons?.length ? `<div class="panel-sub" style="margin-bottom:8px">${esc(s.gate.reasons.join('; '))}</div>` : ''}
    <div class="eval-metrics">
      <div class="eval-metric"><span class="k">False-close</span><span class="v ${pass ? 'good' : 'bad'}">${pct(a.false_close_rate)}</span><span class="s">target &lt; ${pct(s.gate?.false_close_target)}</span></div>
      <div class="eval-metric"><span class="k">Accuracy</span><span class="v">${pct(a.verdict_accuracy)}</span></div>
      <div class="eval-metric"><span class="k">Adherence</span><span class="v">${pct(a.ladder_adherence)}</span></div>
      <div class="eval-metric"><span class="k">Cost/case</span><span class="v">${usd(a.cost_per_case_usd)}</span></div>
    </div>
    <div class="panel-sub">Run <code>${esc(s.runId)}</code> · <a href="/api/eval/dashboard" target="_blank" rel="noopener">full dashboard ↗</a></div>`;
}

async function renderRuns() {
  try {
    const runs = await getJSON('/api/eval/runs');
    const box = $('eval-runs');
    if (!runs.length) { box.innerHTML = '<div class="panel-sub">No runs yet.</div>'; return; }
    const rows = runs.slice().reverse().slice(0, 12).map((r) => {
      const a = r.aggregates || {};
      const g = r.gate?.pass ? '<span class="pill ok">PASS</span>' : '<span class="pill bad">FAIL</span>';
      return `<tr><td>${esc(r.skill_version || r.run_id)}</td><td>${esc(r.backend || '')}</td><td>${esc((r.timestamp || '').slice(0, 10))}</td><td>${pct(a.false_close_rate)}</td><td>${pct(a.verdict_accuracy)}</td><td>${usd(a.cost_per_case_usd)}</td><td style="text-align:right">${g}</td></tr>`;
    }).join('');
    box.innerHTML = `<table class="eval-table"><tr><th>run</th><th>backend</th><th>date</th><th>false-close</th><th>accuracy</th><th>cost</th><th style="text-align:right">gate</th></tr>${rows}</table>`;
  } catch { /* keep prior */ }
}

// ---------- cases / labels editor ----------
function caseRow(c) {
  const opt = (list, sel) => list.map((v) => `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`).join('');
  const signed = c.signed_off ? '<span class="pill ok">signed</span>' : '<span class="pill">seed</span>';
  const promoted = c.promoted ? '<span class="pill promoted" title="Promoted from an investigation">promoted</span>' : '';
  return `<div class="eval-case" data-id="${esc(c.id)}">
    <div class="eval-case-head">
      <label class="eval-inc"><input type="checkbox" class="eval-inc-cb" checked> <code>${esc(c.id)}</code></label>
      ${promoted}${signed}
    </div>
    <div class="eval-case-fields">
      <label>Disposition<select class="ec-disp">${opt(DISPOS, c.expected.disposition)}</select></label>
      <label>Min rung<select class="ec-rung">${opt(RUNGS, c.expected.min_rung)}</select></label>
      <label>ATT&CK<input class="ec-attack" type="text" value="${esc((c.expected.attack || []).join(', '))}" placeholder="T1071.001"></label>
    </div>
    <label class="eval-notes">Notes<textarea class="ec-notes" rows="2">${esc(c.notes || '')}</textarea></label>
    <div class="eval-case-actions">
      <label class="eval-signoff"><input type="checkbox" class="ec-signed"${c.signed_off ? ' checked' : ''}> Signed off</label>
      <button type="button" class="ec-save">Save</button>
      <span class="ec-saved"></span>
    </div>
  </div>`;
}

async function renderCases() {
  const box = $('eval-cases');
  let cases;
  try { cases = await getJSON('/api/eval/cases'); }
  catch (e) { box.innerHTML = `<div class="panel-sub">Could not load cases: ${esc(e.message)}</div>`; return; }
  $('eval-cases-count').textContent = `${cases.length} case${cases.length === 1 ? '' : 's'}`;
  box.innerHTML = cases.map(caseRow).join('');
  box.querySelectorAll('.eval-case').forEach((row) => {
    row.querySelector('.ec-save').addEventListener('click', async () => {
      const saved = row.querySelector('.ec-saved');
      const body = {
        expected: {
          disposition: row.querySelector('.ec-disp').value,
          min_rung: row.querySelector('.ec-rung').value,
          attack: row.querySelector('.ec-attack').value.split(/[,\s]+/).filter(Boolean),
        },
        notes: row.querySelector('.ec-notes').value,
        signed_off: row.querySelector('.ec-signed').checked,
      };
      saved.textContent = 'saving…';
      try {
        await getJSON(`/api/eval/cases/${encodeURIComponent(row.dataset.id)}`, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        saved.textContent = 'saved ✓';
        const pill = row.querySelector('.eval-case-head .pill');
        pill.textContent = body.signed_off ? 'signed' : 'seed';
        pill.className = body.signed_off ? 'pill ok' : 'pill';
        setTimeout(() => { saved.textContent = ''; }, 1500);
      } catch (e) { saved.textContent = `error: ${e.message}`; }
    });
  });
}

// ---------- promote an investigation to a case ----------
// Opened from a session's ⋯ menu. Pre-fills from the run's verdict.json; the
// analyst edits + confirms; persists to the writable promoted-case store so it
// shows up in the case list + eval runner with no rebuild.
export async function openPromoteDialog(session) {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const card = document.createElement('div');
  card.className = 'modal-card promote-card';
  card.innerHTML = '<div class="modal-head"><span>Promote to eval case</span></div><div class="modal-body promote-body"><div class="panel-sub">Loading investigation…</div></div>';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const cleanup = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onKey);

  let pre;
  try { pre = await getJSON(`/api/eval/cases/prefill/${encodeURIComponent(session.id)}`); }
  catch (e) { card.querySelector('.promote-body').innerHTML = `<div class="panel-sub">Could not load this session: ${esc(e.message)}</div>`; return; }

  const opt = (list, sel) => list.map((v) => `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`).join('');
  card.querySelector('.promote-body').innerHTML = `
    ${pre.has_verdict ? '<div class="panel-sub">Pre-filled from this investigation’s verdict. Edit anything, then promote.</div>'
      : '<div class="promote-warn">No <code>verdict.json</code> for this session — fields are defaults. Make sure the prompt reproduces the investigation before promoting.</div>'}
    <label class="promote-field">Case id<input class="pf-id" type="text" value="${esc(pre.id)}"></label>
    <label class="promote-field">Prompt <span class="panel-sub">(must reproduce the investigation)</span><textarea class="pf-prompt" rows="3">${esc(pre.prompt)}</textarea></label>
    <div class="promote-row">
      <label class="promote-field">Disposition<select class="pf-disp">${opt(DISPOS, pre.expected.disposition)}</select></label>
      <label class="promote-field">Min rung<select class="pf-rung">${opt(RUNGS, pre.expected.min_rung)}</select></label>
    </div>
    <label class="promote-field">ATT&amp;CK<input class="pf-attack" type="text" value="${esc((pre.expected.attack || []).join(', '))}" placeholder="T1649, T1187"></label>
    <label class="promote-field">Notes<textarea class="pf-notes" rows="3">${esc(pre.notes)}</textarea></label>
    <label class="promote-signoff"><input type="checkbox" class="pf-signed"> Sign off now (mark as confirmed ground truth)</label>
    <div class="promote-status" aria-live="polite"></div>`;
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  foot.innerHTML = '<button type="button" class="btn-secondary slim pf-cancel">Cancel</button><button type="button" class="btn-primary slim pf-save">Promote</button>';
  card.appendChild(foot);

  const status = card.querySelector('.promote-status');
  foot.querySelector('.pf-cancel').addEventListener('click', cleanup);
  foot.querySelector('.pf-save').addEventListener('click', async () => {
    const body = {
      id: card.querySelector('.pf-id').value.trim(),
      prompt: card.querySelector('.pf-prompt').value.trim(),
      notes: card.querySelector('.pf-notes').value,
      expected: {
        disposition: card.querySelector('.pf-disp').value,
        min_rung: card.querySelector('.pf-rung').value,
        attack: card.querySelector('.pf-attack').value.split(/[,\s]+/).filter(Boolean),
      },
      signed_off: card.querySelector('.pf-signed').checked,
      sessionId: session.id,
    };
    status.className = 'promote-status';
    status.textContent = 'Promoting…';
    foot.querySelector('.pf-save').disabled = true;
    try {
      await getJSON('/api/eval/cases/promote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      status.textContent = 'Promoted ✓ — find it in Settings → Eval.';
      if (document.querySelector('.settings-nav-btn[data-panel="eval"]')?.classList.contains('active')) renderCases();
      setTimeout(cleanup, 1300);
    } catch (e) {
      status.className = 'promote-status error';
      status.textContent = `Error: ${e.message}`;
      foot.querySelector('.pf-save').disabled = false;
    }
  });
  requestAnimationFrame(() => card.querySelector('.pf-id')?.focus());
}

function selectedCaseIds() {
  const all = [...document.querySelectorAll('#eval-cases .eval-case')];
  const checked = all.filter((r) => r.querySelector('.eval-inc-cb').checked).map((r) => r.dataset.id);
  return checked.length === all.length ? null : checked; // null => all
}

// ---------- polling + orchestration ----------
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function tick() {
  try {
    const s = await getJSON('/api/eval/status');
    renderStatus(s);
    $('eval-run-btn').disabled = s.status === 'running';
    if (s.status !== 'running') { stopPolling(); renderRuns(); }
  } catch { /* transient */ }
}

async function refresh() {
  await Promise.all([renderCases(), renderRuns(), tick()]);
  if (!pollTimer && $('eval-run-btn').disabled) pollTimer = setInterval(tick, 2500);
}

export function initEval() {
  const btn = $('eval-run-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const gate = parseFloat($('eval-gate').value);
    const accuracy = parseFloat($('eval-accuracy')?.value);
    const cost = parseFloat($('eval-cost').value);
    const parallel = parseInt($('eval-parallel').value, 10);
    const body = {};
    if (Number.isFinite(gate)) body.gateTarget = gate;
    if (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 1) body.accuracyFloor = accuracy;
    if (Number.isFinite(cost) && cost > 0) body.costCeiling = cost;
    if (Number.isFinite(parallel) && parallel > 0) body.maxParallel = parallel;
    const mode = $('eval-mode')?.value;
    if (mode) body.mode = mode;
    const ids = selectedCaseIds();
    if (ids) { if (!ids.length) { btn.disabled = false; return; } body.caseIds = ids; }
    try {
      await getJSON('/api/eval/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      stopPolling(); pollTimer = setInterval(tick, 2500); tick();
    } catch (err) {
      btn.disabled = false;
      const box = $('eval-status');
      box.classList.remove('hidden'); box.className = 'eval-status error';
      box.textContent = `Could not start eval: ${err.message}`;
    }
  });
  document.querySelector('.settings-nav-btn[data-panel="eval"]')?.addEventListener('click', refresh);
}
