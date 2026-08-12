// The subagent roster (#120). Run: node --test agents/agents.test.js
//
// An agent definition is only real if the harness can load it AND the lead's
// prompt tells the lead when to use it. These check both halves, plus the two
// invariants the design puts on specialists: they are cheaper than the lead, and
// they report rather than judge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SYSTEM_PROMPT } from '../lib/agent-session.js';

const AGENTS = path.resolve(import.meta.dirname);
const agentFiles = fs.readdirSync(AGENTS)
  .filter((name) => name.endsWith('.md'));

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

test('every agent definition is loadable and named after its file', () => {
  assert.ok(agentFiles.length >= 1, `found ${agentFiles.length} agent definitions`);
  for (const name of agentFiles) {
    const { fields, body } = frontmatter(path.join(AGENTS, name));
    assert.equal(fields.name, name.replace(/\.md$/, ''), `${name}: frontmatter name matches the filename`);
    assert.ok(fields.description?.length > 20, `${name}: has a description the lead can route on`);
    assert.ok(fields.model, `${name}: pins a model — an untiered specialist saves nothing`);
    assert.ok(body.trim().length > 0, `${name}: has a body`);
  }
});

test('no specialist runs on the lead\'s own tier', () => {
  // The entire premise is cheap agents doing volume. A specialist silently
  // defaulting to Opus would report a saving it never made.
  for (const name of agentFiles) {
    const { fields } = frontmatter(path.join(AGENTS, name));
    assert.notEqual(fields.model, 'opus', `${name}: a specialist on Opus is not a specialist`);
  }
});

test('the telemetry specialist reports and never judges', () => {
  const { fields, body } = frontmatter(path.join(AGENTS, 'telemetry.md'));
  assert.equal(fields.model, 'haiku', 'the telemetry role is the cheap, high-volume one');
  // The design's hard risk: "cheap agent misreads telemetry, lead inherits a
  // wrong premise". The mitigation is that specialists never return a
  // disposition, so the prohibition has to be in the prompt in so many words.
  assert.match(body, /never.{0,40}(disposition|judge)/is, 'states the no-disposition rule');
  assert.match(body, /GAPS/, 'requires gaps/truncation to be reported, not swallowed');
  // Open decision 2: Haiku's context ceiling is 200K where the lead's is far
  // larger, so the chunking contract is a shipped requirement, not a note.
  assert.match(body, /200K|context/i, 'carries the smaller-context contract');
  assert.match(body, /untrusted|adversar/i, 'carries the untrusted-telemetry boundary');
});

test('the lead is told when to delegate, and when not to', () => {
  // The prompt is hard-wrapped, so any phrase can straddle a newline. Match
  // against a whitespace-normalised copy rather than writing every assertion
  // around wherever the lines happen to break today.
  const prompt = SYSTEM_PROMPT.replace(/\s+/g, ' ');
  assert.match(prompt, /subagent_type: "telemetry"/, 'names the specialist it can actually spawn');
  assert.match(prompt, /Do not delegate/i, 'has an explicit do-not list');
  // Constraint 2 in the design: Opus 5 delegates readily, so an uncapped lead
  // trades cache-read cost for spawn cost.
  assert.match(prompt, /at most 3 delegations/i, 'caps the spawn count');
  assert.match(prompt, /never a disposition/i, 'restates that the specialist does not judge');
  assert.match(prompt, /evidence ladder/i, 'keeps the ladder with the lead');
});

test('every agent the lead can spawn exists on disk', () => {
  // A prompt naming an agent that does not ship is a lie the lead cannot detect.
  for (const [, name] of SYSTEM_PROMPT.matchAll(/subagent_type:\s*"([a-z-]+)"/g)) {
    assert.ok(
      fs.existsSync(path.join(AGENTS, `${name}.md`)),
      `the prompt offers subagent_type "${name}" but agents/${name}.md does not exist`,
    );
  }
});
