import { reactionForGroup } from './pet-reactions.js'

const phaseFor = (elapsed, interval, fallback = 0) => Number.isFinite(elapsed)
  ? Math.floor(Math.max(0, elapsed) / interval)
  : fallback

/** Select one complete emoji sprite. Motion is applied to the whole sprite in CSS. */
export function presentationForState(visual, phase = 0, signals = {}) {
  if (visual.kind === 'whip') return result(visual.reaction)
  if (visual.kind === 'waiting') return waitingReaction(phase, signals.waitingMs ?? 0, signals.reactionSettings)
  if (signals.hasImage || visual.kind === 'vision') return result('blindfold')
  if (signals.userCorrection || visual.kind === 'apology') return grouped('error', ['apologetic', 'desk-facepalm'], 0, signals)
  if (visual.kind === 'tool-error') return grouped('error', (signals.visualMs ?? 0) < 3000 ? ['shocked', 'apologetic'] : ['desk-facepalm', 'apologetic'], 0, signals)
  if (visual.kind === 'approval') return waitingReaction(phase, signals.waitingMs ?? 0, signals.reactionSettings)
  if (signals.busySessions >= 3 || visual.kind === 'busy') {
    return alternatingWorkMeal('working', ['desk-coding', 'thinking'], phaseFor(signals.visualMs, 15_000, phase), signals)
  }
  if (signals.contextRatio >= 0.82 || visual.kind === 'full') return result('satiated')
  if (signals.contextRatio >= 0.62 || visual.kind === 'context-snack') {
    return grouped('meal', ['deepseek-rice', 'eating-rice'], phaseFor(signals.visualMs, 20_000, phase), signals)
  }
  if (visual.kind === 'sleeping' || signals.idleMs >= 60 * 60_000) return result('sleeping')
  if (visual.kind === 'sleepy' || signals.idleMs >= 30 * 60_000) return result('pillow')
  if (visual.kind === 'hungry' || signals.idleMs >= 10 * 60_000) return result('hungry')
  if (visual.kind === 'thinking' && signals.questionCount >= 4) {
    const candidates = signals.questionCount >= 7 ? ['deepseek-pressure', 'desk-confused'] : ['desk-confused', 'thinking']
    return alternatingWorkMeal('thinking', candidates, phaseFor(signals.thinkingMs, 12_000, phase), signals)
  }
  if (visual.kind === 'thinking') {
    if ((signals.thinkingMs ?? 0) < 12_000) return grouped('thinking', ['thinking', 'desk-coding'], 0, signals)
    const candidates = signals.thinkingMs < 45_000
      ? ['desk-coding', 'thinking', 'relaxed']
      : ['desk-confused', 'desk-coding', 'deepseek-pressure']
    return alternatingWorkMeal('thinking', candidates, phaseFor(signals.thinkingMs - 12_000, 12_000), signals)
  }

  if (visual.kind === 'success') {
    return grouped('success', ['cheerful', 'proud', 'desk-done'], phaseFor(signals.visualMs, 4_000), signals)
  }
  if (visual.kind === 'error') return grouped('error', ['apologetic', 'crying', 'desk-facepalm'], phaseFor(signals.visualMs, 5_000, phase), signals)
  if (visual.kind === 'working') return alternatingWorkMeal('working', reactionsForTool(visual.detail), phaseFor(signals.visualMs, 15_000, phase), signals)
  if (visual.kind === 'listening') return result('skeptical')
  if (visual.kind === 'speaking') return grouped('speaking', ['desk-coding', 'thinking', 'skeptical'], phaseFor(signals.visualMs, 12_000, phase), signals)
  if (visual.kind === 'confused') {
    const candidates = signals.questionCount >= 7 ? ['deepseek-pressure', 'desk-confused'] : ['desk-confused', 'thinking']
    return alternatingWorkMeal('thinking', candidates, phaseFor(signals.thinkingMs ?? signals.visualMs, 12_000, phase), signals)
  }
  if (visual.kind === 'idle') {
    return grouped('idle', ['idle', 'relaxed', 'cheerful', 'proud'], phaseFor(signals.idleMs, 30_000, phase), signals)
  }
  return result('idle')
}

function waitingReaction(phase, waitingMs, reactionSettings) {
  const signals = { reactionSettings }
  if (waitingMs >= 4 * 60_000) return grouped('waiting', ['sleepy', 'skeptical'], 0, signals)
  if (waitingMs >= 2 * 60_000) return grouped('waiting', ['angry', 'skeptical'], 0, signals)
  if (waitingMs >= 45_000) return grouped('waiting', ['skeptical', 'thinking'], phaseFor(waitingMs - 45_000, 30_000), signals)
  return grouped('waiting', ['relaxed', 'skeptical', 'thinking'], phaseFor(waitingMs, 15_000, phase), signals)
}

function reactionsForTool(detail) {
  const tool = String(detail ?? '').toLowerCase()
  if (tool.includes('subagent') || tool.includes('spawn_agent') || tool.includes('create_thread')) return ['desk-coding', 'thinking']
  if (tool.includes('web') || tool.includes('search') || tool.includes('browser')) return ['skeptical', 'thinking']
  if (tool === 'read' || tool.includes('fetch')) return ['thinking', 'skeptical']
  if (tool.includes('image') || tool.includes('draw')) return ['thinking', 'desk-coding']
  if (tool.includes('patch') || tool.includes('edit') || tool.includes('write') || tool.includes('bash') || tool.includes('exec')) {
    return ['desk-coding', 'thinking']
  }
  return ['desk-coding', 'thinking']
}

function grouped(groupId, candidates, phase, signals) {
  return result(reactionForGroup(groupId, candidates, phase, signals.reactionSettings))
}

function alternatingWorkMeal(groupId, workCandidates, phase, signals) {
  const turn = Math.max(0, Math.trunc(phase))
  const candidates = turn % 2 === 0 ? workCandidates : ['eating-rice', 'deepseek-rice']
  return grouped(groupId, candidates, Math.floor(turn / 2), signals)
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
