import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactModule from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'

test('declares an installable dsh bundle for the web profile', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')

  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.ok(manifest.files.includes('docs/deepseek-pet-preview.png'))
  assert.match(patch, /id: deepseek-pet/)
  assert.match(patch, /name: deepseek-pet/)
})

test('built dsh.client bundle registers the shell overlay and the pet settings section', async () => {
  let moduleRecord
  const registered = {}
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
    if (specifier === 'react-dom') return ReactDom
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
        assert.ok(name === 'shell.overlay' || name === 'settings.section', `unexpected slot: ${name}`)
        return callback()
      },
      register(options, Component) {
        registered[options.name] = { options, Component, business: options.inject?.() }
        return () => {}
      },
    },
  }

  plugin.apply(ctx)
  assert.equal(registered['shell.overlay'].options.id, 'deepseek-pet')
  assert.equal(registered['settings.section'].options.id, 'deepseek-pet')
  assert.equal(registered['settings.section'].options.label, '桌宠设置')
  assert.equal(styles.length, 1)

  const listSnapshot = {
    current: 'focus',
    ids: ['focus', 'one', 'two', 'three', 'four'],
    byId: {
      focus: { id: 'focus', displayTitle: '当前任务', running: false, updatedAt: 5 },
      one: { id: 'one', displayTitle: '任务一', running: true, updatedAt: 4 },
      two: { id: 'two', displayTitle: '任务二', running: true, updatedAt: 3 },
      three: { id: 'three', displayTitle: '任务三', running: true, updatedAt: 2 },
      four: { id: 'four', displayTitle: '任务四', running: true, updatedAt: 1 },
    },
  }
  const sessionSnapshot = {
    openState: 'open', running: false, runningCalls: [], partial: null, queue: [], nodes: [],
    pending: [{ kind: 'question', key: 'question-1', payload: { questions: [{ id: 'choice', question: '请选择下一步' }] } }],
  }
  ctx.sessions.binding = () => ({
    session: {
      subscribe() { return () => {} },
      getSnapshot() { return sessionSnapshot },
      projections: { faceOf() { return undefined } },
    },
  })
  const html = renderToStaticMarkup(React.createElement(registered['shell.overlay'].Component, {
    useSessions: selector => selector(listSnapshot),
    ...registered['shell.overlay'].business,
  }))
  assert.match(html, /DeepSeek 任务状态助手/)
  assert.match(html, /data-current="true"/)
  assert.doesNotMatch(html, /查看上下文/)
  assert.match(html, /最小化 Pet/)
  assert.doesNotMatch(html, /查看今日消耗/)
  assert.match(html, /data-stacked="true"/)
  assert.doesNotMatch(html, /聚焦会话/)
  assert.doesNotMatch(html, /dsh-live2d-rig|dsh-live2d-part/)
  assert.match(html, /等待你的回答/)
  assert.doesNotMatch(html, /dsh-live2d-pending|<fieldset|请选择下一步|>提交</)
  assert.match(html, /data-display-mode="default"/)

  const settingsHtml = renderToStaticMarkup(React.createElement(registered['settings.section'].Component))
  assert.match(settingsHtml, /桌宠设置/)
  assert.match(settingsHtml, /展示模式/)
  assert.match(settingsHtml, /value="default"/)
  assert.match(settingsHtml, /value="page-top"/)
  assert.match(settingsHtml, /value="browser-top"/)

  for (const cleanup of cleanups.reverse()) cleanup()
  delete globalThis.window
  delete globalThis.document
})
