import { getPreflight } from './api.js';
import { dom } from './dom.js';
import { state } from './state.js';

export function setStatus(statusState, text, title = '') {
  dom.connStatus.className = `conn-status ${statusState}`;
  dom.connText.textContent = text;
  dom.connStatus.title = title || text;
}

function preflightTitle(status) {
  if (!Array.isArray(status.checks)) return status.message || status.text || 'Ready';
  const lines = status.checks.map((check) => {
    const checkState = check.ok ? 'OK' : (check.optional ? 'Optional' : 'Needs attention');
    return `${checkState}: ${check.label} - ${check.message}`;
  });
  return [status.message, ...lines].filter(Boolean).join('\n');
}

function applyPreflightCapabilities(status) {
  state.preflightChecks = Array.isArray(status.checks) ? status.checks : [];
  state.wiresharkAvailable = Boolean(state.preflightChecks.find((check) => check.id === 'wireshark')?.ok);
}

export function applyIdleStatus() {
  setStatus(state.idleStatus.state, state.idleStatus.text, state.idleStatus.title);
}

export async function refreshPreflight() {
  try {
    const status = await getPreflight();
    applyPreflightCapabilities(status);
    state.idleStatus = {
      state: status.state === 'error' ? 'error' : 'ok',
      text: status.text || (status.ok ? 'Ready' : 'Setup needed'),
      title: preflightTitle(status),
    };
  } catch (err) {
    state.idleStatus = {
      state: 'error',
      text: 'Status unavailable',
      title: `Could not load system status: ${err.message}`,
    };
    state.preflightChecks = [];
    state.wiresharkAvailable = false;
  }
  if (!state.running) applyIdleStatus();
}
