import assert from 'node:assert/strict'
import test from 'node:test'

test('notifies each display-mode subscriber once per local and cross-window change', async () => {
  const originalWindow = globalThis.window
  const stored = new Map()
  const testWindow = new EventTarget()
  testWindow.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  }
  globalThis.window = testWindow

  try {
    const display = await import(`../../src/client/pet-display.js?test=${Date.now()}`)
    const calls = [0, 0, 0]
    const unsubscribe = calls.map((_, index) => display.subscribeDisplayMode(() => { calls[index] += 1 }))

    display.setDisplayMode('page-top')

    assert.deepEqual(calls, [1, 1, 1])

    stored.set(display.DISPLAY_MODE_KEY, 'default')
    const storageEvent = new Event('storage')
    Object.defineProperty(storageEvent, 'key', { value: display.DISPLAY_MODE_KEY })
    testWindow.dispatchEvent(storageEvent)

    assert.deepEqual(calls, [2, 2, 2])
    for (const stop of unsubscribe) stop()
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
