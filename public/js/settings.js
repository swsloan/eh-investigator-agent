import { getHealth, getModels, getSettings, putSessionModel, putSettings } from './api.js';
import { updateUsage } from './chat.js';
import { $, dom } from './dom.js';
import {
  REASONING_VALUES,
  findModelOption,
  modelMatches,
  normalizeModelValue,
  populateReasoningSelect,
} from './model-utils.js';
import { loadSessions } from './sessions.js';
import { state } from './state.js';
import { refreshPreflight } from './status.js';
import { getThemePref, syncThemeButtons } from './theme.js';

const EVIDENCE_VIEW_MODES = new Set(['code', 'split', 'rendered']);

function normalizeEvidenceView(value) {
  return EVIDENCE_VIEW_MODES.has(value) ? value : 'rendered';
}

const DROPDOWN_GAP = 6;
const DROPDOWN_MARGIN = 12;
const DROPDOWN_MIN_HEIGHT = 96;

function resetFloatingMenu(menu) {
  if (!menu) return;
  menu.classList.remove('floating');
  menu.style.left = '';
  menu.style.top = '';
  menu.style.width = '';
  menu.style.maxHeight = '';
  menu.querySelector('.model-options, .custom-select-options')?.style.removeProperty('max-height');
}

/**
 * Draw dropdowns in viewport coordinates so scrollable modal/card containers
 * cannot clip the menu. If there is not enough room below, open upward.
 */
function positionFloatingMenu(anchor, menu) {
  if (!anchor || !menu || menu.classList.contains('hidden')) return;
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const width = Math.min(rect.width, viewportWidth - (DROPDOWN_MARGIN * 2));
  const left = Math.max(
    DROPDOWN_MARGIN,
    Math.min(rect.left, viewportWidth - DROPDOWN_MARGIN - width),
  );

  menu.classList.add('floating');
  menu.style.left = `${Math.round(left)}px`;
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxHeight = '';
  menu.querySelector('.model-options, .custom-select-options')?.style.removeProperty('max-height');

  const naturalHeight = Math.min(
    menu.scrollHeight || menu.getBoundingClientRect().height,
    viewportHeight - (DROPDOWN_MARGIN * 2),
  );
  const below = viewportHeight - rect.bottom - DROPDOWN_GAP - DROPDOWN_MARGIN;
  const above = rect.top - DROPDOWN_GAP - DROPDOWN_MARGIN;
  const openUp = below < naturalHeight && above > below;
  const available = Math.max(DROPDOWN_MIN_HEIGHT, Math.min(openUp ? above : below, viewportHeight - (DROPDOWN_MARGIN * 2)));

  menu.style.maxHeight = `${Math.floor(available)}px`;
  const scroller = menu.querySelector('.model-options, .custom-select-options');
  if (scroller) {
    const chromeHeight = Math.max(0, menu.getBoundingClientRect().height - scroller.getBoundingClientRect().height);
    scroller.style.maxHeight = `${Math.max(64, Math.floor(available - chromeHeight))}px`;
  }

  const height = Math.min(menu.getBoundingClientRect().height, available);
  const top = openUp
    ? Math.max(DROPDOWN_MARGIN, rect.top - DROPDOWN_GAP - height)
    : Math.min(viewportHeight - DROPDOWN_MARGIN - height, rect.bottom + DROPDOWN_GAP);
  menu.style.top = `${Math.round(top)}px`;
}

function positionModelCombo(combo) {
  positionFloatingMenu(combo?.querySelector('.model-combo-btn'), combo?.querySelector('.model-menu'));
}

function positionCustomSelect(control) {
  positionFloatingMenu(control?.querySelector('.custom-select-btn'), control?.querySelector('.custom-select-menu'));
}

function repositionActiveDropdowns() {
  if (state.activeModelCombo) positionModelCombo(state.activeModelCombo);
  if (state.activeCustomSelect) positionCustomSelect(state.activeCustomSelect);
}

/** Which backend a combo browses: the settings modal follows the picker. */
function comboBackendId(combo) {
  if (combo.id === 'session-model-combo') return state.backend?.id || '';
  return state.settingsBackend || state.backend?.id || '';
}

function comboCatalog(combo) {
  return state.catalogs[comboBackendId(combo)] || { models: [], error: '', loaded: false };
}

/** Fetch (once) and cache a backend's model catalog + public backend info. */
export async function loadModelCatalog(backendId) {
  const existing = state.catalogs[backendId];
  if (existing?.loaded) return existing;
  const data = await getModels(backendId);
  const catalog = {
    backend: data.backend || null,
    models: Array.isArray(data.models) ? data.models : [],
    error: '',
    loaded: true,
  };
  catalog.error = catalog.models.length ? '' : `No ${catalog.backend?.label || ''} models found`.replace('  ', ' ');
  state.catalogs[backendId] = catalog;
  return catalog;
}

/** Refresh the active backend descriptor (label, reasoning levels) from /api/health. */
export async function refreshBackendInfo() {
  try {
    const health = await getHealth();
    if (health.backend) state.backend = health.backend;
  } catch { /* status pill already reports connectivity */ }
  populateReasoningSelect($('session-set-reasoning'), state.backend, 'Keep/default');
  syncCustomSelectById('session-set-reasoning');
  updateUsage();
}

export function applyPublicSettings(settings = {}) {
  state.evidenceDefaultView = normalizeEvidenceView(settings.evidence?.defaultView);
}

export async function refreshSettingsState() {
  const settings = await getSettings();
  applyPublicSettings(settings);
  return settings;
}

function updateModelButton(combo) {
  const valueEl = combo.querySelector('.model-combo-value');
  const input = combo.querySelector('input[type="hidden"]');
  const emptyLabel = combo.dataset.emptyLabel;
  const key = normalizeModelValue(input.value);
  const model = findModelOption(key, comboCatalog(combo).models);
  valueEl.textContent = key ? (model ? model.value : key) : emptyLabel;
  valueEl.classList.toggle('muted', !input.value);
}

function renderModelOptions(combo) {
  const query = combo.querySelector('.model-search').value.trim();
  const optionsEl = combo.querySelector('.model-options');
  const current = normalizeModelValue(combo.querySelector('input[type="hidden"]').value);
  const catalog = comboCatalog(combo);
  const rows = [];

  if (!query || combo.dataset.emptyLabel.toLowerCase().includes(query.toLowerCase())) {
    rows.push({
      value: '',
      name: combo.dataset.emptyLabel,
      provider: catalog.backend?.label || '',
      meta: combo.dataset.emptyMeta,
    });
  }

  for (const model of catalog.models.filter((item) => modelMatches(item, query)).slice(0, 80)) {
    rows.push({
      value: model.value,
      name: model.id,
      provider: model.provider,
      meta: `${model.context} ctx · ${model.thinking ? 'reasoning' : 'no reasoning'}`,
    });
  }

  optionsEl.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'model-empty';
    empty.textContent = catalog.error || 'No matching models';
    optionsEl.appendChild(empty);
    positionModelCombo(combo);
    return;
  }

  for (const row of rows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-option';
    btn.dataset.value = row.value;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(normalizeModelValue(row.value) === current));
    btn.classList.toggle('active', normalizeModelValue(row.value) === current);
    btn.innerHTML = `
      <span class="model-name"></span>
      <span class="model-provider"></span>
      <span class="model-meta"></span>`;
    btn.querySelector('.model-name').textContent = row.name;
    btn.querySelector('.model-provider').textContent = row.provider;
    btn.querySelector('.model-meta').textContent = row.meta;
    btn.addEventListener('click', () => {
      setModelComboValue(combo, row.value);
      closeModelCombo(combo);
    });
    optionsEl.appendChild(btn);
  }
  positionModelCombo(combo);
}

function setModelComboValue(combo, value) {
  combo.querySelector('input[type="hidden"]').value = normalizeModelValue(value);
  updateModelButton(combo);
  if (combo.id === 'main-model-combo') updateReasoningAvailability();
  if (combo.id === 'challenger-model-combo') updateChallengerReasoningAvailability();
  if (combo.id === 'session-model-combo') updateSessionReasoningAvailability();
}

function openModelCombo(combo) {
  closeActiveCustomSelect();
  if (state.activeModelCombo && state.activeModelCombo !== combo) closeModelCombo(state.activeModelCombo);
  state.activeModelCombo = combo;
  combo.classList.add('open');
  combo.querySelector('.model-menu').classList.remove('hidden');
  combo.querySelector('.model-combo-btn').setAttribute('aria-expanded', 'true');
  combo.querySelector('.model-search').value = '';
  renderModelOptions(combo);
  requestAnimationFrame(() => {
    positionModelCombo(combo);
    combo.querySelector('.model-search').focus();
  });
}

export function closeModelCombo(combo) {
  combo.classList.remove('open');
  const menu = combo.querySelector('.model-menu');
  menu.classList.add('hidden');
  resetFloatingMenu(menu);
  combo.querySelector('.model-combo-btn').setAttribute('aria-expanded', 'false');
  if (state.activeModelCombo === combo) state.activeModelCombo = null;
}

export function hasActiveModelCombo() {
  return Boolean(state.activeModelCombo);
}

export function closeActiveModelCombo() {
  if (state.activeModelCombo) closeModelCombo(state.activeModelCombo);
}

function setupModelCombo(id, inputId, emptyLabel, emptyMeta) {
  const combo = $(id);
  combo.dataset.emptyLabel = emptyLabel;
  combo.dataset.emptyMeta = emptyMeta;
  const input = $(inputId);
  const btn = combo.querySelector('.model-combo-btn');
  const search = combo.querySelector('.model-search');
  const options = combo.querySelector('.model-options');

  btn.addEventListener('click', () => {
    if (combo.classList.contains('open')) closeModelCombo(combo);
    else openModelCombo(combo);
  });
  btn.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openModelCombo(combo);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      openModelCombo(combo);
      search.value = event.key;
      renderModelOptions(combo);
    }
  });
  search.addEventListener('input', () => renderModelOptions(combo));
  search.addEventListener('keydown', (event) => {
    const choices = [...options.querySelectorAll('.model-option')];
    const activeIndex = choices.findIndex((choice) => choice.classList.contains('active'));
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModelCombo(combo);
      btn.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!choices.length) return;
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(choices.length - 1, activeIndex + 1)
        : Math.max(0, activeIndex - 1);
      choices.forEach((choice, i) => choice.classList.toggle('active', i === nextIndex));
      choices[nextIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      (choices.find((choice) => choice.classList.contains('active')) || choices[0])?.click();
    }
  });
  input.addEventListener('change', () => updateModelButton(combo));
  updateModelButton(combo);
}

function customSelectControl(select) {
  return select?.closest('.custom-select') || null;
}

function customSelectLabel(select) {
  const selected = select.selectedOptions?.[0] || select.options[select.selectedIndex];
  return selected?.textContent || '';
}

function renderCustomSelectOptions(control) {
  const select = control.querySelector('select');
  const optionsEl = control.querySelector('.custom-select-options');
  optionsEl.innerHTML = '';

  for (const option of select.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-option';
    btn.dataset.value = option.value;
    btn.disabled = option.disabled;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(option.selected));
    btn.classList.toggle('active', option.selected);
    btn.textContent = option.textContent;
    btn.addEventListener('click', () => {
      if (select.disabled || option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closeCustomSelect(control);
      control.querySelector('.custom-select-btn').focus();
    });
    optionsEl.appendChild(btn);
  }
  positionCustomSelect(control);
}

function syncCustomSelect(select) {
  const control = customSelectControl(select);
  if (!control) return;
  const button = control.querySelector('.custom-select-btn');
  const value = control.querySelector('.custom-select-value');
  value.textContent = customSelectLabel(select);
  value.classList.toggle('muted', !select.value);
  button.disabled = select.disabled;
  button.setAttribute('aria-disabled', String(select.disabled));
  control.classList.toggle('disabled', select.disabled);
  if (control.classList.contains('open')) renderCustomSelectOptions(control);
  if (select.disabled) closeCustomSelect(control);
}

function syncCustomSelectById(id) {
  syncCustomSelect($(id));
}

function closeCustomSelect(control) {
  if (!control) return;
  control.classList.remove('open');
  const menu = control.querySelector('.custom-select-menu');
  menu.classList.add('hidden');
  resetFloatingMenu(menu);
  control.querySelector('.custom-select-btn').setAttribute('aria-expanded', 'false');
  if (state.activeCustomSelect === control) state.activeCustomSelect = null;
}

export function closeActiveCustomSelect() {
  if (state.activeCustomSelect) closeCustomSelect(state.activeCustomSelect);
}

export function hasActiveCustomSelect() {
  return Boolean(state.activeCustomSelect);
}

function focusCustomOption(control, direction) {
  const choices = [...control.querySelectorAll('.custom-select-option:not(:disabled)')];
  if (!choices.length) return;
  const current = choices.indexOf(document.activeElement);
  let next = choices.findIndex((choice) => choice.classList.contains('active'));
  if (direction === 'first') next = 0;
  else if (direction === 'last') next = choices.length - 1;
  else if (current >= 0) next = Math.max(0, Math.min(choices.length - 1, current + direction));
  else if (next < 0) next = 0;
  choices[next].focus();
}

function openCustomSelect(control) {
  const select = control.querySelector('select');
  if (select.disabled) return;
  closeActiveModelCombo();
  if (state.activeCustomSelect && state.activeCustomSelect !== control) closeCustomSelect(state.activeCustomSelect);
  state.activeCustomSelect = control;
  control.classList.add('open');
  control.querySelector('.custom-select-menu').classList.remove('hidden');
  control.querySelector('.custom-select-btn').setAttribute('aria-expanded', 'true');
  renderCustomSelectOptions(control);
  requestAnimationFrame(() => {
    positionCustomSelect(control);
    const active = control.querySelector('.custom-select-option.active:not(:disabled)')
      || control.querySelector('.custom-select-option:not(:disabled)');
    active?.focus();
  });
}

function setupCustomSelect(id) {
  const select = $(id);
  if (!select || customSelectControl(select)) return;

  const control = document.createElement('div');
  control.className = 'custom-select';
  select.parentNode.insertBefore(control, select);
  control.appendChild(select);
  select.classList.add('native-select');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-select-btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const label = select.closest('.field')?.querySelector('span')?.textContent?.trim();
  if (label) button.setAttribute('aria-label', label);
  button.innerHTML = `
    <span class="custom-select-value"></span>
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu hidden';
  const options = document.createElement('div');
  options.className = 'custom-select-options';
  options.setAttribute('role', 'listbox');
  menu.appendChild(options);
  control.append(button, menu);

  button.addEventListener('click', () => {
    if (control.classList.contains('open')) closeCustomSelect(control);
    else openCustomSelect(control);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCustomSelect(control);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openCustomSelect(control);
      requestAnimationFrame(() => focusCustomOption(control, 'last'));
    }
  });
  options.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCustomSelect(control);
      button.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusCustomOption(control, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusCustomOption(control, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusCustomOption(control, 'first');
    } else if (event.key === 'End') {
      event.preventDefault();
      focusCustomOption(control, 'last');
    } else if (event.key === 'Tab') {
      closeCustomSelect(control);
    }
  });
  select.addEventListener('change', () => syncCustomSelect(select));
  new MutationObserver(() => syncCustomSelect(select)).observe(select, {
    attributes: true,
    attributeFilter: ['disabled'],
    childList: true,
    subtree: true,
  });
  syncCustomSelect(select);
}

function reasoningAvailability(selectId, comboInputId, combo) {
  const select = $(selectId);
  if (!select) return;
  const selected = findModelOption($(comboInputId).value, comboCatalog(combo).models);
  const supportsThinking = !selected || selected.thinking;
  select.disabled = !supportsThinking;
  if (!supportsThinking) select.value = 'off';
  syncCustomSelect(select);
}

function updateReasoningAvailability() {
  reasoningAvailability('set-main-reasoning', 'set-main-model', $('main-model-combo'));
}

function updateSessionReasoningAvailability() {
  reasoningAvailability('session-set-reasoning', 'session-set-model', $('session-model-combo'));
}

function updateChallengerReasoningAvailability() {
  reasoningAvailability('set-challenger-reasoning', 'set-challenger-model', $('challenger-model-combo'));
}

function showSettingsPanel(name) {
  closeActiveModelCombo();
  closeActiveCustomSelect();
  document.querySelectorAll('.settings-nav-btn').forEach((button) => {
    const active = button.dataset.panel === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.settings-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== name);
  });
}

function setFamily(family) {
  state.settingsFamily = family;
  document.querySelectorAll('#set-family .seg-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === family);
  });
  $('fields-enterprise').classList.toggle('hidden', family !== 'enterprise');
  $('fields-rx360').classList.toggle('hidden', family !== 'rx360');
}

function setClaudeAuth(mode) {
  state.settingsClaudeAuth = mode === 'apiKey' ? 'apiKey' : 'subscription';
  document.querySelectorAll('#set-claude-auth .seg-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === state.settingsClaudeAuth);
  });
}

/** Read the model fields into the displayed backend's prefs section. */
function captureDisplayedPrefs() {
  if (!state.settingsBackend) return;
  state.settingsPrefs[state.settingsBackend] = {
    mainModel: $('set-main-model').value,
    mainReasoning: $('set-main-reasoning').value,
    lightModel: $('set-light-model').value,
    challenger: {
      model: $('set-challenger-model').value,
      reasoning: $('set-challenger-reasoning').value,
    },
  };
}

/** Fill the model fields from a backend's prefs section and its catalog. */
async function showBackendPrefs(backendId) {
  state.settingsBackend = backendId;
  document.querySelectorAll('#set-backend .seg-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.value === backendId);
  });
  const option = state.backendOptions.find((entry) => entry.id === backendId);
  const hint = $('backend-hint');
  hint.textContent = option && !option.available ? option.message : '';
  hint.classList.toggle('hidden', !hint.textContent);

  const prefs = state.settingsPrefs[backendId] || { challenger: {} };
  setModelComboValue($('main-model-combo'), prefs.mainModel || '');
  setModelComboValue($('light-model-combo'), prefs.lightModel || '');
  setModelComboValue($('challenger-model-combo'), prefs.challenger?.model || '');

  try {
    if (!state.catalogs[backendId]?.loaded) $('settings-status').textContent = 'Loading models…';
    const catalog = await loadModelCatalog(backendId);
    if (state.settingsBackend !== backendId) return; // user toggled again meanwhile
    const info = catalog.backend;
    $('main-model-combo').dataset.emptyLabel = info?.defaultModelLabel || 'Default';
    $('main-model-combo').dataset.emptyMeta = info?.defaultModelMeta || '';
    populateReasoningSelect($('set-main-reasoning'), info);
    populateReasoningSelect($('set-challenger-reasoning'), info);
    $('set-main-reasoning').value = [...$('set-main-reasoning').options].some((o) => o.value === (prefs.mainReasoning || ''))
      ? (prefs.mainReasoning || '')
      : '';
    $('set-challenger-reasoning').value = [...$('set-challenger-reasoning').options].some((o) => o.value === (prefs.challenger?.reasoning || ''))
      ? (prefs.challenger?.reasoning || '')
      : 'high';
    syncCustomSelectById('set-main-reasoning');
    syncCustomSelectById('set-challenger-reasoning');
    updateModelButton($('main-model-combo'));
    updateModelButton($('light-model-combo'));
    updateModelButton($('challenger-model-combo'));
    updateReasoningAvailability();
    updateChallengerReasoningAvailability();
    if ($('settings-status').textContent === 'Loading models…') $('settings-status').textContent = '';
  } catch (err) {
    state.catalogs[backendId] = { backend: null, models: [], error: err.message, loaded: false };
    $('settings-status').textContent = err.message;
  }
}

function renderBackendPicker() {
  const seg = $('set-backend');
  seg.innerHTML = '';
  for (const option of state.backendOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg-btn';
    button.dataset.value = option.id;
    button.textContent = option.label;
    button.disabled = !option.available;
    button.title = option.available ? '' : option.message;
    button.classList.toggle('active', option.id === state.settingsBackend);
    button.addEventListener('click', () => {
      if (option.id === state.settingsBackend) return;
      captureDisplayedPrefs();
      showBackendPrefs(option.id);
    });
    seg.appendChild(button);
  }
}

export async function openSettings() {
  syncThemeButtons(getThemePref());
  const settings = await refreshSettingsState();
  state.backendOptions = Array.isArray(settings.backendOptions) ? settings.backendOptions : [];
  state.settingsPrefs = settings.backends || {};
  state.settingsBackend = settings.backend || state.backend?.id || '';

  $('set-evidence-view').value = state.evidenceDefaultView;
  syncCustomSelectById('set-evidence-view');
  $('set-challenger-enabled').checked = Boolean(settings.challenger?.enabled);
  $('set-challenger-auto').checked = Boolean(settings.challenger?.automatic);
  $('set-host').value = settings.extrahop.host || '';
  $('set-insecure').checked = Boolean(settings.extrahop.insecure);
  $('set-apikey').value = '';
  $('set-clientid').value = '';
  $('set-clientsecret').value = '';
  const sourceHints = {
    env: '— set via .env',
    keychain: '— saved in Keychain',
    'secret-service': '— saved in Secret Service',
    memory: '— stored for this run',
  };
  const savedHint = sourceHints[settings.extrahop.source] || '— saved';
  $('hint-apikey').textContent = settings.extrahop.apiKeySet ? savedHint : '— not set';
  $('hint-clientid').textContent = settings.extrahop.clientIdSet ? savedHint : '— not set';
  $('hint-clientsecret').textContent = settings.extrahop.clientSecretSet ? savedHint : '— not set';
  $('set-memory-enabled').checked = Boolean(settings.memory?.enabled);
  $('set-memory-url').value = settings.memory?.url || '';
  $('set-anthropic-key').value = '';
  $('hint-anthropic').textContent = settings.anthropicKeySet ? savedHint : '— not set';
  setFamily(settings.extrahop.family || 'enterprise');
  setClaudeAuth(settings.claudeAuth || 'subscription');
  $('set-claude-oauth').value = '';
  $('hint-claude-oauth').textContent = settings.claudeOauthTokenSet ? savedHint : '— not set';
  $('settings-status').textContent = '';
  renderBackendPicker();
  dom.settingsModal.classList.remove('hidden');
  await showBackendPrefs(state.settingsBackend);
}

export async function openSessionModelModal() {
  if (!state.session || state.running) return;
  setModelComboValue($('session-model-combo'), state.sessionModelPinned ? state.sessionRequestedModel : '');
  populateReasoningSelect($('session-set-reasoning'), state.backend, 'Keep/default');
  $('session-set-reasoning').value = REASONING_VALUES.has(state.sessionRequestedReasoning)
    && [...$('session-set-reasoning').options].some((o) => o.value === state.sessionRequestedReasoning)
    ? state.sessionRequestedReasoning
    : '';
  syncCustomSelectById('session-set-reasoning');
  $('session-model-status').textContent = '';
  dom.sessionModelModal.classList.remove('hidden');
  const backendId = state.backend?.id || '';
  try {
    if (!state.catalogs[backendId]?.loaded) $('session-model-status').textContent = 'Loading models…';
    await loadModelCatalog(backendId);
    const info = state.catalogs[backendId]?.backend;
    $('session-model-combo').dataset.emptyMeta = info ? `${info.defaultModelLabel} for new runs` : '';
    updateModelButton($('session-model-combo'));
    updateSessionReasoningAvailability();
    if ($('session-model-status').textContent === 'Loading models…') $('session-model-status').textContent = '';
  } catch (err) {
    state.catalogs[backendId] = { backend: null, models: [], error: err.message, loaded: false };
    $('session-model-status').textContent = err.message;
    updateSessionReasoningAvailability();
  }
}

async function applySessionModel() {
  if (!state.session) return;
  $('session-model-save').disabled = true;
  $('session-model-status').textContent = 'Applying…';
  const body = {
    model: $('session-set-model').value,
    reasoning: $('session-set-reasoning').value,
  };
  const { ok, data } = await putSessionModel(state.session.id, body);
  $('session-model-save').disabled = false;
  if (!ok) {
    $('session-model-status').textContent = data.error || 'Could not switch model';
    return;
  }
  state.sessionRequestedModel = data.session?.model || body.model || '';
  state.sessionRequestedReasoning = data.session?.reasoning || body.reasoning || '';
  state.sessionModelPinned = !!data.session?.modelPinned;
  state.session = data.session || state.session;
  state.agentModel = data.session?.agentState?.model || state.agentModel;
  updateUsage();
  loadSessions();
  $('session-model-status').textContent = 'Applied';
  setTimeout(closeSessionModelModal, 500);
}

export function closeSessionModelModal() {
  closeActiveModelCombo();
  closeActiveCustomSelect();
  dom.sessionModelModal.classList.add('hidden');
}

async function saveSettings() {
  captureDisplayedPrefs();
  const body = {
    backend: state.settingsBackend,
    claudeAuth: state.settingsClaudeAuth,
    backends: state.settingsPrefs,
    challenger: {
      enabled: $('set-challenger-enabled').checked,
      automatic: $('set-challenger-auto').checked,
    },
    evidence: {
      defaultView: normalizeEvidenceView($('set-evidence-view').value),
    },
    memory: {
      enabled: $('set-memory-enabled').checked,
      url: $('set-memory-url').value,
    },
    anthropicApiKey: $('set-anthropic-key').value,
    claudeOauthToken: $('set-claude-oauth').value,
    extrahop: {
      family: state.settingsFamily,
      host: $('set-host').value,
      insecure: $('set-insecure').checked,
      apiKey: $('set-apikey').value,
      clientId: $('set-clientid').value,
      clientSecret: $('set-clientsecret').value,
    },
  };
  const res = await putSettings(body);
  if (res.ok) {
    state.evidenceDefaultView = normalizeEvidenceView($('set-evidence-view').value);
    $('settings-status').textContent = 'Saved — defaults updated';
    await refreshBackendInfo();
    refreshPreflight();
    loadSessions();
    setTimeout(closeSettings, 900);
  } else {
    $('settings-status').textContent = 'Save failed';
  }
}

export function closeSettings() {
  closeActiveModelCombo();
  closeActiveCustomSelect();
  dom.settingsModal.classList.add('hidden');
}

export function initSettings() {
  setupModelCombo('main-model-combo', 'set-main-model', 'Default', '');
  setupModelCombo('light-model-combo', 'set-light-model', 'Same as session model', 'Uses the session model');
  setupModelCombo('challenger-model-combo', 'set-challenger-model', 'Same as session model', 'Uses the investigation model');
  setupModelCombo('session-model-combo', 'session-set-model', 'App default / keep current', '');
  setupCustomSelect('set-evidence-view');
  setupCustomSelect('set-main-reasoning');
  setupCustomSelect('set-challenger-reasoning');
  setupCustomSelect('session-set-reasoning');

  document.addEventListener('click', (event) => {
    if (state.activeModelCombo && !state.activeModelCombo.contains(event.target)) closeModelCombo(state.activeModelCombo);
    if (state.activeCustomSelect && !state.activeCustomSelect.contains(event.target)) closeCustomSelect(state.activeCustomSelect);
  });
  window.addEventListener('resize', repositionActiveDropdowns);
  window.addEventListener('scroll', repositionActiveDropdowns, true);

  document.querySelectorAll('#set-claude-auth .seg-btn').forEach((button) => {
    button.addEventListener('click', () => setClaudeAuth(button.dataset.value));
  });
  document.querySelectorAll('#set-family .seg-btn').forEach((button) => {
    button.addEventListener('click', () => setFamily(button.dataset.value));
  });

  document.querySelectorAll('.settings-nav-btn').forEach((button) => {
    button.addEventListener('click', () => showSettingsPanel(button.dataset.panel));
  });

  $('session-model-btn').addEventListener('click', openSessionModelModal);
  $('session-model-close').addEventListener('click', closeSessionModelModal);
  $('session-model-save').addEventListener('click', applySessionModel);
  dom.sessionModelModal.addEventListener('click', (event) => {
    if (event.target === dom.sessionModelModal) closeSessionModelModal();
  });

  $('settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-save').addEventListener('click', saveSettings);
  dom.settingsModal.addEventListener('click', (event) => {
    if (event.target === dom.settingsModal) closeSettings();
  });
}
