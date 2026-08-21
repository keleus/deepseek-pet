/** Persisted, per-state reaction choices shared by the pet and settings page. */

export const REACTION_SETTINGS_KEY = 'deepseek-pet:enabled-reactions'
export const REACTION_SETTINGS_CHANGED_EVENT = 'deepseek-pet:enabled-reactions-changed'

const option = (id, label) => Object.freeze({ id, label })
const group = (id, label, description, options, defaultEnabled = options.map(item => item.id)) => Object.freeze({
  id,
  label,
  description,
  options: Object.freeze(options),
  defaultEnabled: Object.freeze(defaultEnabled),
})

export const REACTION_GROUPS = Object.freeze([
  group('idle', '待机', '没有任务时按累计待机时长稳定轮换。', [
    option('idle', '默认待机'), option('relaxed', '放松'), option('cheerful', '开心'), option('proud', '得意'),
  ]),
  group('thinking', '思考', '分析、推理和疑问较多时使用。', [
    option('thinking', '认真思考'), option('desk-coding', '桌前工作'), option('relaxed', '从容思考'),
    option('desk-confused', '有点困惑'), option('deepseek-pressure', '压力思考'),
    option('eating-rice', '认真扒饭'), option('deepseek-rice', '举起饭碗'),
  ]),
  group('working', '执行工具', '写代码、读文件、搜索和运行工具时，与白米饭动作交替使用。', [
    option('desk-coding', '桌前编码'), option('thinking', '检查内容'), option('skeptical', '认真核对'),
    option('eating-rice', '认真扒饭'), option('deepseek-rice', '举起饭碗'),
  ]),
  group('speaking', '回复', '组织和输出回答时使用。', [
    option('desk-coding', '敲字回复'), option('thinking', '整理答案'), option('skeptical', '核对回答'),
  ]),
  group('success', '任务成功', '会话成功结束后短暂展示；默认不再使用突兀的桌面庆祝图。', [
    option('cheerful', '开心完成'), option('proud', '满意收工'), option('desk-done', '桌前完成'),
  ], ['cheerful', 'proud']),
  group('waiting', '等待交互', '等待确认或回答时，随等待时间变化。', [
    option('relaxed', '耐心等待'), option('skeptical', '继续等待'), option('thinking', '边想边等'),
    option('angry', '等得生气'), option('sleepy', '等困了'),
  ]),
  group('error', '错误与道歉', '工具失败、任务失败或收到纠正时使用。', [
    option('shocked', '震惊'), option('apologetic', '道歉'), option('crying', '难过'), option('desk-facepalm', '桌前扶额'),
  ]),
  group('meal', '干饭', '上下文增长到需要“补充能量”时按时间轮换。', [
    option('deepseek-rice', '举起饭碗'), option('eating-rice', '认真扒饭'),
  ]),
])

const GROUPS_BY_ID = new Map(REACTION_GROUPS.map(item => [item.id, item]))

export function defaultReactionSettings() {
  return Object.freeze(Object.fromEntries(REACTION_GROUPS.map(item => [item.id, item.defaultEnabled])))
}

export function normalizeReactionSettings(value) {
  const normalized = {}
  for (const item of REACTION_GROUPS) {
    const allowed = new Set(item.options.map(entry => entry.id))
    const stored = Array.isArray(value?.[item.id]) ? value[item.id] : item.defaultEnabled
    const selected = new Set(stored.filter(reaction => allowed.has(reaction)))
    const enabled = item.options.map(entry => entry.id).filter(reaction => selected.has(reaction))
    normalized[item.id] = Object.freeze(enabled.length > 0 ? enabled : [...item.defaultEnabled])
  }
  return Object.freeze(normalized)
}

function readStoredSettings() {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
      return normalizeReactionSettings(JSON.parse(window.localStorage.getItem(REACTION_SETTINGS_KEY) ?? 'null'))
    }
  } catch {}
  return defaultReactionSettings()
}

let current = readStoredSettings()
const listeners = new Set()
let windowListenersAttached = false

function notify() {
  for (const listener of listeners) listener()
}

function onLocalChange(event) {
  const settings = event?.detail?.settings
  if (settings == null) return
  current = normalizeReactionSettings(settings)
  notify()
}

function onStoredChange(event) {
  if (event?.key !== REACTION_SETTINGS_KEY) return
  current = readStoredSettings()
  notify()
}

function attachWindowListeners() {
  if (windowListenersAttached || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  window.addEventListener(REACTION_SETTINGS_CHANGED_EVENT, onLocalChange)
  window.addEventListener('storage', onStoredChange)
  windowListenersAttached = true
}

function detachWindowListeners() {
  if (!windowListenersAttached) return
  window.removeEventListener?.(REACTION_SETTINGS_CHANGED_EVENT, onLocalChange)
  window.removeEventListener?.('storage', onStoredChange)
  windowListenersAttached = false
}

export function getReactionSettingsSnapshot() {
  return current
}

export function subscribeReactionSettings(listener) {
  listeners.add(listener)
  attachWindowListeners()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) detachWindowListeners()
  }
}

export function setReactionEnabled(groupId, reaction, enabled) {
  const item = GROUPS_BY_ID.get(groupId)
  if (!item || !item.options.some(entry => entry.id === reaction)) return false
  const selected = new Set(current[groupId] ?? item.defaultEnabled)
  if (enabled) selected.add(reaction)
  else {
    if (!selected.has(reaction) || selected.size <= 1) return false
    selected.delete(reaction)
  }
  const next = normalizeReactionSettings({ ...current, [groupId]: [...selected] })
  current = next
  try { window.localStorage?.setItem(REACTION_SETTINGS_KEY, JSON.stringify(next)) } catch {}
  try {
    window.dispatchEvent(new CustomEvent(REACTION_SETTINGS_CHANGED_EVENT, { detail: { settings: next } }))
  } catch {
    notify()
  }
  return true
}

export function resetReactionSettings() {
  const next = defaultReactionSettings()
  current = next
  try { window.localStorage?.setItem(REACTION_SETTINGS_KEY, JSON.stringify(next)) } catch {}
  try {
    window.dispatchEvent(new CustomEvent(REACTION_SETTINGS_CHANGED_EVENT, { detail: { settings: next } }))
  } catch {
    notify()
  }
}

/** Select deterministically from enabled candidates; never randomize on render. */
export function reactionForGroup(groupId, candidates, phase = 0, settings = current) {
  const item = GROUPS_BY_ID.get(groupId)
  const requested = [...new Set(candidates)].filter(Boolean)
  if (!item || requested.length === 0) return 'idle'
  const enabled = new Set(settings?.[groupId] ?? item.defaultEnabled)
  const available = requested.filter(reaction => enabled.has(reaction))
  const fallback = item.options.map(entry => entry.id).filter(reaction => enabled.has(reaction))
  const pool = available.length > 0 ? available : fallback.length > 0 ? fallback : requested
  const index = ((Math.trunc(phase) % pool.length) + pool.length) % pool.length
  return pool[index]
}
