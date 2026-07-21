import fs from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import {
  classifyEvidenceValue,
  createCsvExportPlan,
  EVIDENCE_SUMMARY_LIMITS,
  summarizeEvidenceValue,
} from './evidence-summary.js';

function waitFor(type) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Evidence worker parent port closed.'));
    };
    const cleanup = () => {
      parentPort.off('message', onMessage);
      parentPort.off('close', onClose);
    };
    parentPort.on('message', onMessage);
    parentPort.on('close', onClose);
  });
}

function sendError(error) {
  parentPort.postMessage({
    type: 'error',
    error: {
      message: error?.statusCode ? error.message : 'Could not process this JSON evidence file.',
      statusCode: error?.statusCode || 400,
    },
  });
}

async function readValue() {
  const stat = await fs.lstat(workerData.abs);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    const error = new Error('File not found.');
    error.statusCode = 404;
    throw error;
  }
  if (stat.size > EVIDENCE_SUMMARY_LIMITS.sourceBytes) {
    const error = new Error(`JSON file is too large to process (${stat.size} bytes).`);
    error.statusCode = 413;
    throw error;
  }
  try {
    return JSON.parse(await fs.readFile(workerData.abs, 'utf8'));
  } catch {
    const error = new Error('Could not parse this file as JSON.');
    error.statusCode = 400;
    throw error;
  }
}

async function runSummary(value) {
  const kind = classifyEvidenceValue(workerData.sourcePath, value);
  let context = {};
  if (kind === 'metrics' || kind === 'detections') {
    parentPort.postMessage({ type: 'needs_context', kind });
    ({ context = {} } = await waitFor('context'));
  }
  parentPort.postMessage({
    type: 'result',
    result: summarizeEvidenceValue(workerData.sourcePath, value, context),
  });
}

async function runCsv(value) {
  const plan = createCsvExportPlan(value, workerData.sourcePath);
  parentPort.postMessage({
    type: 'csv_metadata',
    filename: plan.filename,
    metadata: plan.metadata,
  });
  await waitFor('continue');
  for (const chunk of plan.chunks()) {
    parentPort.postMessage({ type: 'csv_chunk', chunk });
    await waitFor('continue');
  }
  parentPort.postMessage({ type: 'csv_end' });
}

try {
  const value = await readValue();
  if (workerData.operation === 'summary') await runSummary(value);
  else if (workerData.operation === 'csv') await runCsv(value);
  else throw new Error('Unsupported evidence worker operation.');
} catch (error) {
  sendError(error);
}
