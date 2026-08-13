import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactModule from 'react'
import * as JsxRuntime from 'react/jsx-runtime'

test('declares an installable dsh bundle for the web profile', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')

  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.match(patch, /id: deepseek-pet/)
  assert.match(patch, /name: deepseek-pet/)
})

test('built dsh.client bundle registers an embedded shell overlay', async () => {
  let moduleRecord
  let registered
  const styles = []
  const cleanups = []

  globalThis.window = {
    __ModuleLoader__: {
      load(record) { moduleRecord = record },
    },
  }
  globalThis.document = {
    querySelector() { return null },
    createElement() {
      return { dataset: {}, textContent: '', remove() {} }
    },
    head: { append(style) { styles.push(style) } },
  }

  await import(`../../lib/client.js?test=${Date.now()}`)
  assert.equal(moduleRecord.id, 'deepseek-pet')

  const plugin = moduleRecord.factory((specifier) => {
    if (specifier === 'react') return ReactModule
    if (specifier === 'react/jsx-runtime') return JsxRuntime
    throw new Error(`unexpected client external: ${specifier}`)
  })

  const ctx = {
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => cleanup?.()
    },
    sessions: { binding() { return undefined }, open() {} },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'shell.overlay')
        return callback()
      },
      register(options, Component) {
        registered = { options, Component, business: options.inject() }
        return () => {}
      },
    },
  }

  plugin.apply(ctx)
  assert.equal(registered.options.id, 'deepseek-pet')
  assert.equal(styles.length, 1)

  const listSnapshot = { current: undefined, byId: {} }
  const html = renderToStaticMarkup(React.createElement(registered.Component, {
    useSessions: selector => selector(listSnapshot),
    ...registered.business,
  }))
  assert.match(html, /DeepSeek 任务状态助手/)
  assert.match(html, /聚焦会话/)
  assert.doesNotMatch(html, /dsh-live2d-rig|dsh-live2d-part/)

  for (const cleanup of cleanups.reverse()) cleanup()
  delete globalThis.window
  delete globalThis.document
})
