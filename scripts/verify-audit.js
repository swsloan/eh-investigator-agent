#!/usr/bin/env node
// Offline audit-trail verifier (#30, Slice A). Recomputes the hash chain over an
// exported trail and reports OK, or the exact entry where it broke. No secrets,
// no network, no app state — an auditor can run it against an exported record.
//
//   node scripts/verify-audit.js <path-to-audit.jsonl>
//   ...  | node scripts/verify-audit.js -      (read from stdin)
//
// Exit code 0 = intact, 1 = tampered/broken, 2 = usage error.
import fs from 'node:fs';
import { verifyTrail } from '../lib/audit-trail.js';

function readInput(arg) {
  if (!arg) return null;
  if (arg === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(arg, 'utf8');
}

const arg = process.argv[2];
let text;
try {
  text = readInput(arg);
} catch (err) {
  process.stderr.write(`verify-audit: cannot read ${arg}: ${err.message}\n`);
  process.exit(2);
}
if (text == null) {
  process.stderr.write('usage: node scripts/verify-audit.js <audit.jsonl | ->\n');
  process.exit(2);
}

const result = verifyTrail(text);
if (result.ok) {
  process.stdout.write(`OK — audit trail intact: ${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}, chain head ${result.head.slice(0, 16)}…\n`);
  process.exit(0);
}
process.stdout.write(`TAMPERED — chain broke at entry index ${result.brokenAt}: ${result.reason}\n`);
process.exit(1);
