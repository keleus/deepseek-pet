import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { REACTIONS } from './assets.generated.js'
import { clampPetScale, latestOutput, presentationForState, rotatingActivityLabel } from './pet-presentation.js'
import {
  completionState, hasRecentCorrection, hasRecentImage, reasoningQuestionCount,
  stateFromSnapshot, streamFromSnapshot,
} from './pet-state.js'

const EMPTY_SNAPSHOT = Object.freeze({
  openState: 'open', running: false, runningCalls: [], partial: null,
  pending: [], queue: [], nodes: [], lastAgentError: null,
})
const EMPTY_PRESSURE = Object.freeze({})
const POSITION_KEY = 'deepseek-pet:position'
const SCALE_KEY = 'deepseek-pet:scale'
const TEN_MINUTES = 10 * 60_000
const THIRTY_MINUTES = 30 * 60_000
const ONE_HOUR = 60 * 60_000

export function DeepSeekPet({ useSessions, resolveSession, openSession }) {
  const list = useSessions(value => value)
  const sessionId = list.current
  const focusedSession = sessionId ? list.byId[sessionId] : undefined
  const runningSessions = useMemo(() => (list.ids ?? [])
      .map(id => list.byId[id])
      .filter(item => item && item.id !== sessionId && (item.running || item.pendingInteraction))
      .sort((a, b) => Number(b.running) - Number(a.running) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [list, sessionId])
  const busySessions = runningSessions.filter(item => item.running).length + Number(Boolean(focusedSession?.running))
  const session = useMemo(() => sessionId ? resolveSession(sessionId) : undefined, [resolveSession, sessionId])
  const subscribe = useCallback(listener => session?.subscribe(listener) ?? (() => {}), [session])
  const getSnapshot = useCallback(() => session?.getSnapshot() ?? EMPTY_SNAPSHOT, [session])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const pressureFace = useMemo(() => session?.projections?.faceOf?.('contextPressure'), [session])
  const subscribePressure = useCallback(listener => pressureFace?.subscribe(listener) ?? (() => {}), [pressureFace])
  const getPressure = useCallback(() => pressureFace?.getSnapshot() ?? EMPTY_PRESSURE, [pressureFace])
  const pressure = useSyncExternalStore(subscribePressure, getPressure, getPressure)
  const immediate = stateFromSnapshot(session ? snapshot : null)
  const [visual, setVisual] = useState(immediate)
  const [collapsed, setCollapsed] = useState(false)
  const [phase, setPhase] = useState(0)
  const [thinkingMs, setThinkingMs] = useState(0)
  const [idleMs, setIdleMs] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [tapText, setTapText] = useState('')
  const [tapDetail, setTapDetail] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(true)
  const [bubblePage, setBubblePage] = useState(0)
  const [activeReaction, setActiveReaction] = useState('idle')
  const [reactionPending, setReactionPending] = useState(false)
  const wasRunning = useRef(false)
  const idleStarted = useRef(Date.now())
  const humanTurnKey = useRef('')
  const drag = useRef(null)
  const dragged = useRef(false)
  const speechTimer = useRef(null)
  const streamLineRef = useRef(null)
  const typedStreamRef = useRef('')
  const streamTargetRef = useRef('')
  const reactionChangedAt = useRef(0)

  useEffect(() => {
    let transitionTimer
    let completionTimer
    const commit = next => setVisual(current => sameVisual(current, next) ? current : next)
    if (snapshot.running) {
      wasRunning.current = true
      transitionTimer = window.setTimeout(() => commit(immediate), immediate.kind === 'error' ? 100 : 720)
    } else if (wasRunning.current) {
      wasRunning.current = false
      if (immediate.kind === 'error' || immediate.kind === 'tool-error') commit(immediate)
      else {
        commit(completionState())
        completionTimer = window.setTimeout(() => commit(immediate), 4800)
      }
    } else transitionTimer = window.setTimeout(() => commit(immediate), immediate.kind === 'error' ? 100 : 720)
    return () => { window.clearTimeout(transitionTimer); window.clearTimeout(completionTimer) }
  }, [immediate.kind, immediate.label, immediate.detail, snapshot.running])

  useEffect(() => {
    setPhase(0)
    const interval = window.setInterval(() => setPhase(value => value + 1), 12_000)
    return () => window.clearInterval(interval)
  }, [visual.kind, visual.detail])

  useEffect(() => {
    if (visual.kind !== 'thinking') { setThinkingMs(0); return () => {} }
    const started = Date.now()
    const interval = window.setInterval(() => setThinkingMs(Date.now() - started), 1000)
    return () => window.clearInterval(interval)
  }, [visual.kind])

  const latestHuman = latestHumanTurnKey(snapshot)
  useEffect(() => {
    if (latestHuman && latestHuman !== humanTurnKey.current) {
      humanTurnKey.current = latestHuman
      idleStarted.current = Date.now()
      setIdleMs(0)
    }
  }, [latestHuman])

  const taskActive = Boolean(snapshot.running || snapshot.runningCalls?.length || snapshot.partial || snapshot.pending?.length || snapshot.queue?.length)
  useEffect(() => {
    if (taskActive) { idleStarted.current = Date.now(); setIdleMs(0); return () => {} }
    const update = () => setIdleMs(Date.now() - idleStarted.current)
    update()
    const interval = window.setInterval(update, 15_000)
    return () => window.clearInterval(interval)
  }, [taskActive, sessionId])

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage?.getItem(POSITION_KEY) ?? 'null')
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) setOffset(saved)
      const savedScale = Number(window.localStorage?.getItem(SCALE_KEY))
      if (Number.isFinite(savedScale) && savedScale >= .65 && savedScale <= 1.4) setScale(savedScale)
    } catch {}
  }, [])

  const stream = streamFromSnapshot(snapshot)
  const streamText = stream.reply || stream.reasoning
  const streamMode = stream.reply ? '回复' : '思考'
  const hasStream = Boolean(streamText)
  const streamTarget = useMemo(() => latestOutput(streamText), [streamText])
  const [typedStream, setTypedStream] = useState('')

  useEffect(() => {
    streamTargetRef.current = streamTarget
    if (!streamTarget) {
      typedStreamRef.current = ''
      setTypedStream('')
    } else if (!streamTarget.startsWith(typedStreamRef.current)) {
      const cursor = sharedPrefixLength(typedStreamRef.current, streamTarget)
      typedStreamRef.current = streamTarget.slice(0, cursor)
      setTypedStream(typedStreamRef.current)
    }
  }, [streamTarget])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const target = streamTargetRef.current
      const current = typedStreamRef.current
      if (!target || current === target) return
      if (!target.startsWith(current)) {
        typedStreamRef.current = target.slice(0, sharedPrefixLength(current, target))
      }
      typedStreamRef.current = target.slice(0, Math.min(target.length, typedStreamRef.current.length + 2))
      setTypedStream(typedStreamRef.current)
    }, 28)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (streamLineRef.current) streamLineRef.current.scrollLeft = streamLineRef.current.scrollWidth
  }, [typedStream])

  const contextRatio = Number.isFinite(pressure?.projectedTokens) && Number.isFinite(pressure?.contextWindow)
    ? pressure.projectedTokens / pressure.contextWindow : 0
  const hasImage = hasRecentImage(snapshot)
  const userCorrection = hasRecentCorrection(snapshot)
  const questionCount = reasoningQuestionCount(snapshot)
  const effectiveVisual = deriveVisual(visual, {
    busySessions, contextRatio, hasImage, idleMs, questionCount, taskActive, userCorrection,
  })
  const presentation = useMemo(() => presentationForState(effectiveVisual, phase, {
    busySessions, contextRatio, hasImage, idleMs, questionCount, thinkingMs, userCorrection,
  }), [effectiveVisual.kind, effectiveVisual.detail, phase, busySessions, contextRatio, hasImage, idleMs, questionCount, thinkingMs, userCorrection])

  useEffect(() => {
    setBubbleVisible(true)
    if (taskActive) return () => {}
    const timer = window.setTimeout(() => setBubbleVisible(false), 10_000)
    return () => window.clearTimeout(timer)
  }, [sessionId, taskActive, effectiveVisual.kind, effectiveVisual.label, tapText])

  useEffect(() => {
    setBubblePage(0)
    if (!hasStream) return () => {}
    const timer = window.setInterval(() => setBubblePage(value => value + 1), 4500)
    return () => window.clearInterval(timer)
  }, [hasStream])

  useEffect(() => {
    let prepareTimer
    let swapTimer
    if (presentation.reaction !== activeReaction) {
      const elapsed = Date.now() - reactionChangedAt.current
      const wait = reactionChangedAt.current ? Math.max(0, 4_800 - elapsed) : 0
      prepareTimer = window.setTimeout(() => {
        setReactionPending(true)
        swapTimer = window.setTimeout(() => {
          reactionChangedAt.current = Date.now()
          setActiveReaction(presentation.reaction)
          setReactionPending(false)
        }, 520)
      }, wait)
    }
    return () => { window.clearTimeout(prepareTimer); window.clearTimeout(swapTimer) }
  }, [presentation.reaction, activeReaction])

  const updateLook = useCallback(event => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--look-x', Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1)).toFixed(3))
  }, [])
  const pointerDown = useCallback(event => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const root = event.currentTarget.closest('[data-dsh-live2d-root]')
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: offset, rect: root?.getBoundingClientRect() }
    dragged.current = false
  }, [offset])
  const pointerMove = useCallback(event => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) { updateLook(event); return }
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    if (Math.hypot(dx, dy) > 4) dragged.current = true
    if (dragged.current) setOffset({ x: active.origin.x + dx, y: active.origin.y + dy })
  }, [updateLook])
  const pointerUp = useCallback(event => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    drag.current = null
    if (dragged.current) { try { window.localStorage?.setItem(POSITION_KEY, JSON.stringify(offset)) } catch {} }
  }, [offset])
  const wheelScale = useCallback(event => {
    if (collapsed) return
    event.preventDefault()
    event.stopPropagation()
    setScale(current => {
      const next = clampPetScale(current, event.deltaY)
      try { window.localStorage?.setItem(SCALE_KEY, String(next)) } catch {}
      return next
    })
  }, [collapsed])
  const speak = useCallback((text, detail = '') => {
    window.clearTimeout(speechTimer.current)
    setBubbleVisible(true)
    setTapText(text)
    setTapDetail(detail)
    speechTimer.current = window.setTimeout(() => { setTapText(''); setTapDetail('') }, 3600)
  }, [])
  useEffect(() => () => window.clearTimeout(speechTimer.current), [])

  const tap = useCallback(() => {
    if (dragged.current) { dragged.current = false; return }
    const words = tapTextFor(effectiveVisual.kind)
    speak(words[Math.floor(Math.random() * words.length)], '')
  }, [effectiveVisual.kind, speak])

  const hasConversation = Boolean(snapshot.pending?.length)
  const showStream = Boolean(streamText && !tapText && bubblePage % 2 === 0)
  const activityLabel = rotatingActivityLabel(streamMode, phase, questionCount, thinkingMs)
  const bubbleTitle = tapText || (showStream ? activityLabel : effectiveVisual.label)
  const bubbleDetail = tapDetail || (showStream ? typedStream : effectiveVisual.detail)
  return (
    <aside data-dsh-live2d-root data-collapsed={collapsed ? 'true' : 'false'} data-pet-state={effectiveVisual.kind}
      data-reaction-pending={reactionPending ? 'true' : 'false'} data-tapped={tapText ? 'true' : 'false'}
      style={{ '--pet-drag-x': `${offset.x}px`, '--pet-drag-y': `${offset.y}px`, '--pet-scale': scale }} aria-label="DeepSeek 任务状态助手">
      <section className="dsh-live2d-conversation" data-visible={hasConversation ? 'true' : 'false'} aria-label="当前会话内容">
        {snapshot.pending?.length > 0 && <PendingBubbles waits={snapshot.pending} />}
      </section>
      <div className="dsh-live2d-bubble" data-visible={bubbleVisible || taskActive || tapText ? 'true' : 'false'} data-stream={showStream ? 'true' : 'false'} role="status" aria-live="polite">
        <span>{bubbleTitle}</span><small ref={streamLineRef} title={showStream ? streamTarget : bubbleDetail}>{bubbleDetail}{showStream && <i aria-hidden="true" />}</small>
      </div>
      <div className="dsh-live2d-stage">
        <button className="dsh-live2d-character" type="button" aria-label={collapsed ? '展开 DeepSeek 状态助手' : '拖动或双击收起 DeepSeek 状态助手'}
          onClick={tap} onDoubleClick={() => setCollapsed(value => !value)} onPointerDown={pointerDown}
          onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheelScale}>
          <span className="dsh-live2d-sprites" aria-hidden="true">
            {Object.entries(REACTIONS).map(([name, src]) => <img key={name} src={src} alt="" draggable="false" data-active={name === (collapsed ? 'idle' : activeReaction) ? 'true' : 'false'} />)}
          </span>
        </button>
      </div>
      <nav className="dsh-live2d-tools" aria-label="Pet 快捷操作">
        <button type="button" title="最小化 Pet" aria-label="最小化 Pet" onClick={() => setCollapsed(true)}><b>−</b><span>最小化</span></button>
      </nav>
      <section className="dsh-live2d-sessions" data-visible={focusedSession || runningSessions.length ? 'true' : 'false'} aria-label="活跃会话">
        {focusedSession && <button className="dsh-live2d-session-focus" type="button" data-current="true" onClick={() => openSession?.(focusedSession.id)}>
          <i data-running={focusedSession.running ? 'true' : 'false'} /><span>{focusedSession.displayTitle || focusedSession.title || focusedSession.id}</span><small>聚焦</small>
        </button>}
        <div className="dsh-live2d-session-list" data-visible={runningSessions.length ? 'true' : 'false'}>
          {runningSessions.slice(0, 7).map((item, index) => <button key={item.id} type="button" data-stacked={index >= 3 ? 'true' : 'false'} onClick={() => openSession?.(item.id)}>
            <i data-running={item.running ? 'true' : 'false'} /><span>{item.displayTitle || item.title || item.id}</span><small>{item.pendingInteraction ? '等待操作' : '执行中'}</small>
          </button>)}
          {runningSessions.length > 7 && <footer>还有 {runningSessions.length - 7} 个会话</footer>}
        </div>
      </section>
    </aside>
  )
}

export function deriveVisual(visual, signals) {
  if (signals.hasImage) return { kind: 'vision', label: '图片暂时看不见', detail: 'DeepSeek 当前不支持视觉输入' }
  if (signals.userCorrection) return { kind: 'apology', label: '对不起，我重新检查', detail: '收到你的纠正反馈' }
  if (visual.kind === 'error' || visual.kind === 'tool-error' || visual.kind === 'approval') return visual
  if (signals.busySessions >= 3) return { kind: 'busy', label: '好多会话，忙疯了', detail: `${signals.busySessions} 个任务同时执行` }
  if (signals.contextRatio >= .82) return { kind: 'full', label: '上下文吃饱了', detail: `${Math.round(signals.contextRatio * 100)}% context` }
  if (signals.contextRatio >= .62) return { kind: 'context-snack', label: '还可以再吃一点', detail: `${Math.round(signals.contextRatio * 100)}% context` }
  if (visual.kind === 'thinking' && signals.questionCount >= 4) return { kind: 'confused', label: '疑问有点多，让我理一理', detail: `${signals.questionCount} 个疑问线索` }
  if (!signals.taskActive && signals.idleMs >= ONE_HOUR) return { kind: 'sleeping', label: '已经睡着了', detail: '挂机超过 1 小时' }
  if (!signals.taskActive && signals.idleMs >= THIRTY_MINUTES) return { kind: 'sleepy', label: '抱着枕头犯困', detail: '挂机超过 30 分钟' }
  if (!signals.taskActive && signals.idleMs >= TEN_MINUTES) return { kind: 'hungry', label: '肚子饿了', detail: '挂机超过 10 分钟' }
  if (!signals.taskActive) {
    const greeting = greetingForHour(new Date().getHours())
    if (greeting.kind !== 'idle') return greeting
    return { ...visual, label: greeting.label, detail: greeting.detail }
  }
  return visual
}

export function greetingForHour(hour) {
  if (hour >= 0 && hour < 6) return { kind: 'sleeping', label: '夜深了，已经睡着啦', detail: '记得早点休息' }
  if (hour >= 23) return { kind: 'sleepy', label: '夜深了，好困啊', detail: '记得早点休息' }
  if (hour < 11) return { kind: 'idle', label: '早上好，今天又是新的一天', detail: '一起把今天的任务做好吧' }
  if (hour < 14) return { kind: 'idle', label: '中午好', detail: '别忘了按时吃饭' }
  if (hour < 18) return { kind: 'idle', label: '下午好', detail: '继续加油，也记得活动一下' }
  return { kind: 'idle', label: '晚上好', detail: '今天也辛苦啦' }
}

function PendingBubbles({ waits }) {
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const respond = async (wait, value) => {
    setBusy(true); setError('')
    try {
      const receipt = await wait.respond(value)
      if (!receipt?.accepted) throw new Error(receipt?.reason || '响应未被接受')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) }
  }
  return <div className="dsh-live2d-pending">
    {waits.map(wait => wait.kind === 'approval' ? <article key={wait.key}>
      <strong>{wait.payload?.reason || `允许调用 ${wait.payload?.toolName || '工具'}？`}</strong>
      <small>{wait.payload?.toolName}</small>
      <div><button disabled={busy} onClick={() => respond(wait, { ok: true, value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome: 'rejected' } })}>拒绝</button>
        <button disabled={busy} data-primary onClick={() => respond(wait, { ok: true, value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome: 'allowed-once' } })}>允许一次</button></div>
    </article> : <article key={wait.key}>
      {(wait.payload?.questions ?? []).map(question => <fieldset key={question.id}>
        <legend>{question.question}</legend>{question.detail && <small>{question.detail}</small>}
        <div>{(question.options ?? []).map(option => <button key={option.label} disabled={busy} data-selected={(answers[question.id]?.selected ?? []).includes(option.label)} onClick={() => setAnswers(current => ({ ...current, [question.id]: { selected: question.multiSelect ? toggle(current[question.id]?.selected, option.label) : [option.label] } }))}>{option.label}</button>)}</div>
        <input value={answers[question.id]?.custom ?? ''} placeholder="输入调整或自定义回答" onChange={event => setAnswers(current => ({ ...current, [question.id]: { selected: [], custom: event.target.value } }))} />
      </fieldset>)}
      <div><button disabled={busy} onClick={() => respond(wait, { ok: false, error: { code: 'cancelled', message: 'the user rejected this question request', details: {} } })}>拒绝</button>
        <button disabled={busy} data-primary onClick={() => respond(wait, { ok: true, value: { sessionId: wait.sessionId, answer: { answers: (wait.payload?.questions ?? []).map(question => ({ id: question.id, selected: answers[question.id]?.custom?.trim() ? [] : answers[question.id]?.selected ?? [], ...(answers[question.id]?.custom?.trim() ? { custom: answers[question.id].custom.trim() } : {}) })) } } })}>提交</button></div>
    </article>)}
    {error && <p>{error}</p>}
  </div>
}

function toggle(values = [], value) { return values.includes(value) ? values.filter(item => item !== value) : [...values, value] }
function sharedPrefixLength(left, right) {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}
function latestHumanTurnKey(snapshot) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  const node = [...nodes].reverse().find(item => item?.kind === 'user' || item?.kind === 'steering')
  return node ? `${node.seq ?? ''}:${node.time ?? ''}` : ''
}
function sameVisual(left, right) { return left.kind === right.kind && left.label === right.label && left.detail === right.detail }
function tapTextFor(kind) {
  if (kind === 'sleeping') return ['嘘……睡着啦', '再睡五分钟……']
  if (kind === 'hungry') return ['可以投喂一碗白饭吗？', '肚子咕咕叫了']
  if (kind === 'approval') return ['点一下同意我才能继续～']
  if (kind === 'tool-error' || kind === 'error') return ['我会重新收拾残局的！', '这次真的搞砸了……']
  return ['别戳啦～', '我在看当前会话呢', '可以拖我换个位置']
}
