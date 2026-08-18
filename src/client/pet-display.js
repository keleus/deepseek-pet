/**
 * Shared display-mode store for the DeepSeek Pet surface.
 *
 * One setting, two placements (all in-page — no window or tab is ever
 * opened, so the behavior adapts to every browser identically):
 *  - `default`  — the pet renders where it always has (inside the shell
 *                 overlay layer, absolute at the frame's bottom-right).
 *  - `page-top` — the pet is portaled to `document.body` with a viewport
 *                 fixed position, floating above the page's content and
 *                 dialogs.
 *
 * The value is persisted in `localStorage` (same-origin, so every tab and the
 * settings page share it) and synchronized between windows through the native
 * `storage` event plus a same-document CustomEvent for immediate (synchronous)
 * updates.
 */

export const DISPLAY_MODE_KEY = 'deepseek-pet:display-mode'
export const DISPLAY_MODE_CHANGED_EVENT = 'deepseek-pet:display-mode-changed'

export const DISPLAY_MODES = Object.freeze([
  Object.freeze({
    id: 'default',
    label: '默认',
    description: '保持当前的默认展示方式不变：桌宠显示在页面右下角，跟随应用界面层。',
  }),
  Object.freeze({
    id: 'page-top',
    label: '页面置顶',
    description: '在当前网页里绝对置顶：桌宠固定在视口右下角，悬浮在页面所有内容（包括设置弹窗）之上。',
  }),
])
export const DEFAULT_DISPLAY_MODE = 'default'

export function isValidDisplayMode(value) {
  return DISPLAY_MODES.some(mode => mode.id === value)
}

/** Resolve a mode id to its record, falling back to the default entry. */
export function displayModeOf(id) {
  return DISPLAY_MODES.find(mode => mode.id === id) ?? DISPLAY_MODES[0]
}

function readStoredMode() {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
      const stored = window.localStorage.getItem(DISPLAY_MODE_KEY)
      if (isValidDisplayMode(stored)) return stored
    }
  } catch {}
  return DEFAULT_DISPLAY_MODE
}

/** Current mode per realm (the plugin bundle runs once per page). */
let current = readStoredMode()

const listeners = new Set()
let windowListenersAttached = false

function notify() {
  for (const listener of listeners) listener()
}

function onLocalDisplayModeChange(event) {
  const mode = event?.detail?.mode
  if (!isValidDisplayMode(mode)) return
  current = mode
  notify()
}

function onStoredDisplayModeChange(event) {
  if (event?.key !== DISPLAY_MODE_KEY) return
  const mode = readStoredMode()
  if (mode === current) return
  current = mode
  notify()
}

function attachWindowListeners() {
  if (windowListenersAttached || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  window.addEventListener(DISPLAY_MODE_CHANGED_EVENT, onLocalDisplayModeChange)
  window.addEventListener('storage', onStoredDisplayModeChange)
  windowListenersAttached = true
}

function detachWindowListeners() {
  if (!windowListenersAttached) return
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener(DISPLAY_MODE_CHANGED_EVENT, onLocalDisplayModeChange)
    window.removeEventListener('storage', onStoredDisplayModeChange)
  }
  windowListenersAttached = false
}

export function getDisplayModeSnapshot() {
  return current
}

/**
 * Persist and broadcast a new display mode. Same-document subscribers update
 * synchronously; other windows of the same origin follow through `storage`.
 */
export function setDisplayMode(mode) {
  if (!isValidDisplayMode(mode) || mode === current) return
  current = mode
  try {
    window.localStorage?.setItem(DISPLAY_MODE_KEY, mode)
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(DISPLAY_MODE_CHANGED_EVENT, { detail: { mode } }))
  } catch {
    notify()
  }
}

/**
 * Subscribe to display-mode changes (same document and cross-window).
 * @param listener - change callback.
 * @returns unsubscribe.
 */
export function subscribeDisplayMode(listener) {
  listeners.add(listener)
  attachWindowListeners()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) detachWindowListeners()
  }
}
