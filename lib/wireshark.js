import { execFile as execFileCallback, spawn as spawnCallback } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIRESHARK_TIMEOUT_MS = 5_000;
const PCAP_RE = /\.(?:pcap|pcapng|cap)(?:\.gz)?$/i;

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

function appExists(appPath, fsModule) {
  try {
    return fsModule.existsSync(appPath);
  } catch {
    return false;
  }
}

function macWiresharkPaths(homeDir = os.homedir()) {
  return [
    '/Applications/Wireshark.app',
    path.join(homeDir, 'Applications', 'Wireshark.app'),
  ];
}

export function isPacketCapturePath(relPath) {
  return PCAP_RE.test(String(relPath || ''));
}

export async function detectWireshark({
  execFile = execFileCallback,
  fsModule = fs,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  try {
    await execFilePromise(execFile, 'wireshark', ['-v'], {
      timeout: WIRESHARK_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return {
      ok: true,
      method: 'path',
      message: 'Wireshark is available on PATH.',
    };
  } catch {
    // Fall through to platform-specific GUI checks.
  }

  if (platform === 'darwin') {
    const appPath = macWiresharkPaths(homeDir).find((candidate) => appExists(candidate, fsModule));
    if (appPath) {
      return {
        ok: true,
        method: 'mac-app',
        message: `Wireshark is installed at ${appPath}.`,
      };
    }
  }

  return {
    ok: false,
    method: '',
    message: platform === 'darwin'
      ? 'Wireshark is not on PATH and no Wireshark.app was found in /Applications.'
      : 'Wireshark is not on PATH.',
  };
}

export function openPacketCaptureInWireshark(file, {
  spawn = spawnCallback,
  platform = process.platform,
} = {}) {
  const command = platform === 'darwin' ? 'open' : 'wireshark';
  const args = platform === 'darwin' ? ['-a', 'Wireshark', file] : [file];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref?.();
      resolve();
    });
  });
}
