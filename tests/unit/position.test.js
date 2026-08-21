import test from 'node:test'
import assert from 'node:assert/strict'
import { clampPetOffset } from '../../src/client/pet-position.js'

const viewport = { width: 1280, height: 720 }
const rect = { left: 1000, top: 450, right: 1228, bottom: 694 }
const current = { x: 0, y: 0 }

test('keeps pet drag offsets inside every viewport edge', () => {
  assert.deepEqual(clampPetOffset({ x: -2000, y: -2000 }, current, rect, viewport), { x: -992, y: -442 })
  assert.deepEqual(clampPetOffset({ x: 2000, y: 2000 }, current, rect, viewport), { x: 44, y: 18 })
})

test('corrects a persisted offset relative to its current character rectangle', () => {
  const saved = { x: -1200, y: 80 }
  const movedRect = { left: -200, top: 530, right: 28, bottom: 774 }
  assert.deepEqual(clampPetOffset(saved, saved, movedRect, viewport), { x: -992, y: 18 })
})

test('centers a character that cannot fit in a tiny viewport', () => {
  assert.deepEqual(
    clampPetOffset({ x: 10, y: 10 }, current, { left: 0, top: 0, right: 300, bottom: 240 }, { width: 200, height: 160 }),
    { x: -50, y: -40 },
  )
})

test('ignores malformed geometry instead of emitting invalid CSS offsets', () => {
  assert.deepEqual(clampPetOffset({ x: Infinity, y: 1 }, current, rect, viewport), current)
  assert.deepEqual(clampPetOffset({ x: 1, y: 1 }, current, null, viewport), current)
})
