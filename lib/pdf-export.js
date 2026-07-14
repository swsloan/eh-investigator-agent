import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_ROOT = path.join(ROOT, 'public');
const PDF_EXPORT_TIMEOUT_MS = Number(process.env.WEASYPRINT_TIMEOUT_MS || 120_000);
const HTML_EXTS = new Set(['.html', '.htm']);
const HOMEBREW_WEASYPRINT_BINS = [
  '/opt/homebrew/bin/weasyprint',
  '/usr/local/bin/weasyprint',
];
const LOCAL_WEASYPRINT_BIN = path.join(ROOT, '.venv', 'bin', 'weasyprint');
const LOCAL_WEASYPRINT_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
export const PDF_EXPORT_STYLESHEET = `
@media print {
  img,
  svg,
  canvas,
  video {
    max-width: 100% !important;
    max-height: 9.2in !important;
    object-fit: contain !important;
  }
}
`;

export function isHtmlFile(abs) {
  return HTML_EXTS.has(path.extname(abs).toLowerCase());
}

function pdfNameFor(abs) {
  return `${path.basename(abs).replace(/\.[^.]+$/, '') || 'download'}.pdf`;
}

function tempPath(ext) {
  return path.join(os.tmpdir(), `eh-investigator-${crypto.randomUUID()}${ext}`);
}

function fileUrlFor(abs) {
  return pathToFileURL(abs).href;
}

function splitUrlSuffix(value) {
  const match = String(value || '').match(/^([^?#]*)(.*)$/);
  return { pathname: match?.[1] || '', suffix: match?.[2] || '' };
}

function publicAssetUrl(value) {
  const { pathname, suffix } = splitUrlSuffix(value);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return `/${value}`;
  }
  const resolved = path.resolve(PUBLIC_ROOT, decodedPath);
  if (resolved !== PUBLIC_ROOT && !resolved.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
    return `/${value}`;
  }
  return `${fileUrlFor(resolved)}${suffix}`;
}

export function rewriteRootRelativePublicUrls(html) {
  return String(html || '')
    .replace(/\b(href|src)\s*=\s*(["'])\/(vendor\/[^"'<>\s]*)\2/gi, (_match, attr, quote, value) => (
      `${attr}=${quote}${publicAssetUrl(value)}${quote}`
    ))
    .replace(/url\(\s*(["']?)\/(vendor\/[^"')\s]+)\1\s*\)/gi, (_match, quote, value) => (
      `url(${quote}${publicAssetUrl(value)}${quote})`
    ));
}

function baseUrlFor(abs) {
  return fileUrlFor(`${path.dirname(abs)}${path.sep}`);
}

function buildWeasyPrintArgs(input, out, stylesheet, baseUrl) {
  return ['-u', baseUrl, '-s', stylesheet, input, out];
}

function preparePdfInput(abs) {
  const input = tempPath('.html');
  const stylesheet = tempPath('.css');
  const html = rewriteRootRelativePublicUrls(fs.readFileSync(abs, 'utf8'));
  fs.writeFileSync(input, html, { mode: 0o600 });
  fs.writeFileSync(stylesheet, PDF_EXPORT_STYLESHEET, { mode: 0o600 });
  return {
    input,
    stylesheet,
    baseUrl: baseUrlFor(abs),
    cleanup() {
      fs.rmSync(input, { force: true });
      fs.rmSync(stylesheet, { force: true });
    },
  };
}

function runPdfCommand(file, args, abs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      cwd: path.dirname(abs),
      timeout: PDF_EXPORT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (!err) return resolve();
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

function missingWeasyPrintError() {
  const err = new Error(
    'WeasyPrint is not installed. Install it with Homebrew or run `npm run setup:python`, then restart the server.'
  );
  err.statusCode = 503;
  return err;
}

function isMissingWeasyPrint(err) {
  return err.code === 'ENOENT' || /No module named weasyprint/i.test(err.stderr || '');
}

export async function renderPdf(abs, out, { runCommand = runPdfCommand } = {}) {
  const prepared = preparePdfInput(abs);
  const homebrewCommands = HOMEBREW_WEASYPRINT_BINS
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, args: buildWeasyPrintArgs(prepared.input, out, prepared.stylesheet, prepared.baseUrl) }));
  const localCommands = [
    fs.existsSync(LOCAL_WEASYPRINT_BIN)
      ? { file: LOCAL_WEASYPRINT_BIN, args: buildWeasyPrintArgs(prepared.input, out, prepared.stylesheet, prepared.baseUrl) }
      : null,
    fs.existsSync(LOCAL_WEASYPRINT_PYTHON)
      ? {
          file: LOCAL_WEASYPRINT_PYTHON,
          args: ['-m', 'weasyprint', ...buildWeasyPrintArgs(prepared.input, out, prepared.stylesheet, prepared.baseUrl)],
        }
      : null,
  ].filter(Boolean);
  const commands = process.env.WEASYPRINT_BIN
    ? [{ file: process.env.WEASYPRINT_BIN, args: buildWeasyPrintArgs(prepared.input, out, prepared.stylesheet, prepared.baseUrl) }]
    : [
        ...homebrewCommands,
        ...localCommands,
        { file: 'weasyprint', args: buildWeasyPrintArgs(prepared.input, out, prepared.stylesheet, prepared.baseUrl) },
        { file: 'python3', args: ['-m', 'weasyprint', ...buildWeasyPrintArgs(prepared.input, out, prepared.stylesheet, prepared.baseUrl)] },
      ];

  let missing = false;
  try {
    for (const command of commands) {
      try {
        await runCommand(command.file, command.args, abs);
        return;
      } catch (err) {
        if (isMissingWeasyPrint(err)) {
          missing = true;
          continue;
        }
        err.statusCode = err.killed ? 504 : 500;
        throw err;
      }
    }
  } finally {
    prepared.cleanup();
  }
  if (missing) throw missingWeasyPrintError();
}

export async function sendPdf(res, abs, { sessionId = '' } = {}) {
  if (!isHtmlFile(abs)) {
    return res.status(400).json({ error: 'PDF export is only available for HTML files.' });
  }

  const out = path.join(os.tmpdir(), `eh-investigator-${crypto.randomUUID()}.pdf`);
  try {
    await renderPdf(abs, out);
    res.download(out, pdfNameFor(abs), (err) => {
      fs.rm(out, { force: true }, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Could not send generated PDF.' });
      }
    });
  } catch (err) {
    fs.rm(out, { force: true }, () => {});
    const status = err.statusCode || 500;
    const detail = (err.stderr || err.message || '').trim().split('\n').slice(-3).join(' ');
    const id = sessionId ? sessionId.slice(0, 8) : 'unknown';
    console.error(`[pdf:${id}]`, detail || err.message);
    res.status(status).json({
      error: status === 503
        ? err.message
        : `PDF export failed${detail ? `: ${detail}` : '.'}`,
    });
  }
}
