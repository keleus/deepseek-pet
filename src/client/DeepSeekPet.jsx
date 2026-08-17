import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { REACTIONS, REACTION_FRAMES } from './assets.generated.js'
import { clampPetScale, latestOutput, presentationForState, rotatingActivityLabel } from './pet-presentation.js'
import {
  getDisplayModeSnapshot, subscribeDisplayMode,
} from './pet-display.js'
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
const LAST_ACTIVITY_KEY = 'deepseek-pet:last-activity'
const TEN_MINUTES = 10 * 60_000
const THIRTY_MINUTES = 30 * 60_000
const ONE_HOUR = 60 * 60_000
const FRAME_FOR_REACTION = Object.freeze({
  idle: 'idle-blink',
  'desk-coding': 'desk-coding-hands-up',
  thinking: 'thinking-keypress',
})

/** uSES subscription used when the module runs outside a browser (SSR/tests). */
const NOOP_SUBSCRIBE = () => () => {}

/**
 * Read the shared display-mode store (see pet-display.js). Kept here so the
 * pet surface and the settings page share one subscription shape; the
 * `displayMode` prop may override the store (used by the slot entry to pin
 * the placement the entry already read).
 */
export function useDisplayMode() {
  return useSyncExternalStore(
    typeof window !== 'undefined' ? subscribeDisplayMode : NOOP_SUBSCRIBE,
    getDisplayModeSnapshot,
    getDisplayModeSnapshot,
  )
}

/**
 * Slot entry for the shell overlay: reads the shared display mode and hands
 * it to the pet surface. The page-top placement portals to `document.body`
 * with fixed viewport positioning, so no new window or tab is ever opened
 * (works identically in all browsers).
 */
export function DeepSeekPetEntry(props) {
  const displayMode = useDisplayMode()
  return <DeepSeekPet {...props} displayMode={displayMode} />
}

export function DeepSeekPet({ useSessions, resolveSession, openSession, displayMode }) {
  const storedMode = useDisplayMode()
  const mode = displayMode ?? storedMode
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
  const taskActive = Boolean(snapshot.running || snapshot.runningCalls?.length || snapshot.partial || snapshot.pending?.length || snapshot.queue?.length)
  const contextRatio = Number.isFinite(pressure?.projectedTokens) && Number.isFinite(pressure?.contextWindow)
    ? pressure.projectedTokens / pressure.contextWindow : 0
  const hasImage = hasRecentImage(snapshot)
  const userCorrection = hasRecentCorrection(snapshot)
  const questionCount = reasoningQuestionCount(snapshot)
  const initialIdleMsRef = useRef(null)
  if (initialIdleMsRef.current === null) initialIdleMsRef.current = taskActive ? 0 : inactiveDuration()
  const initialEffective = deriveVisual(immediate, {
    busySessions, contextRatio, hasImage, idleMs: initialIdleMsRef.current,
    questionCount, taskActive, userCorrection, waitingMs: 0,
  })
  const [visual, setVisual] = useState(immediate)
  const [collapsed, setCollapsed] = useState(false)
  const [phase, setPhase] = useState(0)
  const [thinkingMs, setThinkingMs] = useState(0)
  const [visualMs, setVisualMs] = useState(0)
  const [waitingMs, setWaitingMs] = useState(0)
  const [idleMs, setIdleMs] = useState(initialIdleMsRef.current)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [tapText, setTapText] = useState('')
  const [tapDetail, setTapDetail] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(true)
  const [bubblePage, setBubblePage] = useState(0)
  const [activeReaction, setActiveReaction] = useState(() => presentationForState(initialEffective, 0, {
    idleMs: initialIdleMsRef.current, visualMs: 0, waitingMs: 0,
  }).reaction)
  const [activeFrame, setActiveFrame] = useState('')
  const [reactionPending, setReactionPending] = useState(false)
  const wasRunning = useRef(false)
  const wasTaskActive = useRef(taskActive)
  const idleStarted = useRef(Date.now() - initialIdleMsRef.current)
  const waitingStarted = useRef(0)
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
      if (immediate.kind !== 'idle') commit(immediate)
      else {
        commit(completionState())
        completionTimer = window.setTimeout(() => commit(immediate), 8000)
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
    const started = Date.now()
    setVisualMs(0)
    const interval = window.setInterval(() => setVisualMs(Date.now() - started), 250)
    return () => window.clearInterval(interval)
  }, [visual.kind, visual.detail])

  useEffect(() => {
    if (visual.kind !== 'thinking') { setThinkingMs(0); return () => {} }
    const started = Date.now()
    const interval = window.setInterval(() => setThinkingMs(Date.now() - started), 1000)
    return () => window.clearInterval(interval)
  }, [visual.kind])

  const waiting = Boolean(snapshot.pending?.length)
  useEffect(() => {
    if (!waiting) { waitingStarted.current = 0; setWaitingMs(0); return () => {} }
    waitingStarted.current = Date.now()
    const update = () => setWaitingMs(Date.now() - waitingStarted.current)
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [waiting, sessionId])

  const latestHuman = latestHumanTurnKey(snapshot)
  useEffect(() => {
    if (latestHuman && latestHuman !== humanTurnKey.current) {
      humanTurnKey.current = latestHuman
      idleStarted.current = Date.now()
      setIdleMs(0)
      rememberActivity()
    }
  }, [latestHuman])

  useEffect(() => {
    if (taskActive || wasTaskActive.current) {
      idleStarted.current = Date.now()
      setIdleMs(0)
      rememberActivity()
    }
    wasTaskActive.current = taskActive
    if (taskActive) {
      const interval = window.setInterval(rememberActivity, 30_000)
      return () => window.clearInterval(interval)
    }
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

  const effectiveVisual = deriveVisual(visual, {
    busySessions, contextRatio, hasImage, idleMs, questionCount, taskActive, userCorrection, waitingMs,
  })
  const presentation = useMemo(() => presentationForState(effectiveVisual, phase, {
    busySessions, contextRatio, hasImage, idleMs, questionCount, thinkingMs, userCorrection, visualMs, waitingMs,
  }), [effectiveVisual.kind, effectiveVisual.detail, phase, busySessions, contextRatio, hasImage, idleMs, questionCount, thinkingMs, userCorrection, visualMs, waitingMs])

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
      const urgent = effectiveVisual.kind === 'success' || effectiveVisual.kind === 'tool-error'
      const wait = urgent || !reactionChangedAt.current ? 0 : Math.max(0, 4_800 - elapsed)
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
  }, [presentation.reaction, activeReaction, effectiveVisual.kind])

  useEffect(() => {
    setActiveFrame('')
    const frame = FRAME_FOR_REACTION[activeReaction]
    if (!frame || collapsed || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {}

    if (activeReaction === 'idle') {
      let stopped = false
      let showTimer
      let hideTimer
      const scheduleBlink = () => {
        showTimer = window.setTimeout(() => {
          if (stopped) return
          setActiveFrame(frame)
          hideTimer = window.setTimeout(() => {
            setActiveFrame('')
            if (!stopped) scheduleBlink()
          }, 170)
        }, 4200)
      }
      scheduleBlink()
      return () => {
        stopped = true
        window.clearTimeout(showTimer)
        window.clearTimeout(hideTimer)
      }
    }

    const intervalMs = activeReaction === 'desk-coding' ? 520 : 1400
    const interval = window.setInterval(() => {
      setActiveFrame(current => current === frame ? '' : frame)
    }, intervalMs)
    return () => window.clearInterval(interval)
  }, [activeReaction, collapsed])

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

  const showStream = Boolean(streamText && !tapText && bubblePage % 2 === 0)
  const activityLabel = rotatingActivityLabel(streamMode, phase, questionCount, thinkingMs)
  const bubbleTitle = tapText || (showStream ? activityLabel : effectiveVisual.label)
  const bubbleDetail = tapDetail || (showStream ? typedStream : effectiveVisual.detail)
  const visibleFrame = !collapsed && FRAME_FOR_REACTION[activeReaction] === activeFrame ? activeFrame : ''
  const petSurface = (
    <aside data-dsh-live2d-root data-collapsed={collapsed ? 'true' : 'false'} data-pet-state={effectiveVisual.kind}
      data-display-mode={mode}
      data-reaction-pending={reactionPending ? 'true' : 'false'} data-tapped={tapText ? 'true' : 'false'}
      style={{ '--pet-drag-x': `${offset.x}px`, '--pet-drag-y': `${offset.y}px`, '--pet-scale': scale }} aria-label="DeepSeek 任务状态助手">
      <div className="dsh-live2d-bubble" data-visible={bubbleVisible || taskActive || tapText ? 'true' : 'false'} data-stream={showStream ? 'true' : 'false'} role="status" aria-live="polite">
        <span>{bubbleTitle}</span><small ref={streamLineRef} title={showStream ? streamTarget : bubbleDetail}>{bubbleDetail}{showStream && <i aria-hidden="true" />}</small>
      </div>
      <div className="dsh-live2d-stage">
        <button className="dsh-live2d-character" type="button" aria-label={collapsed ? '双击展开 DeepSeek 状态助手' : '拖动 DeepSeek 状态助手'}
          onClick={tap} onDoubleClick={() => { if (collapsed) setCollapsed(false) }} onPointerDown={pointerDown}
          onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheelScale}>
          <span className="dsh-live2d-sprites" aria-hidden="true">
            {Object.entries(REACTIONS).map(([name, src]) => <img key={name} src={src} alt="" draggable="false" data-active={name === (collapsed ? 'idle' : activeReaction) ? 'true' : 'false'} />)}
            {Object.entries(REACTION_FRAMES).map(([name, src]) => <img key={name} src={src} alt="" draggable="false" data-frame="true" data-active={name === visibleFrame ? 'true' : 'false'} />)}
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
  // Page-top placement portals to <body> so the pet escapes the shell overlay
  // layer's stacking context and sits above every page element. It is a pure
  // in-page placement: no window or tab is ever opened.
  if (mode === 'page-top' && typeof document !== 'undefined') {
    return createPortal(petSurface, document.body)
  }
  return petSurface
}

export function deriveVisual(visual, signals) {
  if (visual.kind === 'waiting' || visual.kind === 'approval') {
    const waitingMs = signals.waitingMs ?? 0
    if (waitingMs >= 4 * 60_000) return { kind: 'waiting', label: '等着等着犯困了', detail: '请在任务中回答，我还在等你' }
    if (waitingMs >= 2 * 60_000) return { kind: 'waiting', label: '等得有点生气了', detail: '任务里的问题还没有回答' }
    if (waitingMs >= 45_000) return { kind: 'waiting', label: '还在等你呢', detail: '请回到任务中完成回答' }
    return { kind: 'waiting', label: visual.label, detail: visual.detail }
  }
  if (visual.kind === 'error' || visual.kind === 'tool-error' || visual.kind === 'success') return visual
  if (signals.hasImage) return { kind: 'vision', label: '图片暂时看不见', detail: 'DeepSeek 当前不支持视觉输入' }
  if (signals.userCorrection) return { kind: 'apology', label: '对不起，我重新检查', detail: '收到你的纠正反馈' }
  if (signals.busySessions >= 3) return { kind: 'busy', label: '好多会话，忙疯了', detail: `${signals.busySessions} 个任务同时执行` }
  if (signals.contextRatio >= .82) return { kind: 'full', label: '上下文吃饱了', detail: `${Math.round(signals.contextRatio * 100)}% context` }
  if (signals.contextRatio >= .62) return { kind: 'context-snack', label: '还可以再吃一点', detail: `${Math.round(signals.contextRatio * 100)}% context` }
  if (visual.kind === 'thinking' && signals.questionCount >= 4) return { kind: 'confused', label: '疑问有点多，让我理一理', detail: `${signals.questionCount} 个疑问线索` }
  if (!signals.taskActive) {
    const greeting = greetingForHour(new Date().getHours())
    if (greeting.kind !== 'idle') return greeting
    if (signals.idleMs >= ONE_HOUR) return { kind: 'sleeping', label: '已经睡着了', detail: '挂机超过 1 小时' }
    if (signals.idleMs >= THIRTY_MINUTES) return { kind: 'sleepy', label: '抱着枕头犯困', detail: '挂机超过 30 分钟' }
    if (signals.idleMs >= TEN_MINUTES) return { kind: 'hungry', label: '肚子饿了', detail: '挂机超过 10 分钟' }
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
  if (kind === 'waiting') return ['我会在这里等你', '请在任务里回答问题哦']
  if (kind === 'approval') return ['点一下同意我才能继续～']
  if (kind === 'tool-error' || kind === 'error') return ['我会重新收拾残局的！', '这次真的搞砸了……']
  return ['别戳啦～', '我在看当前会话呢', '可以拖我换个位置']
}

function inactiveDuration(now = Date.now()) {
  try {
    const stored = Number(window.localStorage?.getItem(LAST_ACTIVITY_KEY))
    if (Number.isFinite(stored) && stored > 0) return Math.max(0, now - stored)
    window.localStorage?.setItem(LAST_ACTIVITY_KEY, String(now))
  } catch {}
  return 0
}

function rememberActivity(now = Date.now()) {
  try { window.localStorage?.setItem(LAST_ACTIVITY_KEY, String(now)) } catch {}
}
