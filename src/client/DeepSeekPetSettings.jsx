/**
 * 桌宠设置 — the DeepSeek Pet page inside the dsh settings panel
 * (`settings.section`). One dropdown drives the shared display-mode store
 * (`pet-display.js`): 默认 / 页面置顶. Changes apply immediately — the pet
 * surface and this page subscribe to the same store. Styling follows the
 * page's design system (inherited panel font and the `--dsw-alias-*` tokens
 * used by the other settings sections).
 */

import { useSyncExternalStore } from 'react'
import { REACTIONS } from './assets.generated.js'
import {
  DISPLAY_MODES, displayModeOf, getDisplayModeSnapshot, setDisplayMode, subscribeDisplayMode,
} from './pet-display.js'
import {
  REACTION_GROUPS, getReactionSettingsSnapshot, resetReactionSettings, setReactionEnabled, subscribeReactionSettings,
} from './pet-reactions.js'

export function DeepSeekPetSettings() {
  const mode = useSyncExternalStore(subscribeDisplayMode, getDisplayModeSnapshot, getDisplayModeSnapshot)
  const reactionSettings = useSyncExternalStore(subscribeReactionSettings, getReactionSettingsSnapshot, getReactionSettingsSnapshot)
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

      <section className="dsh-live2d-settings-reactions" aria-labelledby="dsh-live2d-reaction-settings-title">
        <header>
          <div>
            <h3 id="dsh-live2d-reaction-settings-title">动作图片</h3>
            <p>图片按动作分组。每组至少保留一张，切换顺序只由该动作的累计时长决定。</p>
          </div>
          <button type="button" onClick={resetReactionSettings}>恢复默认</button>
        </header>
        {REACTION_GROUPS.map(group => {
          const enabled = new Set(reactionSettings[group.id])
          return (
            <fieldset className="dsh-live2d-settings-reaction-group" key={group.id}>
              <legend>{group.label}</legend>
              <p>{group.description}</p>
              <div>
                {group.options.map(item => {
                  const checked = enabled.has(item.id)
                  const lastEnabled = checked && enabled.size === 1
                  return (
                    <label key={item.id} data-enabled={checked ? 'true' : 'false'}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={lastEnabled}
                        onChange={event => setReactionEnabled(group.id, item.id, event.target.checked)}
                      />
                      <img src={REACTIONS[item.id]} alt="" />
                      <span>{item.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
      </section>
    </div>
  )
}
