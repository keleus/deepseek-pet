/** Select one complete emoji sprite. Motion is applied to the whole sprite in CSS. */
export function presentationForState(visual, phase = 0, signals = {}) {
  if (visual.kind === 'waiting') return waitingReaction(phase, signals.waitingMs ?? 0)
  if (signals.hasImage || visual.kind === 'vision') return result('blindfold')
  if (signals.userCorrection || visual.kind === 'apology') return result('apologetic')
  if (visual.kind === 'tool-error') return result((signals.visualMs ?? 0) < 3000 ? 'shocked' : 'desk-facepalm')
  if (visual.kind === 'approval') return waitingReaction(phase, signals.waitingMs ?? 0)
  if (signals.busySessions >= 3 || visual.kind === 'busy') return result('desk-coding')
  if (signals.contextRatio >= 0.82 || visual.kind === 'full') return result('satiated')
  if (signals.contextRatio >= 0.62 || visual.kind === 'context-snack') return result('deepseek-rice')
  if (visual.kind === 'sleeping' || signals.idleMs >= 60 * 60_000) return result('sleeping')
  if (visual.kind === 'sleepy' || signals.idleMs >= 30 * 60_000) return result('pillow')
  if (visual.kind === 'hungry' || signals.idleMs >= 10 * 60_000) return result('hungry')
  if (visual.kind === 'thinking' && signals.questionCount >= 4) {
    return result(signals.questionCount >= 7 ? 'deepseek-pressure' : ['desk-confused', 'thinking'][phase % 2])
  }
  if (visual.kind === 'thinking') {
    if ((signals.thinkingMs ?? 0) < 12_000) return result('thinking')
    if (signals.thinkingMs < 45_000) return result(['desk-coding', 'relaxed', 'thinking'][(Math.max(1, phase) - 1) % 3])
    return result(['desk-confused', 'desk-coding', 'deepseek-pressure'][phase % 3])
  }

  if (visual.kind === 'success') {
    const elapsed = signals.visualMs ?? 0
    return result(elapsed < 2500 ? 'desk-done' : elapsed < 5200 ? 'cheerful' : 'proud')
  }
  if (visual.kind === 'error') return result(['apologetic', 'crying', 'desk-facepalm'][phase % 3])
  if (visual.kind === 'working') return result(reactionForTool(visual.detail))
  if (visual.kind === 'listening') return result('skeptical')
  if (visual.kind === 'thinking') return result('thinking')
  if (visual.kind === 'speaking') return result(['desk-coding', 'thinking', 'skeptical'][phase % 3])
  if (visual.kind === 'confused') return result('desk-confused')
  if (visual.kind === 'idle') {
    if ((signals.idleMs ?? 0) >= 2 * 60_000) return result(['relaxed', 'skeptical', 'thinking'][phase % 3])
    return result(['idle', 'cheerful', 'relaxed', 'proud'][phase % 4])
  }
  return result('idle')
}

function waitingReaction(phase, waitingMs) {
  if (waitingMs >= 4 * 60_000) return result('sleepy')
  if (waitingMs >= 2 * 60_000) return result('angry')
  if (waitingMs >= 45_000) return result('skeptical')
  return result(['relaxed', 'skeptical', 'thinking'][phase % 3])
}

function reactionForTool(detail) {
  const tool = String(detail ?? '').toLowerCase()
  if (tool.includes('subagent') || tool.includes('spawn_agent') || tool.includes('create_thread')) return 'desk-coding'
  if (tool.includes('web') || tool.includes('search') || tool.includes('browser')) return 'skeptical'
  if (tool === 'read' || tool.includes('fetch')) return 'thinking'
  if (tool.includes('image') || tool.includes('draw')) return 'thinking'
  if (tool.includes('patch') || tool.includes('edit') || tool.includes('write') || tool.includes('bash') || tool.includes('exec')) {
    return 'desk-coding'
  }
  return 'desk-coding'
}

function result(reaction) {
  return { expression: reaction, reaction }
}

export function latestOutput(text, limit = 180) {
  const normalized = String(text ?? '').replace(/\s+/gu, ' ').trim()
  if (normalized.length <= limit) return normalized
  const tail = normalized.slice(-limit)
  const boundary = tail.search(/[。！？.!?；;]\s*/u)
  return (boundary >= 0 ? tail.slice(boundary + 1) : tail).trimStart()
}

export function clampPetScale(current, deltaY) {
  return Math.max(.65, Math.min(1.4, Math.round((current - deltaY * .0012) * 100) / 100))
}

export function rotatingActivityLabel(mode, phase, questionCount = 0, thinkingMs = 0) {
  if (mode === '回复') return ['正在敲字', '整理回复', '组织答案'][phase % 3]
  if (questionCount >= 4) return ['梳理疑问', '逐项排查', '验证线索'][phase % 3]
  if (thinkingMs >= 12_000) return ['深度思考', '消化上下文', '继续推演'][phase % 3]
  return ['分析中', '梳理上下文', '验证思路'][phase % 3]
}
