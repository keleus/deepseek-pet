export const PET_STATES = Object.freeze([
  'idle',
  'listening',
  'waiting',
  'thinking',
  'working',
  'speaking',
  'success',
  'confused',
  'error',
  'vision',
  'full',
  'hungry',
  'sleepy',
  'sleeping',
  'apology',
  'approval',
  'tool-error',
])

const TOOL_LABELS = Object.freeze({
  bash: '正在敲终端',
  exec_command: '正在敲终端',
  read: '正在读文件',
  write: '正在写代码',
  edit: '正在修改代码',
  apply_patch: '正在修改代码',
  web_search: '正在查找资料',
  web_fetch: '正在阅读网页',
  run_code: '正在运行工具',
})

/**
 * Derive the pet's immediate state from the Harness Web conversation snapshot.
 * @param {Record<string, any> | null | undefined} snapshot
 */
export function stateFromSnapshot(snapshot) {
  if (!snapshot) return state('idle', '等待选择任务', '暂无活动任务')
  if (snapshot.openState === 'loading' || snapshot.openState === 'cold') {
    return state('thinking', '正在载入任务', '同步会话状态…')
  }
  if (snapshot.openState === 'error' || snapshot.openError || snapshot.promptError || snapshot.lastAgentError) {
    return state('error', '任务遇到错误', errorMessage(snapshot))
  }

  const failedTool = recentToolFailure(snapshot)
  if (failedTool) return state('tool-error', '工具调用搞砸了', failedTool)

  const pending = Array.isArray(snapshot.pending) ? snapshot.pending : []
  if (pending.length > 0) {
    const kind = pending[0]?.kind
    if (kind === 'approval') return state('waiting', '等你确认工具调用', '请在任务中确认，我会在这里等你')
    return state('waiting', '等待你的回答', kind === 'question' ? '请在任务中回答问题' : '请在任务中完成交互')
  }

  if (hasRecentImage(snapshot)) {
    return state('vision', '图片暂时看不见', 'DeepSeek 当前不支持视觉输入')
  }

  const calls = Array.isArray(snapshot.runningCalls) ? snapshot.runningCalls : []
  if (calls.length > 0) {
    const name = String(calls.at(-1)?.name ?? '')
    return state('working', TOOL_LABELS[name] ?? `正在使用 ${friendlyToolName(name)}`, name || 'tool')
  }

  const blocks = Array.isArray(snapshot.partial?.blocks) ? snapshot.partial.blocks : []
  if (blocks.some(block => block?.kind === 'text' && block.text)) {
    return state('speaking', '正在组织回答', '答案正在生成…')
  }
  if (blocks.some(block => block?.kind === 'reasoning' && block.text)) {
    return state('thinking', '正在深入思考', '推理进行中…')
  }
  if (snapshot.running) return state('thinking', '正在分析任务', 'DeepSeek 工作中')

  const queue = Array.isArray(snapshot.queue) ? snapshot.queue : []
  if (queue.length > 0) return state('listening', `队列中还有 ${queue.length} 项`, '稍后继续处理')
  return state('idle', '任务已就绪', '随时可以继续')
}

/** Latest human input contains an image attachment. */
export function hasRecentImage(snapshot) {
  const queued = Array.isArray(snapshot?.queue) ? snapshot.queue : []
  if (queued.some(item => contentHasImage(item?.content))) return true
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind === 'assistant') return false
    if (node?.kind === 'user' || node?.kind === 'steering') return contentHasImage(node.content)
  }
  return false
}

/** Latest human turn explicitly corrects the assistant. */
export function hasRecentCorrection(snapshot) {
  const text = latestHumanText(snapshot)
  if (!text) return false
  return /(?:你|这个|刚才|结果|回答|代码).{0,12}(?:做错|写错|弄错|搞错|错了|不对|有问题)|(?:做错了|又错了|不是这样|重新做|重来)|\b(?:you(?:'re| are)? wrong|wrong answer|incorrect|not right|redo it)\b/iu.test(text)
}

/** Number of question/uncertainty cues in the current reasoning stream. */
export function reasoningQuestionCount(snapshot) {
  const reasoning = streamFromSnapshot(snapshot).reasoning
  if (!reasoning) return 0
  const punctuation = reasoning.match(/[?？]/gu)?.length ?? 0
  const cues = reasoning.match(/(?:为什么|怎么(?:办|回事|处理)?|是否|哪里|什么情况|不确定|疑问|奇怪|why|how|whether|unclear)/giu)?.length ?? 0
  return punctuation + cues
}

/** Current stream copy for the companion's scrolling transcript. */
export function streamFromSnapshot(snapshot) {
  const blocks = Array.isArray(snapshot?.partial?.blocks) ? snapshot.partial.blocks : []
  const reasoning = blocks.filter(block => block?.kind === 'reasoning').map(block => block.text).join('\n').trim()
  const reply = blocks.filter(block => block?.kind === 'text').map(block => block.text).join('\n').trim()
  return { reasoning, reply }
}

function contentHasImage(content) {
  return Array.isArray(content) && content.some(block => block?.type === 'image' || block?.kind === 'image')
}

function latestHumanText(snapshot) {
  const queued = Array.isArray(snapshot?.queue) ? snapshot.queue : []
  const queuedText = queued.at(-1)?.text
  if (typeof queuedText === 'string' && queuedText.trim()) return queuedText
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node?.kind === 'assistant') return ''
    if (node?.kind === 'user' || node?.kind === 'steering') {
      return Array.isArray(node.content)
        ? node.content.filter(block => block?.type === 'text').map(block => block.text).join('\n')
        : ''
    }
  }
  return ''
}

function recentToolFailure(snapshot) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  for (let index = nodes.length - 1; index >= Math.max(0, nodes.length - 4); index -= 1) {
    const node = nodes[index]
    if (node?.kind === 'assistant' || node?.kind === 'user' || node?.kind === 'steering') break
    if (node?.kind === 'tool-result' && node.isError) return node.call?.name || node.error?.name || 'tool'
    if (node?.kind === 'command' && node.outcome?.kind === 'error') return node.name || 'command'
  }
  return ''
}

/** A successful running→idle edge is shown temporarily as completion. */
export function completionState() {
  return state('success', '任务完成', '完成啦！')
}

function state(kind, label, detail) {
  return { kind, label, detail }
}

function friendlyToolName(name) {
  return name ? name.replaceAll('_', ' ').replaceAll('-', ' ') : '工具'
}

function errorMessage(snapshot) {
  if (typeof snapshot.lastAgentError === 'string' && snapshot.lastAgentError) return snapshot.lastAgentError
  const prompt = snapshot.promptError?.error
  if (typeof prompt?.message === 'string' && prompt.message) return prompt.message
  if (typeof snapshot.openError?.message === 'string' && snapshot.openError.message) return snapshot.openError.message
  return '运行没有顺利完成'
}
