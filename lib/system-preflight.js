import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { credentialsConfigured, publicSettings } from './settings.js';
import { detectWireshark } from './wireshark.js';

const TSHARK_TIMEOUT_MS = 5_000;
const EXCLI_PROBE_TIMEOUT_MS = 5_000;

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function executableCheck(file, fsModule = fs) {
  try {
    const stat = fsModule.statSync(file);
    if (!stat.isFile()) return false;
    fsModule.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function checkExcliBroker(root, excliBroker, fsModule = fs) {
  if (excliBroker?.status) return excliBroker.status(fsModule);
  const interfacePath = path.join(root, 'excli-interface');
  const binaryPath = path.join(root, 'bin', 'excli');
  const interfaceOk = executableCheck(interfacePath, fsModule);
  const binaryOk = executableCheck(binaryPath, fsModule);
  return [
    {
      id: 'excli_interface',
      label: 'ExtraHop CLI interface',
      ok: interfaceOk,
      optional: false,
      message: interfaceOk
        ? './excli-interface is executable.'
        : './excli-interface is missing or not executable.',
    },
    {
      id: 'excli_broker',
      label: 'ExtraHop CLI broker',
      ok: false,
      optional: false,
      message: 'The local excli broker is not listening.',
    },
    {
      id: 'excli_binary',
      label: 'ExtraHop CLI binary',
      ok: binaryOk,
      optional: false,
      message: binaryOk
        ? 'bin/excli is executable.'
        : 'bin/excli is missing or not executable. Run ./start.sh to install the bundled binary for this platform.',
    },
  ];
}

function firstLine(text = '') {
  return text.trim().split('\n').find(Boolean) || '';
}

const OS_LABELS = { darwin: 'macOS', linux: 'Linux', windows: 'Windows' };
const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

export function detectBinaryOs(filePath, fsModule = fs) {
  let fd;
  try {
    fd = fsModule.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    if (fsModule.readSync(fd, header, 0, 4, 0) < 4) return null;
    if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) return 'linux';
    if (MACHO_MAGICS.has(header.readUInt32BE(0))) return 'darwin';
    if (header[0] === 0x4d && header[1] === 0x5a) return 'windows';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fsModule.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function checkBinaryPlatform(binaryPath, fsModule, platform) {
  const binaryOs = detectBinaryOs(binaryPath, fsModule);
  const hostOs = platform === 'win32' ? 'windows' : platform;
  if (!binaryOs || !(hostOs in OS_LABELS) || binaryOs === hostOs) return null;
  return {
    ok: false,
    message: `bin/excli is a ${OS_LABELS[binaryOs]} binary and cannot run on this ${OS_LABELS[hostOs]} host. Run ./start.sh to install the bundled binary for this platform.`,
  };
}

async function probeExcliBinary(binaryPath, execFile = execFileCallback) {
  for (const args of [['-version'], ['--version']]) {
    try {
      const { stdout, stderr } = await execFilePromise(execFile, binaryPath, args, {
        timeout: EXCLI_PROBE_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      });
      const version = firstLine(stdout) || firstLine(stderr);
      if (version) {
        return { ok: true, message: `bin/excli is executable (${version}).` };
      }
    } catch {
      // Some excli builds may not support a version flag; -help is the contract.
    }
  }
  try {
    await execFilePromise(execFile, binaryPath, ['-help'], {
      timeout: EXCLI_PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return { ok: true, message: 'bin/excli is executable and -help succeeded.' };
  } catch (err) {
    const detail = (err.stderr || err.message || '').trim().split('\n').slice(-2).join(' ');
    return {
      ok: false,
      message: `bin/excli is present but failed -help${detail ? `: ${detail}` : '.'}`,
    };
  }
}

function execFilePromise(execFile, command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout = '', stderr = '') => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function checkTshark(execFile = execFileCallback) {
  try {
    await execFilePromise(execFile, 'tshark', ['-v'], {
      timeout: TSHARK_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return {
      id: 'tshark',
      label: 'tshark',
      ok: true,
      optional: true,
      message: 'tshark is available for packet capture analysis.',
    };
  } catch {
    return {
      id: 'tshark',
      label: 'tshark',
      ok: false,
      optional: true,
      message: 'Optional tshark is not on PATH; PCAP analysis will be limited.',
    };
  }
}

async function checkWireshark(execFile = execFileCallback, fsModule = fs) {
  const result = await detectWireshark({ execFile, fsModule });
  return {
    id: 'wireshark',
    label: 'Wireshark',
    ok: result.ok,
    optional: true,
    message: result.ok
      ? `${result.message} Packet captures can be opened from the file viewer.`
      : `${result.message} Packet captures can still be downloaded.`,
  };
}

function checkCredentials(config, secretStore, credentialsConfiguredFn = credentialsConfigured) {
  const settings = publicSettings(config, secretStore);
  const hasCredentials = credentialsConfiguredFn(config, secretStore);
  const hasHost = Boolean(settings.extrahop.host);
  const hasSecret = settings.extrahop.family === 'rx360'
    ? Boolean(settings.extrahop.clientIdSet && settings.extrahop.clientSecretSet)
    : Boolean(settings.extrahop.apiKeySet);
  const missingMessage = !hasHost
    ? 'ExtraHop host is not configured.'
    : !hasSecret
      ? 'ExtraHop credentials are not configured.'
      : 'ExtraHop configuration is incomplete.';
  return {
    id: 'extrahop_credentials',
    label: 'ExtraHop credentials',
    ok: hasCredentials,
    optional: false,
    message: hasCredentials
      ? `ExtraHop credentials are configured${settings.extrahop.host ? ` for ${settings.extrahop.host}` : ''}.`
      : missingMessage,
  };
}

export function summarizePreflight(checks) {
  const requiredFailures = checks.filter((check) => !check.optional && !check.ok);
  if (requiredFailures.length) {
    return {
      ok: false,
      state: 'error',
      text: 'Setup needed',
      message: `${plural(requiredFailures.length, 'required check')} failed.`,
    };
  }
  return {
    ok: true,
    state: 'ok',
    text: 'Ready',
    message: 'All required checks passed.',
  };
}

export async function getSystemPreflight({
  root = path.resolve(import.meta.dirname, '..'),
  config,
  backend,
  modelCatalog,
  execFile = execFileCallback,
  fsModule = fs,
  credentialsConfiguredFn = credentialsConfigured,
  secretStore,
  excliBroker,
  reversingLabsBroker,
  researchBroker,
  platform = process.platform,
} = {}) {
  const checks = [];
  checks.push(...await backend.preflightChecks({ modelCatalog, execFile }));

  checks.push(...checkExcliBroker(root, excliBroker, fsModule));
  const binaryCheck = checks.find((check) => check.id === 'excli_binary');
  if (binaryCheck?.ok) {
    const binaryPath = excliBroker?.excliBinaryPath || path.join(root, 'bin', 'excli');
    const probe = checkBinaryPlatform(binaryPath, fsModule, platform)
      || await probeExcliBinary(binaryPath, execFile);
    binaryCheck.ok = probe.ok;
    binaryCheck.message = probe.message;
  }
  if (reversingLabsBroker?.status) checks.push(...reversingLabsBroker.status(fsModule));
  if (researchBroker?.status) checks.push(...researchBroker.status(fsModule));
  checks.push(await checkTshark(execFile));
  checks.push(await checkWireshark(execFile, fsModule));
  checks.push(checkCredentials(config, secretStore, credentialsConfiguredFn));

  const summary = summarizePreflight(checks);
  return {
    ...summary,
    generatedAt: Date.now(),
    checks,
  };
}
