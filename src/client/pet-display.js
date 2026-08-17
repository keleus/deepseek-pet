/**
 * Shared display-mode store for the DeepSeek Pet surface.
 *
 * One setting, three placements (all in-page — no window or tab is ever
 * opened, so the behavior adapts to every browser identically):
 *  - `default`     — the pet renders where it always has (inside the shell
 *                    overlay layer, absolute at the frame's bottom-right).
 *  - `page-top`    — the pet is portaled to `document.body` with a viewport
 *                    fixed position, floating above the page's content and
 *                    dialogs.
 *  - `browser-top` — browser-wide top placement: the pet is portaled to
 *                    `document.body` with the maximum possible z-index, so it
 *                    stays above everything the page can render. The mode and
 *                    position persist across tabs and reloads of the same
 *                    browser profile (shared localStorage); the pet itself
 *                    follows the page it lives on, as web pages cannot paint
 *                    across browser tabs.
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
  Object.freeze({
    id: 'browser-top',
    label: '浏览器置顶',
    description: '整个浏览器内全局置顶：桌宠固定在视口右下角并占用页面最高层级，不新开任何窗口；模式与位置在同浏览器各标签页之间保持一致（自动适配所有浏览器）。',
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

function notify() {
  for (const listener of listeners) listener()
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
  const onLocal = (event) => {
    const mode = event?.detail?.mode
    if (!isValidDisplayMode(mode)) return
    current = mode
    notify()
  }
  const onStorage = (event) => {
    if (event?.key !== DISPLAY_MODE_KEY) return
    const mode = readStoredMode()
    if (mode === current) return
    current = mode
    notify()
  }
  listeners.add(listener)
  try {
    window.addEventListener(DISPLAY_MODE_CHANGED_EVENT, onLocal)
    window.addEventListener('storage', onStorage)
  } catch {}
  return () => {
    listeners.delete(listener)
    try {
      window.removeEventListener(DISPLAY_MODE_CHANGED_EVENT, onLocal)
      window.removeEventListener('storage', onStorage)
    } catch {}
  }
}
