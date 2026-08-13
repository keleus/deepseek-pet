import test from 'node:test'
import assert from 'node:assert/strict'
import { completionState, hasRecentCorrection, hasRecentImage, reasoningQuestionCount, stateFromSnapshot, streamFromSnapshot } from '../../src/client/pet-state.js'

test('maps loading and running task state', () => {
  assert.equal(stateFromSnapshot({ openState: 'loading' }).kind, 'thinking')
  assert.equal(stateFromSnapshot({ openState: 'open', running: true }).kind, 'thinking')
})

test('maps tool activity and streaming output', () => {
  assert.deepEqual(
    stateFromSnapshot({ openState: 'open', running: true, runningCalls: [{ name: 'exec_command' }] }),
    { kind: 'working', label: '正在敲终端', detail: 'exec_command' },
  )
  assert.equal(stateFromSnapshot({ openState: 'open', running: true, partial: { blocks: [{ kind: 'reasoning', text: 'x' }] } }).kind, 'thinking')
  assert.equal(stateFromSnapshot({ openState: 'open', running: true, partial: { blocks: [{ kind: 'text', text: 'x' }] } }).kind, 'speaking')
})

test('maps interaction waits and queue depth', () => {
  assert.equal(stateFromSnapshot({ openState: 'open', pending: [{}] }).kind, 'waiting')
  assert.equal(stateFromSnapshot({ openState: 'open', running: true, pending: [{ kind: 'approval' }] }).kind, 'waiting')
  assert.equal(stateFromSnapshot({ openState: 'open', queue: [{}, {}] }).label, '队列中还有 2 项')
})

test('detects corrections, question-heavy reasoning, and tool failures', () => {
  assert.equal(hasRecentCorrection({ nodes: [{ kind: 'user', content: [{ type: 'text', text: '你这个做错了，重新做' }] }] }), true)
  assert.ok(reasoningQuestionCount({ partial: { blocks: [{ kind: 'reasoning', text: '为什么？怎么回事？是否遗漏？哪里不对？' }] } }) >= 4)
  assert.equal(stateFromSnapshot({ openState: 'open', nodes: [{ kind: 'tool-result', isError: true, call: { name: 'web_search' } }] }).kind, 'tool-error')
})

test('maps failures and completion edge', () => {
  assert.equal(stateFromSnapshot({ openState: 'open', lastAgentError: 'provider failed' }).kind, 'error')
  assert.equal(stateFromSnapshot(null).kind, 'idle')
  assert.equal(completionState().kind, 'success')
})

test('detects image input and exposes the live transcript', () => {
  const snapshot = {
    openState: 'open',
    nodes: [{ kind: 'user', content: [{ type: 'image', attachment: {} }] }],
    partial: { blocks: [
      { kind: 'reasoning', text: '先分析一下' },
      { kind: 'text', text: '正在回答' },
    ] },
  }
  assert.equal(hasRecentImage(snapshot), true)
  assert.equal(stateFromSnapshot(snapshot).kind, 'vision')
  assert.deepEqual(streamFromSnapshot(snapshot), { reasoning: '先分析一下', reply: '正在回答' })
})
