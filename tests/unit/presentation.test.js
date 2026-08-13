import test from 'node:test'
import assert from 'node:assert/strict'
import { presentationForState } from '../../src/client/pet-presentation.js'

test('uses semantic reactions for long thought, full context, and images', () => {
  const thinking = { kind: 'thinking', detail: 'reasoning' }
  assert.equal(presentationForState(thinking, 1, { thinkingMs: 13_000 }).reaction, 'deepseek-rice')
  assert.equal(presentationForState(thinking, 0, { contextRatio: .9 }).reaction, 'satiated')
  assert.equal(presentationForState(thinking, 0, { hasImage: true }).reaction, 'blindfold')
})

test('maps tool work and terminal errors to richer emoji reactions', () => {
  assert.equal(presentationForState({ kind: 'idle' }, 99).reaction, 'idle')
  assert.equal(
    presentationForState({ kind: 'working', detail: 'apply_patch' }, 1).reaction,
    'desk-coding',
  )
  assert.equal(presentationForState({ kind: 'error' }, 2).reaction, 'desk-facepalm')
})

test('maps idle, question, correction, approval, and busy session signals', () => {
  assert.equal(presentationForState({ kind: 'idle' }, 0, { idleMs: 10 * 60_000 }).reaction, 'hungry')
  assert.equal(presentationForState({ kind: 'idle' }, 0, { idleMs: 30 * 60_000 }).reaction, 'pillow')
  assert.equal(presentationForState({ kind: 'idle' }, 0, { idleMs: 60 * 60_000 }).reaction, 'sleeping')
  assert.equal(presentationForState({ kind: 'thinking' }, 0, { questionCount: 5 }).reaction, 'desk-confused')
  assert.equal(presentationForState({ kind: 'idle' }, 0, { userCorrection: true }).reaction, 'apologetic')
  assert.equal(presentationForState({ kind: 'approval' }, 0).reaction, 'shocked')
  assert.equal(presentationForState({ kind: 'working' }, 0, { busySessions: 3 }).reaction, 'desk-coding')
})
