// Conclusion-quality auditor (issue #31) — the "quality" facet of agent auditing,
// split from the #30 activity trail.
//
// This asks a different question than the eval harness. `eval/harness/score.js`
// grades an investigation against a LABELED expected answer (accuracy, ladder vs
// `min_rung`, calibration vs correctness) — it only works on eval cases. This
// module audits the INTERNAL SOUNDNESS of any real investigation with NO ground
// truth: do the verdict's claims trace to real evidence, does it assert entities
// the evidence doesn't support, did it climb the evidence ladder as deep as the
// strength of its own claims requires, and is its stated confidence calibrated to
// that support? It never needs to know the "right" answer — only whether the
// investigation is self-consistent and grounded.
//
// Pure and READ-ONLY: it reads `evidence/verdict.json` and the workspace evidence
// files and returns a report; it never mutates the investigation or memory. That
// keeps its risk MEDIUM (issue #31) — no enforcement path.

import fs from 'node:fs';
import path from 'node:path';
import { checkCitations } from './citation-check.js';

const RUNGS = ['metrics', 'records', 'packets'];
const rungIdx = (r) => {
  const i = RUNGS.indexOf(String(r || '').toLowerCase());
  return i === -1 ? 0 : i;
};

// A definitive disposition makes a strong claim; "inconclusive" / "not-determined"
// deliberately doesn't and is held to a lower evidentiary bar.
const DEFINITIVE = new Set(['malicious', 'benign', 'benign-authorized', 'false-positive']);

// How much evidence bytes we're willing to scan for entity grounding, so a giant
// PCAP-derived JSON can't make the check pathological.
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

const norm = (s) => String(s || '').toLowerCase();

/** Read verdict.json, or null when absent/unparseable (an ungrounded conclusion). */
function readVerdict(workspace) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspace, 'evidence', 'verdict.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Every claim string the verdict makes: the evidence chain + the timeline. */
function verdictClaims(verdict) {
  const out = [];
  for (const e of Array.isArray(verdict.evidence_chain) ? verdict.evidence_chain : []) {
    if (e && typeof e.claim === 'string') out.push({ text: e.claim, source: typeof e.source === 'string' ? e.source : '', kind: 'claim' });
  }
  for (const t of Array.isArray(verdict.timeline) ? verdict.timeline : []) {
    const text = [t?.event, t?.detail].filter((x) => typeof x === 'string').join(' — ');
    if (text) out.push({ text, source: typeof t?.evidence === 'string' ? t.evidence : '', kind: 'timeline' });
  }
  return out;
}

/** IPv4 addresses in a string (octet-validated), the highest-signal entity type
 * to check for grounding — unambiguous and rarely a false positive. */
export function extractIps(text) {
  const out = new Set();
  const re = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    if (m.slice(1).every((o) => Number(o) <= 255)) out.add(m[0]);
  }
  return [...out];
}

/** Concatenated text of the workspace's evidence files, bounded. This is the
 * corpus a claimed entity must appear in to count as "supported by evidence." */
function evidenceCorpus(workspace) {
  const dir = path.join(workspace, 'evidence');
  let budget = MAX_SCAN_BYTES;
  const parts = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (budget <= 0) return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (ent.name === 'verdict.json') continue; // don't count the claims as their own evidence
      try {
        const buf = fs.readFileSync(p, { encoding: 'utf8' }).slice(0, budget);
        budget -= Buffer.byteLength(buf);
        parts.push(buf);
      } catch { /* skip unreadable */ }
    }
  };
  walk(dir);
  return norm(parts.join('\n'));
}

/**
 * The evidence rung a verdict's own claims REQUIRE, derived only from the verdict
 * (no ground truth). A definitive disposition asserted with medium/high confidence
 * must corroborate beyond metrics — the evidence-ladder discipline is explicit
 * that you never close on the detection object / metrics alone (records establish
 * *what happened*). Inconclusive or low-confidence calls may legitimately stop at
 * metrics. Packets are only required by residual doubt, which we don't infer here.
 */
export function requiredRung(verdict) {
  const disposition = norm(verdict.disposition);
  const confidence = norm(verdict.confidence);
  if (!DEFINITIVE.has(disposition)) return 0;      // metrics is fine for a non-claim
  if (confidence === 'low') return 0;               // a hedged definitive call isn't strongly asserted
  return 1;                                         // records
}

/**
 * Audit one investigation workspace. Returns:
 *   {
 *     has_verdict, score (0..1), grade,
 *     traceability: { coverage, total, present, uncited, missing },
 *     hallucinated_entities: [{ entity, claim, kind }],
 *     ladder: { required, used, shortfall },
 *     calibration: { signal: 'calibrated'|'over-confident'|'under-confident', reasons[] },
 *     flags: [{ severity, code, message, claim?, source?, entity? }],
 *   }
 * Every flag points at the offending claim / evidence / entity.
 */
export function assessConclusionQuality(workspace) {
  const verdict = readVerdict(workspace);
  if (!verdict) {
    return {
      has_verdict: false, score: 0, grade: 'F',
      traceability: { coverage: 0, total: 0, present: 0, uncited: [], missing: [] },
      hallucinated_entities: [], ladder: { required: 0, used: 0, shortfall: false },
      calibration: { signal: 'over-confident', reasons: ['No verdict.json — the conclusion is unrecorded/ungrounded.'] },
      flags: [{ severity: 'high', code: 'no_verdict', message: 'No evidence/verdict.json; nothing to audit.' }],
    };
  }

  const flags = [];

  // 1. Traceability — evidence_chain (via the shared checker) + timeline evidence.
  const cite = checkCitations(workspace);
  for (const src of cite.missing) flags.push({ severity: 'high', code: 'missing_evidence', message: `Cited evidence file does not exist: ${src}`, source: src });
  for (const claim of cite.uncited) flags.push({ severity: 'high', code: 'uncited_claim', message: `Claim cites no evidence source: "${claim}"`, claim });

  const root = path.resolve(workspace);
  let timelineTotal = 0;
  let timelinePresent = 0;
  for (const t of Array.isArray(verdict.timeline) ? verdict.timeline : []) {
    const src = typeof t?.evidence === 'string' ? t.evidence.trim() : '';
    if (!src) continue;
    timelineTotal++;
    const abs = path.resolve(workspace, src);
    if ((abs === root || abs.startsWith(root + path.sep)) && fs.existsSync(abs)) timelinePresent++;
    else flags.push({ severity: 'medium', code: 'missing_timeline_evidence', message: `Timeline entry cites a missing evidence file: ${src}`, source: src });
  }

  // 2. Hallucinated entities — an IP asserted in a claim/timeline that appears in
  // NO evidence file. Conservative (IPs only) to avoid false positives.
  const corpus = evidenceCorpus(workspace);
  const hallucinated = [];
  const seen = new Set();
  for (const claim of verdictClaims(verdict)) {
    for (const ip of extractIps(claim.text)) {
      const key = `${ip}::${claim.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!corpus.includes(norm(ip))) {
        hallucinated.push({ entity: ip, claim: claim.text, kind: claim.kind });
        flags.push({ severity: 'high', code: 'hallucinated_entity', message: `Entity "${ip}" is asserted but appears in no evidence file.`, entity: ip, claim: claim.text });
      }
    }
  }

  // 3. Evidence-ladder adherence — did the investigation climb as deep as its own
  // claims require?
  const required = requiredRung(verdict);
  const used = rungIdx(verdict.highest_rung_used);
  const shortfall = used < required;
  if (shortfall) {
    flags.push({
      severity: 'medium', code: 'ladder_shortfall',
      message: `A ${norm(verdict.disposition)} verdict at ${norm(verdict.confidence)} confidence reached only the "${RUNGS[used]}" rung; the evidence ladder wants at least "${RUNGS[required]}" to corroborate a definitive call.`,
    });
  }

  // 4. Confidence calibration — is stated confidence supported by the evidence?
  const confidence = norm(verdict.confidence);
  const residual = typeof verdict.residual_uncertainty === 'string' ? verdict.residual_uncertainty.trim() : '';
  const calibrationReasons = [];
  let signal = 'calibrated';
  if (confidence === 'high') {
    if (cite.coverage < 0.8) calibrationReasons.push(`high confidence but citation coverage is ${Math.round(cite.coverage * 100)}%`);
    if (cite.uncited.length) calibrationReasons.push(`high confidence with ${cite.uncited.length} uncited claim(s)`);
    if (shortfall) calibrationReasons.push('high confidence but the evidence ladder fell short of the claim');
    if (hallucinated.length) calibrationReasons.push(`high confidence with ${hallucinated.length} unsupported entity assertion(s)`);
    if (residual) calibrationReasons.push('high confidence despite stated residual uncertainty');
    if (calibrationReasons.length) signal = 'over-confident';
  } else if (confidence === 'low' && DEFINITIVE.has(norm(verdict.disposition))
    && cite.coverage >= 0.8 && !shortfall && !hallucinated.length && !residual && cite.total > 0) {
    signal = 'under-confident';
    calibrationReasons.push('a fully-cited, ladder-adherent definitive verdict is stated at only low confidence');
  }
  if (signal === 'over-confident') {
    flags.push({ severity: 'medium', code: 'over_confident', message: `Confidence looks over-stated: ${calibrationReasons.join('; ')}.` });
  }

  // Overall score — a transparent weighted blend, 0..1. Traceability dominates
  // (an uncited/ungrounded conclusion is the worst failure); hallucinated entities
  // are heavily penalized; ladder + calibration are lighter advisory weights.
  const traceScore = cite.total ? cite.coverage : 0; // no claims at all → 0 (ungrounded)
  const timelineScore = timelineTotal ? timelinePresent / timelineTotal : 1;
  const entityScore = hallucinated.length ? Math.max(0, 1 - 0.34 * hallucinated.length) : 1;
  const ladderScore = shortfall ? 0.5 : 1;
  const calibrationScore = signal === 'over-confident' ? 0.5 : (signal === 'under-confident' ? 0.85 : 1);
  const score = Number((
    0.40 * traceScore
    + 0.10 * timelineScore
    + 0.25 * entityScore
    + 0.15 * ladderScore
    + 0.10 * calibrationScore
  ).toFixed(4));

  return {
    has_verdict: true,
    score,
    grade: gradeFor(score),
    traceability: {
      coverage: cite.coverage, total: cite.total, present: cite.present,
      uncited: cite.uncited, missing: cite.missing,
      timeline_total: timelineTotal, timeline_present: timelinePresent,
    },
    hallucinated_entities: hallucinated,
    ladder: { required: RUNGS[required], used: RUNGS[used], shortfall },
    calibration: { signal, reasons: calibrationReasons },
    flags: flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1)),
  };
}

function gradeFor(score) {
  if (score >= 0.9) return 'A';
  if (score >= 0.8) return 'B';
  if (score >= 0.7) return 'C';
  if (score >= 0.6) return 'D';
  return 'F';
}
