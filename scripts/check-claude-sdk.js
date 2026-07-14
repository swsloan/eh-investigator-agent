#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const STATE_PATH = path.join(ROOT, '.claude-sdk-check.json');

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/, '');
}

export function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ''] = normalizeVersion(value).split('-', 2);
    return { numbers: core.split('.').map(Number), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

export function canReuseDailyCheck(state, { checkedOn, lockedVersion }) {
  return Boolean(
    state
    && state.checkedOn === checkedOn
    && state.installedVersion === lockedVersion
    && normalizeVersion(state.latestVersion),
  );
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return fallback;
    throw err;
  }
}

function lockedSdkVersion(lock) {
  const version = lock?.packages?.[`node_modules/${PACKAGE_NAME}`]?.version;
  if (!normalizeVersion(version)) {
    throw new Error(`Could not find ${PACKAGE_NAME} in package-lock.json.`);
  }
  return normalizeVersion(version);
}

async function fetchLatestVersion() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { stdout } = await execFile(npm, ['view', PACKAGE_NAME, 'version', '--json'], {
    cwd: ROOT,
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    value = stdout;
  }
  const version = normalizeVersion(Array.isArray(value) ? value.at(-1) : value);
  if (!version) throw new Error('npm returned no Claude Agent SDK version.');
  return version;
}

async function writeState(state) {
  const temporary = `${STATE_PATH}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(temporary, STATE_PATH);
  } catch (err) {
    if (process.platform !== 'win32' || !['EEXIST', 'EPERM'].includes(err.code)) throw err;
    await fs.rm(STATE_PATH, { force: true });
    await fs.rename(temporary, STATE_PATH);
  }
}

function printResult({ checkedOn, installedVersion, latestVersion, cached }) {
  const updateAvailable = compareVersions(latestVersion, installedVersion) > 0;
  const prefix = cached ? 'Claude Agent SDK check already completed today.' : 'Claude Agent SDK check completed.';
  console.log(prefix);
  console.log(`Locked: ${installedVersion}`);
  console.log(`Latest: ${latestVersion}`);
  console.log(updateAvailable
    ? `Update available: ${installedVersion} -> ${latestVersion}. Suggest a tested dependency bump; do not install automatically.`
    : 'The locked Claude Agent SDK is current.');
  return { checkedOn, installedVersion, latestVersion, updateAvailable };
}

export async function main(argv = process.argv.slice(2)) {
  const force = argv.includes('--force');
  const checkedOn = localDateKey();
  const lock = await readJson(LOCK_PATH);
  const installedVersion = lockedSdkVersion(lock);
  const previous = await readJson(STATE_PATH);

  if (!force && canReuseDailyCheck(previous, { checkedOn, lockedVersion: installedVersion })) {
    return printResult({ ...previous, cached: true });
  }

  const latestVersion = await fetchLatestVersion();
  const state = { checkedOn, installedVersion, latestVersion };
  await writeState(state);
  return printResult({ ...state, cached: false });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Could not check the Claude Agent SDK version: ${err.message || err}`);
    console.error('No successful daily result was recorded; continue other work and retry later.');
    process.exitCode = 1;
  });
}
