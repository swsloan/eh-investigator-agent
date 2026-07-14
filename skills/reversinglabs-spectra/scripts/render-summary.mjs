#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isReversingLabsEnvelope,
  renderReversingLabsSummaryDocument,
  summarizeReversingLabsEnvelope,
} from '../../../lib/reversinglabs-summary.js';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_DIRECTORY = 'reversinglabs';

function fail(message) {
  process.stderr.write(`RL Summary: ${message}\n`);
  process.exitCode = 1;
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readEnvelopes(directory, workspace) {
  const names = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (names.length > MAX_FILES) throw new Error(`refusing to process more than ${MAX_FILES} JSON files`);
  const envelopes = [];
  for (const name of names) {
    const absolute = path.join(directory, name);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue;
    let value;
    try { value = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { continue; }
    if (!isReversingLabsEnvelope(value) || value.operation === 'probe') continue;
    envelopes.push({
      value,
      sourcePath: path.relative(workspace, absolute).split(path.sep).join('/'),
    });
  }
  return envelopes;
}

try {
  const workspace = process.cwd();
  const requestedDirectory = process.argv[2] || DEFAULT_DIRECTORY;
  const directory = path.resolve(workspace, requestedDirectory);
  if (!inside(workspace, directory)) throw new Error('the source directory must stay inside the workspace');
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) {
    throw new Error(`${requestedDirectory} does not exist or is not a directory`);
  }

  const envelopes = readEnvelopes(directory, workspace);
  const resultBearingLookups = envelopes.filter(({ value, sourcePath }) => (
    summarizeReversingLabsEnvelope(value, { sourcePath }).materialResultCount > 0
  ));
  if (resultBearingLookups.length < 2) {
    throw new Error('at least two ReversingLabs lookups with real results are required');
  }
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const template = fs.readFileSync(path.join(skillDir, 'assets', 'rl-summary-template.html'), 'utf8');
  const output = renderReversingLabsSummaryDocument(template, envelopes);
  const outputPath = path.join(directory, 'rl-summary.html');
  const temporary = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, output, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, outputPath);
  process.stdout.write(`${path.relative(workspace, outputPath).split(path.sep).join('/')}\n`);
} catch (error) {
  fail(error.message || String(error));
}
