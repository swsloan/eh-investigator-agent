import { state } from './state.js';

// Union of every backend's reasoning vocabulary; the selects themselves are
// populated per backend from server-sent data.
export const REASONING_VALUES = new Set(['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const REASONING_LABELS = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export function normalizeModelValue(value) {
  return String(value || '').trim().replace(/:(?:off|minimal|low|medium|high|xhigh|max)$/, '');
}

/** Models of the active backend (used outside the settings modal). */
export function activeModels() {
  return state.catalogs[state.backend?.id]?.models || [];
}

export function findModelOption(value, models = activeModels()) {
  const key = normalizeModelValue(value);
  if (!key) return null;
  return models.find((model) => model.value === key || model.id === key) || null;
}

export function modelLabel(value, emptyLabel, models = activeModels()) {
  const key = normalizeModelValue(value);
  if (!key) return emptyLabel;
  const model = findModelOption(key, models);
  return model ? model.value : key;
}

export function modelMatches(model, query) {
  if (!query) return true;
  const haystack = [
    model.provider,
    model.id,
    model.value,
    model.context,
    model.maxOut,
    model.thinking ? 'reasoning thinking' : 'no reasoning',
    model.images ? 'images vision' : '',
  ].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((part) => haystack.includes(part));
}

/** Rebuild a reasoning <select> from a backend's levels, keeping the value if possible. */
export function populateReasoningSelect(select, backendInfo, emptyLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = '';
  for (const level of ['', ...(backendInfo?.reasoningLevels || [])]) {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = level
      ? (REASONING_LABELS[level] || level)
      : (emptyLabel || backendInfo?.defaultModelLabel || 'Default');
    select.appendChild(option);
  }
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}
