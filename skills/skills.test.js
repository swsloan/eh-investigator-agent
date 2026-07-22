import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SYSTEM_PROMPT } from '../lib/agent-session.js';

const SKILLS = path.resolve(import.meta.dirname);
const ROOT = path.resolve(SKILLS, '..');

const skillDirs = fs.readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} must open with a YAML frontmatter block`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([a-z_]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].replace(/^"|"$/g, '').trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

test('every skill directory is a loadable skill named after its directory', () => {
  assert.ok(skillDirs.length >= 12, `found ${skillDirs.length} skills`);
  for (const dir of skillDirs) {
    const file = path.join(SKILLS, dir, 'SKILL.md');
    assert.ok(fs.existsSync(file), `${dir}/SKILL.md exists — a directory without one is invisible to the agent`);
    const { fields, body } = frontmatter(file);
    assert.equal(fields.name, dir, `${dir}: frontmatter name matches the directory`);
    assert.ok(fields.description?.length > 20, `${dir}: has a description the model can route on`);
    assert.ok(body.trim().length > 0, `${dir}: has a body`);
  }
});

test('every workspace interface a skill tells the agent to run actually ships', () => {
  // This is the check that matters for the plan port: a skill promising
  // ./investigation-plan is a lie until the interface exists and is executable.
  const referenced = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.name.endsWith('.md')) continue;
      for (const match of fs.readFileSync(abs, 'utf8').matchAll(/`\.\/([a-z][a-z0-9-]*)/g)) {
        referenced.add(match[1]);
      }
    }
  };
  walk(SKILLS);

  assert.ok(referenced.has('investigation-plan'), 'the planning skill names the interface');
  assert.ok(referenced.has('excli-interface'), 'sanity check that the scan works');
  for (const name of referenced) {
    const file = path.join(ROOT, name);
    assert.ok(fs.existsSync(file), `./${name} is referenced by a skill and must ship at the repo root`);
    assert.doesNotThrow(() => fs.accessSync(file, fs.constants.X_OK), `./${name} must be executable`);
  }
});

test('the planning skill and the system prompt agree on how the plan is managed', () => {
  const { body } = frontmatter(path.join(SKILLS, 'investigation-planning', 'SKILL.md'));
  // Prose in both files is hard-wrapped, so sentences are matched against a
  // whitespace-normalized copy rather than pinning where the line breaks fall.
  const prompt = SYSTEM_PROMPT.replace(/\s+/g, ' ');
  for (const operation of ['init', 'add', 'update', 'pivot', 'status']) {
    assert.match(body, new RegExp(`\\./investigation-plan ${operation}\\b`), `documents the ${operation} operation`);
  }
  for (const planType of ['threat_hunt', 'security_investigation', 'performance_investigation']) {
    assert.match(body, new RegExp(planType), `names the ${planType} classification`);
    assert.match(prompt, new RegExp(planType), `the prompt names ${planType} too`);
  }
  // Both must forbid hand-editing the projection; that rule is what keeps the
  // generated Markdown consistent with the authoritative state file.
  assert.match(body.replace(/\s+/g, ' '), /[Nn]ever edit/, 'the skill forbids editing the projection');
  assert.match(prompt, /never edit, replace, or patch it directly/i, 'the prompt forbids it as well');
  assert.match(prompt, /investigation-plan\.md/, 'the prompt names the projection it is talking about');
});

test('the workflow references point at the plan instead of a pasted checklist', () => {
  // PR #61 restored these checklists verbatim on the promise that Plan Shape
  // would replace them once the planning tool landed. This is that promise.
  for (const name of ['triage-workflow.md', 'investigation-workflow.md']) {
    const text = fs.readFileSync(path.join(SKILLS, 'extrahop-triage', 'references', name), 'utf8');
    assert.match(text, /## Plan Shape/, `${name} uses Plan Shape`);
    assert.match(text, /\.\/investigation-plan/, `${name} points at the tool`);
    assert.doesNotMatch(text, /- \[ \] Step \d/, `${name} no longer pastes a step checklist`);
  }
});

test('the entry-point skills open by initializing a correctly typed plan', () => {
  const cases = [
    ['extrahop-triage', 'security_investigation'],
    ['extrahop-health-check', 'performance_investigation'],
  ];
  for (const [skill, planType] of cases) {
    const { body } = frontmatter(path.join(SKILLS, skill, 'SKILL.md'));
    const firstStep = body.match(/^1\. (.+(?:\n {3}.+)*)$/m)?.[1] || '';
    assert.match(firstStep, /investigation-planning/, `${skill}: planning is step 1, before evidence collection`);
    assert.match(firstStep, new RegExp(planType), `${skill}: initializes a ${planType} plan`);
  }
});

test('the resume path is documented where the agent is told to initialize', () => {
  // The entry-point skills say "initialize"; the resume case is carried by the
  // skill they delegate to and by the always-in-context system prompt. Both must
  // keep saying it, because an agent that blindly re-inits a resumed plan gets a
  // PLAN_ALREADY_INITIALIZED refusal instead of the current plan. (That refusal
  // is safe — the store never overwrites an existing plan — but it wastes a turn.)
  const { body } = frontmatter(path.join(SKILLS, 'investigation-planning', 'SKILL.md'));
  assert.match(
    body.replace(/\s+/g, ' '),
    /run `\.\/investigation-plan status` before changing the plan/,
    'the planning skill tells a resuming agent to read state first',
  );
  assert.match(
    SYSTEM_PROMPT.replace(/\s+/g, ' '),
    /resumed investigation, call `\.\/investigation-plan status`/,
    'the system prompt carries the same resume rule',
  );
});

test('the plan template asset the store compares against still ships', () => {
  const asset = path.join(SKILLS, 'investigation-planning', 'assets', 'investigation-plan.md');
  assert.ok(fs.existsSync(asset), 'the placeholder template is part of the skill');
  assert.match(fs.readFileSync(asset, 'utf8'), /artifact-kind: investigation-plan/);
});
