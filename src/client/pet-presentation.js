/** Select one complete emoji sprite. Motion is applied to the whole sprite in CSS. */
export function presentationForState(visual, phase = 0, signals = {}) {
  if (signals.hasImage || visual.kind === 'vision') return result('blindfold')
  if (signals.userCorrection || visual.kind === 'apology') return result('apologetic')
  if (visual.kind === 'tool-error') return result('desk-facepalm')
  if (visual.kind === 'approval') return result('shocked')
  if (signals.busySessions >= 3 || visual.kind === 'busy') return result('desk-coding')
  if (signals.contextRatio >= 0.82 || visual.kind === 'full') return result('satiated')
  if (signals.contextRatio >= 0.62 || visual.kind === 'context-snack') return result('deepseek-rice')
  if (visual.kind === 'sleeping' || signals.idleMs >= 60 * 60_000) return result('sleeping')
  if (visual.kind === 'sleepy' || signals.idleMs >= 30 * 60_000) return result('pillow')
  if (visual.kind === 'hungry' || signals.idleMs >= 10 * 60_000) return result('hungry')
  if (visual.kind === 'thinking' && signals.questionCount >= 4) {
    return result(signals.questionCount >= 7 ? 'deepseek-pressure' : 'desk-confused')
  }
  if (visual.kind === 'thinking' && signals.thinkingMs >= 12000) {
    return result(signals.thinkingMs < 30000 ? 'deepseek-rice' : 'deepseek-pressure')
  }

  if (visual.kind === 'success') return result(['desk-done', 'cheerful', 'proud'][phase % 3])
  if (visual.kind === 'error') return result(['apologetic', 'crying', 'desk-facepalm'][phase % 3])
  if (visual.kind === 'working') return result(reactionForTool(visual.detail))
  if (visual.kind === 'listening') return result('skeptical')
  if (visual.kind === 'thinking') return result('thinking')
  if (visual.kind === 'speaking') return result('cheerful')
  if (visual.kind === 'confused') return result('desk-confused')
  return result('idle')
}

function reactionForTool(detail) {
  const tool = String(detail ?? '').toLowerCase()
  if (tool.includes('subagent') || tool.includes('spawn_agent') || tool.includes('create_thread')) return 'desk-coding'
  if (tool.includes('web') || tool.includes('search') || tool.includes('browser')) return 'skeptical'
  if (tool === 'read' || tool.includes('fetch')) return 'thinking'
  if (tool.includes('image') || tool.includes('draw')) return 'deepseek-rice'
  if (tool.includes('patch') || tool.includes('edit') || tool.includes('write') || tool.includes('bash') || tool.includes('exec')) {
    return 'desk-coding'
  }
  return 'angry'
}

function result(reaction) {
  return { expression: reaction, reaction }
}
