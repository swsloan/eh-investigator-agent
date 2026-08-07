// The right panel's tab strip, and the one thing all three tabs share: how big they
// are.
//
// Files was a docked column, Memory docked or went full screen depending on what you
// had last done to it, and Map was always full screen. Clicking between them changed
// the size of the app under the cursor, which is the complaint: the same strip of
// three buttons should not teleport you.
//
// Surface is therefore one preference rather than one per panel — but an opt-in one.
// See the note on `surface` below: each panel opens the way it should, and the
// moment the user docks or expands anything, every panel follows.

const SURFACE_KEY = 'eh-rp-surface';
const handlers = new Map();   // tab name -> { open(), close() }
const watchers = new Set();   // called when the surface changes

// null until the user has expressed a preference.
//
// What should be shared between the tabs is the user's CHOICE, not the initial
// value: a memory timeline is glanceable state and wants to be docked, while a map
// with zones, attack paths and a mini-map is a workspace and wants the screen. One
// default cannot be right for both — picking "docked" hides the map's kill chain on
// first open, and picking "expanded" makes memory take over the app to show a list.
// So each panel opens the way it should, and the moment the user docks or expands
// anything, every panel follows from then on.
let surface = read();

function read() {
  try {
    const stored = localStorage.getItem(SURFACE_KEY);
    return stored === 'expanded' || stored === 'docked' ? stored : null;
  } catch { return null; }
}

export function rpSurface(fallback = 'docked') { return surface || fallback; }
export function isExpanded(fallback = 'docked') { return rpSurface(fallback) === 'expanded'; }

/** Switch every right-panel surface at once, and remember it. */
export function setRpSurface(next) {
  const value = next === 'expanded' ? 'expanded' : 'docked';
  if (value === surface) return;
  surface = value;
  try { localStorage.setItem(SURFACE_KEY, value); } catch { /* private mode */ }
  for (const fn of watchers) {
    try { fn(surface); } catch { /* one panel must not break the others */ }
  }
}

export function toggleRpSurface(fallback = 'docked') {
  setRpSurface(rpSurface(fallback) === 'docked' ? 'expanded' : 'docked');
}

/** React to dock/expand. Returns an unsubscribe. */
export function onRpSurfaceChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** The label a dock/expand button should carry: name the destination, not the state. */
export function rpSurfaceLabel(fallback = 'docked') {
  return rpSurface(fallback) === 'docked' ? 'Expand to full screen' : 'Dock to the right';
}

/**
 * Register a panel.
 *
 * Each panel used to wire a listener onto EVERY tab button and coordinate through
 * an `activate` argument, so adding a fourth tab meant remembering a third place to
 * wire it. Now they register what they are, and the strip dispatches.
 */
export function registerRpPanel(name, { open, close }) {
  handlers.set(name, { open, close });
}

/** Paint the active state on every copy of the strip. */
export function setRpTab(which) {
  document.querySelectorAll('.rp-tab').forEach((b) => b.classList.toggle('active', b.dataset.rp === which));
}

export function activateRpTab(which) {
  for (const [name, handler] of handlers) {
    if (name === which) handler.open?.();
    else handler.close?.();
  }
  setRpTab(which);
}

/** Wire every copy of the strip once, from here. */
export function initRightPanel() {
  document.querySelectorAll('.rp-tab').forEach((button) => {
    button.addEventListener('click', () => activateRpTab(button.dataset.rp));
  });
}
