import React, { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { DeepSeekPet } from '../../src/client/DeepSeekPet.jsx'
import { installStyles } from '../../src/client/styles.js'

let snapshot = {
  openState: 'open', running: false, runningCalls: [], partial: null,
  pending: [], queue: [], nodes: [], lastAgentError: null, openError: null, promptError: null,
}
let pressure = {}
let listSnapshot = {
  current: 'fixture', ids: ['fixture', 'review', 'research'], byId: {
    fixture: { id: 'fixture', displayTitle: '修复登录页错误', running: false, updatedAt: Date.now() },
    review: { id: 'review', displayTitle: '代码审查', running: true, updatedAt: Date.now() - 1000 },
    research: { id: 'research', displayTitle: '查找鉴权资料', running: true, updatedAt: Date.now() - 2000 },
  },
}
const listeners = new Set()
const pressureListeners = new Set()
const session = {
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  getSnapshot() { return snapshot },
  projections: { faceOf() { return {
    subscribe(listener) { pressureListeners.add(listener); return () => pressureListeners.delete(listener) },
    getSnapshot() { return pressure },
  } } },
}

function setSnapshot(next) {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

function setPressure(next) {
  pressure = next
  for (const listener of pressureListeners) listener()
}

function HarnessFixture() {
  const useSessions = selector => useSyncExternalStore(
    () => () => {},
    () => selector(listSnapshot),
  )
  return <DeepSeekPet useSessions={useSessions} resolveSession={() => session} openSession={() => {}} />
}

installStyles()
createRoot(document.querySelector('#overlay')).render(<HarnessFixture />)

document.querySelector('#states').addEventListener('click', event => {
  const state = event.target.closest('[data-state]')?.dataset.state
  if (state === 'idle') { setPressure({}); setSnapshot({ running: false, runningCalls: [], partial: null, nodes: [], lastAgentError: null }) }
  if (state === 'thinking') setSnapshot({ running: true, runningCalls: [], nodes: [], partial: { blocks: [{ kind: 'reasoning', text: '我正在检查登录状态、刷新令牌的时序，以及失败重试是否会覆盖新状态。\n接下来对比缓存写入与请求发起的先后关系……' }] }, lastAgentError: null })
  if (state === 'working') setSnapshot({ running: true, runningCalls: [{ name: 'apply_patch' }], partial: null, lastAgentError: null })
  if (state === 'speaking') setSnapshot({ running: true, runningCalls: [], partial: { blocks: [{ kind: 'text', text: '已经定位到刷新令牌和请求重试之间的竞态条件，正在补充互斥保护并更新测试。' }] }, lastAgentError: null })
  if (state === 'image') setSnapshot({ running: true, runningCalls: [], partial: null, nodes: [{ kind: 'user', content: [{ type: 'image', attachment: {} }] }], lastAgentError: null })
  if (state === 'full') { setSnapshot({ nodes: [], lastAgentError: null }); setPressure({ projectedTokens: 92000, contextWindow: 100000 }) }
  if (state === 'error') setSnapshot({ running: false, runningCalls: [], partial: null, lastAgentError: '测试未通过' })
  if (state === 'success') {
    setSnapshot({ running: true, runningCalls: [], partial: null, lastAgentError: null })
    setTimeout(() => setSnapshot({ running: false }), 80)
  }
  if (state === 'approval') setSnapshot({ running: true, runningCalls: [], partial: null, lastAgentError: null, pending: [{ kind: 'approval', key: 'a:fixture', sessionId: 'fixture', payload: { approvalId: 'approve-1', toolName: 'exec_command', reason: '允许执行测试命令吗？' }, respond: async () => ({ accepted: true }) }] })
})
