function encodePath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

export function sessionEventsUrl(sessionId) {
  return `/api/sessions/${sessionId}/events`;
}

export function sessionFileUrl(sessionId, relPath, options = {}) {
  const params = new URLSearchParams();
  if (options === true || options.dl) params.set('dl', '1');
  if (options.format) params.set('format', options.format);
  const qs = params.toString();
  return `/api/sessions/${sessionId}/files/${encodePath(relPath)}${qs ? `?${qs}` : ''}`;
}

export async function getHealth() {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getPreflight() {
  const res = await fetch('/api/preflight');
  const status = await res.json().catch(() => ({}));
  if (!status.checks) throw new Error(status.error || `HTTP ${res.status}`);
  return status;
}

export async function listSessions() {
  const res = await fetch('/api/sessions');
  return res.json();
}

export async function listActions(sessionId) {
  const res = await fetch(`/api/actions?session=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function listPendingActions() {
  const res = await fetch('/api/actions/pending');
  if (!res.ok) return { pendingCount: 0, actions: [] };
  return res.json().catch(() => ({ pendingCount: 0, actions: [] }));
}

export async function decideAction(sessionId, actionId, decision) {
  const res = await fetch(`/api/actions/${encodeURIComponent(actionId)}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: sessionId, decision }),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function getBackendUpdate(options = {}) {
  const res = await fetch(`/api/backend-update${options.refresh ? '?refresh=1' : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function runBackendUpdate() {
  const res = await fetch('/api/backend-update', { method: 'POST' });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function createSession() {
  const res = await fetch('/api/sessions', { method: 'POST' });
  return res.json();
}

export async function listFiles(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/files`);
  if (!res.ok) return null;
  return res.json();
}

export async function uploadSessionFiles(sessionId, files) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const res = await fetch(`/api/sessions/${sessionId}/files`, { method: 'POST', body: form });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function getEvidenceSummary(sessionId, relPath, options = {}) {
  const params = new URLSearchParams({ path: relPath });
  if (options.refresh) params.set('_', String(Date.now()));
  const res = await fetch(`/api/sessions/${sessionId}/summaries?${params}`);
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function openPcapInWireshark(sessionId, relPath) {
  const res = await fetch(`/api/sessions/${sessionId}/files/${encodePath(relPath)}/open-wireshark`, {
    method: 'POST',
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function postMessage(sessionId, body) {
  const res = await fetch(`/api/sessions/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function abortSession(sessionId) {
  return fetch(`/api/sessions/${sessionId}/abort`, { method: 'POST' });
}

export async function renameSession(sessionId, title) {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function setSessionSaved(sessionId, saved) {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ saved }),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function deleteSession(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function postChallenge(sessionId, body = {}) {
  const res = await fetch(`/api/sessions/${sessionId}/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export async function getModels(backendId = '') {
  const qs = backendId ? `?backend=${encodeURIComponent(backendId)}` : '';
  const res = await fetch(`/api/models${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load models');
  return data;
}

export async function getSettings() {
  const res = await fetch('/api/settings');
  return res.json();
}

export async function putSettings(body) {
  return fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function putSessionModel(sessionId, body) {
  const res = await fetch(`/api/sessions/${sessionId}/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}
