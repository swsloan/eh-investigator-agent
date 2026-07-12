import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PI_SESSIONS_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions');

function piSessionDirForWorkspace(workspace, piSessionsRoot = DEFAULT_PI_SESSIONS_ROOT) {
  return path.join(piSessionsRoot, `-${workspace.replaceAll(path.sep, '-')}--`);
}

export function latestPiSessionFile(workspace, piSessionsRoot = DEFAULT_PI_SESSIONS_ROOT) {
  const dir = piSessionDirForWorkspace(workspace, piSessionsRoot);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

function textFromContent(content = []) {
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function piEventTimeMs(event) {
  return event.message?.timestamp || Date.parse(event.timestamp) || Date.now();
}

/** Rebuild minimal session state from a Pi JSONL history file. */
export function stateFromPiSession(file, { redact = (value) => value } = {}) {
  if (!file) return null;
  const transcript = [];
  let id = null;
  let createdAt = null;
  let title = null;
  let promptCount = 0;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'session') {
      id = event.id || id;
      createdAt = Date.parse(event.timestamp) || createdAt;
      continue;
    }
    if (event.type !== 'message' || !event.message) continue;

    const message = event.message;
    if (message.role === 'user') {
      const text = redact(textFromContent(message.content));
      if (!text) continue;
      promptCount++;
      if (!title) title = text.split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?]+$/g, '');
      transcript.push({ type: 'message_end', message: redact(message) });
      createdAt ||= piEventTimeMs(event);
    } else if (message.role === 'assistant') {
      const text = redact(textFromContent(message.content));
      if (text) {
        transcript.push({ type: 'message_end', message: redact({
          ...message,
          content: [{ type: 'text', text }],
        }) });
        transcript.push({ type: 'agent_end' });
      } else if (message.stopReason === 'error' && message.errorMessage) {
        transcript.push({ type: 'session_error', error: redact(message.errorMessage) });
        transcript.push({ type: 'agent_end' });
      }
    }
  }

  if (!promptCount && !transcript.length) return null;
  return {
    id,
    backend: 'pi',
    title,
    titleGenerated: true,
    createdAt: createdAt || Date.now(),
    promptCount,
    transcript,
  };
}

/**
 * Legacy-workspace recovery hook for session-store: rebuild state from the
 * newest Pi JSONL history for that workspace, if any.
 */
export function recoverPiSessionState(workspace, { piSessionsRoot = DEFAULT_PI_SESSIONS_ROOT, redact } = {}) {
  return stateFromPiSession(latestPiSessionFile(workspace, piSessionsRoot), { redact });
}
