/**
 * Session bridge — adapts the current DeepSeek Harness client surfaces onto the
 * single snapshot the pet's state layer consumes.
 *
 * The Harness client used to deliver the whole conversation through the session
 * snapshot (`nodes`, `partial`, `runningCalls`, `queue`, `pending`). It no
 * longer does:
 *
 *  - `sessions.binding(id).session.getSnapshot()` carries lifecycle/control
 *    facts only (`openState`, `running`, `promptError`, `lastAgentError`,
 *    `pendingSubmissions`, …);
 *  - user messages, assistant output and in-flight tool calls are assembled by
 *    the Conversation `chat` target
 *    (`uiConversation.binding(id).target('chat')` → `snapshot.legacy`);
 *  - approval/question waits moved to the `uiSession.sessionStatus` map
 *    (`pendingInteraction`);
 *  - the session list lost its `current` field; the focused session is the
 *    row the main view retains (`retainedBy.mainView > 0`), which is also how
 *    the Harness's own `dsh-client-ui-cordis` resolves it;
 *  - opening a session is `uiWorkspace.openSession(id)`.
 *
 * This module re-joins those sources into one observable so the pet keeps one
 * state machine and one render path.
 */

/** Conversation target that owns the chat transcript. */
const CHAT_TARGET = 'chat'

/** Stable empty observable used when an optional service is unavailable. */
function emptyObservable(value) {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

const EMPTY_STATUS = new Map()

/** Bind an observable's methods so it can be passed around unbound. */
function bindObservable(source, fallback) {
  if (source !== null && typeof source === 'object'
    && typeof source.getSnapshot === 'function' && typeof source.subscribe === 'function') {
    return {
      getSnapshot: () => source.getSnapshot(),
      subscribe: listener => source.subscribe(listener),
    }
  }
  return fallback
}

/**
 * Resolve one optional client service without making it a hard dependency of
 * the plugin entry (`ctx.get` is the documented optional-dependency lookup).
 * @param ctx - plugin context.
 * @param name - service name.
 */
function optionalService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Focused session id: the row the main view currently retains.
 * @param list - `sessions.list` snapshot (`{ids, byId, phase, …}`).
 * @returns the session id, or undefined while no session is focused.
 */
export function currentSessionId(list) {
  const byId = list?.byId
  if (byId === undefined || byId === null) return undefined
  const isFocused = id => (byId[id]?.retainedBy?.mainView ?? 0) > 0
  const ids = Array.isArray(list.ids) ? list.ids : []
  for (const id of ids) {
    if (isFocused(id)) return id
  }
  for (const id of Object.keys(byId)) {
    if (isFocused(id)) return id
  }
  return undefined
}

/**
 * Display label for one session list row.
 * @param item - `sessions.list.byId` row.
 */
export function sessionLabel(item) {
  return item?.displayTitle || item?.title || item?.id || ''
}

/**
 * Running/pending facts for one session, normalized against the list row so a
 * missing `uiSession` service degrades to the catalog's own `running` bit.
 * @param statuses - `uiSession.sessionStatus` snapshot map.
 * @param item - `sessions.list.byId` row.
 */
export function sessionStatusOf(statuses, item) {
  const status = statuses?.get?.(item?.id)
  return {
    running: status?.running ?? item?.running ?? false,
    pendingInteraction: status?.pendingInteraction,
  }
}

/**
 * Local prompt echoes that have not landed as durable events yet, in the shape
 * the pet's state layer reads (`{text, content}`).
 * @param lifecycle - session snapshot.
 */
export function pendingSubmissionQueue(lifecycle) {
  const submissions = Array.isArray(lifecycle?.pendingSubmissions) ? lifecycle.pendingSubmissions : []
  return submissions
    .filter(item => item?.placement !== 'transcript')
    .map(item => ({
      text: typeof item?.text === 'string' ? item.text : '',
      content: Array.isArray(item?.attachments)
        ? item.attachments.map(attachment => ({ type: attachment?.type }))
        : [],
    }))
}

/**
 * Join the three client sources into the pet's snapshot.
 * @param base - session snapshot (lifecycle/control facts).
 * @param legacy - conversation `chat` target `snapshot.legacy`
 *   (`{nodes, partial, runningCalls, …}`).
 * @param status - `uiSession.sessionStatus` entry for this session.
 */
export function mergePetSnapshot(base, legacy, status) {
  const lifecycle = base ?? {}
  const conversation = legacy ?? {}
  const interaction = status?.pendingInteraction
  return {
    ...lifecycle,
    running: status?.running ?? lifecycle.running ?? false,
    pendingInteraction: interaction ?? null,
    pending: interaction === undefined || interaction === null ? [] : [interaction],
    nodes: Array.isArray(conversation.nodes) ? conversation.nodes : [],
    partial: conversation.partial ?? null,
    runningCalls: Array.isArray(conversation.runningCalls) ? conversation.runningCalls : [],
    queue: pendingSubmissionQueue(lifecycle),
  }
}

/** Resolve the conversation `chat` target source, or undefined while it cannot be bound. */
function chatSource(ctx, sessionId) {
  const conversation = optionalService(ctx, 'uiConversation')
  if (conversation === undefined || typeof conversation.binding !== 'function') return undefined
  try {
    const target = conversation.binding(sessionId).target(CHAT_TARGET)
    return typeof target?.getSnapshot === 'function' && typeof target.subscribe === 'function'
      ? target
      : undefined
  } catch {
    // Unknown / not-yet-retained session: the pet simply has no transcript yet.
    return undefined
  }
}

/**
 * One session's observable view for the pet.
 * @param session - client `Session` object (`getSnapshot`/`subscribe`/`projections`).
 * @param sessionId - its identity.
 * @param chat - conversation `chat` target source, when available.
 * @param statuses - `uiSession.sessionStatus` observable.
 */
export function createSessionView({ session, sessionId, chat, statuses }) {
  let merged
  let primed = false
  let lastBase
  let lastLegacy
  let lastStatus
  // `useSyncExternalStore` requires a stable reference while nothing changed, so
  // the merge is memoized on the identity of its three inputs.
  const getSnapshot = () => {
    const base = session.getSnapshot()
    const legacy = chat?.getSnapshot()?.legacy
    const status = statuses?.getSnapshot?.()?.get(sessionId)
    if (primed && base === lastBase && legacy === lastLegacy && status === lastStatus) return merged
    primed = true
    lastBase = base
    lastLegacy = legacy
    lastStatus = status
    merged = mergePetSnapshot(base, legacy, status)
    return merged
  }
  const subscribe = listener => {
    const stops = [session.subscribe(listener)]
    if (typeof statuses?.subscribe === 'function') stops.push(statuses.subscribe(listener))
    if (typeof chat?.subscribe === 'function') stops.push(chat.subscribe(listener))
    return () => {
      for (const stop of stops) {
        try {
          stop()
        } catch {}
      }
    }
  }
  return {
    getSnapshot,
    subscribe,
    projections: { faceOf: key => session.projections?.faceOf?.(key) },
  }
}

/**
 * Build the plugin-scoped bridge handed to the pet surface.
 *
 * Views are cached per session id and rebuilt whenever the controller mints a
 * new binding generation for that session (reconnect, HMR, re-open) — the same
 * lifetime rule the in-tree `chatSource` uses for its Conversation target.
 * @param ctx - plugin context.
 */
export function createSessionBridge(ctx) {
  const views = new Map()
  const statuses = bindObservable(optionalService(ctx, 'uiSession')?.sessionStatus, emptyObservable(EMPTY_STATUS))

  const view = sessionId => {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const sessions = optionalService(ctx, 'sessions')
    const binding = sessions?.binding?.(sessionId)
    const session = binding?.session
    if (session === undefined || session === null) return undefined
    const cached = views.get(sessionId)
    if (cached !== undefined && cached.binding === binding) return cached.view
    const next = createSessionView({
      session,
      sessionId,
      chat: chatSource(ctx, sessionId),
      statuses,
    })
    views.set(sessionId, { binding, view: next })
    return next
  }

  /** Reveal one session in the main view. */
  const open = sessionId => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    optionalService(ctx, 'uiWorkspace')?.openSession?.(sessionId)
  }

  return { view, open, statuses }
}
