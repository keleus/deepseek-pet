/**
 * 桌宠设置 — the DeepSeek Pet page inside the dsh settings panel
 * (`settings.section`). One dropdown drives the shared display-mode store
 * (`pet-display.js`): 默认 / 页面置顶 / 浏览器置顶. Changes apply
 * immediately — the pet surface and this page subscribe to the same store.
 * Styling follows the page's design system (inherited panel font and the
 * `--dsw-alias-*` tokens used by the other settings sections).
 */

import { useSyncExternalStore } from 'react'
import {
  DISPLAY_MODES, displayModeOf, getDisplayModeSnapshot, setDisplayMode, subscribeDisplayMode,
} from './pet-display.js'

export function DeepSeekPetSettings() {
  const mode = useSyncExternalStore(subscribeDisplayMode, getDisplayModeSnapshot, getDisplayModeSnapshot)
  const current = displayModeOf(mode)
  return (
    <div className="dsh-live2d-settings">
      <div>
        <h2 className="dsh-live2d-settings-title">桌宠设置</h2>
        <p className="dsh-live2d-settings-intro">
          控制 DeepSeek 桌宠在网页里的展示位置。修改立即生效，无需刷新。
        </p>
      </div>

      <label className="dsh-live2d-settings-field">
        <span className="dsh-live2d-settings-label">展示模式</span>
        <select
          className="dsh-live2d-settings-select"
          value={mode}
          aria-label="桌宠展示模式"
          onChange={event => setDisplayMode(event.target.value)}
        >
          {DISPLAY_MODES.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>

      <p className="dsh-live2d-settings-detail" data-mode={mode}>{current.description}</p>

      {mode === 'browser-top' && (
        <p className="dsh-live2d-settings-hint">
          浏览器置顶为页面内全局置顶：不新开窗口或标签页，自动适配所有浏览器；
          切换浏览器标签页时，桌宠随当前页面显示。
        </p>
      )}
    </div>
  )
}
