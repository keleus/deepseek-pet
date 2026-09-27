import { DeepSeekPetEntry } from './DeepSeekPet.jsx'
import { DeepSeekPetSettings } from './DeepSeekPetSettings.jsx'
import { installStyles } from './styles.js'
import { createSessionBridge } from './pet-session.js'

export const inject = ['slots', 'sessions']

/** Register the pet as an additive, frame-wide Harness Web overlay. */
export function apply(ctx) {
  ctx.effect(installStyles, 'ui-live2d: styles')
  const bridge = createSessionBridge(ctx)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'deepseek-pet',
    order: 90,
    label: 'DeepSeek Pet 插件',
    inject: () => ({
      resolveSession: sessionId => bridge.view(sessionId),
      openSession: sessionId => bridge.open(sessionId),
      statusSource: bridge.statuses,
    }),
  }, DeepSeekPetEntry))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'deepseek-pet',
    order: 90,
    label: '桌宠设置',
  }, DeepSeekPetSettings))
}
