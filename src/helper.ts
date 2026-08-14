import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import type { ModesState } from './types.js'

export const STATE_KEY = 'modes'

export function createState(): ModesState {
  return { mode: undefined }
}

export function persist(pi: ExtensionAPI, state: ModesState): void {
  pi.appendEntry(STATE_KEY, {
    mode: state.mode,
    planMarkdown: state.planMarkdown,
    toolsBackup: state.toolsBackup,
  })
}

export function getLastModesState(
  entries: readonly SessionEntry[],
): Partial<ModesState> | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry || entry.type !== 'custom' || entry.customType !== STATE_KEY)
      continue
    return entry.data as Partial<ModesState> | undefined
  }
  return undefined
}

/** Restore the tool set captured before entering a read-only mode. */
export function restoreTools(pi: ExtensionAPI, state: ModesState): void {
  if (state.toolsBackup) pi.setActiveTools(state.toolsBackup)
  state.toolsBackup = undefined
}

function isAssistantMessage(
  message: AgentMessage | undefined,
): message is AssistantMessage {
  return message?.role === 'assistant' && Array.isArray(message.content)
}

function isToolResultMessage(
  message: AgentMessage | undefined,
): message is ToolResultMessage {
  return (
    message?.role === 'toolResult' &&
    'content' in message &&
    Array.isArray(message.content)
  )
}

function isToolCall(
  block: TextContent | ThinkingContent | ToolCall,
): block is ToolCall {
  return block.type === 'toolCall'
}

function findToolCall(
  toolCallId: string,
  messages: readonly AgentMessage[],
): ToolCall | undefined {
  for (const message of messages) {
    if (isAssistantMessage(message)) {
      for (const block of message.content) {
        if (isToolCall(block) && block.id === toolCallId) {
          return block
        }
      }
    }
  }
  return undefined
}

export function formatToolNameWithArgs(
  message: ToolResultMessage,
  messages: readonly AgentMessage[],
): string {
  const toolCall = findToolCall(message.toolCallId, messages)
  if (toolCall && Object.keys(toolCall.arguments).length > 0) {
    return `${message.toolName}(${JSON.stringify(toolCall.arguments)})`
  }
  return message.toolName
}

/** Concatenate all text blocks of an assistant or toolResult message. */
export function messageText(message: AgentMessage | undefined): string {
  if (!message) return ''
  if (isAssistantMessage(message) || isToolResultMessage(message)) {
    const text = message.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
    return text
  }
  return ''
}

export function lastAssistantText(
  messages: readonly AgentMessage[],
  maxBytes?: number,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (isAssistantMessage(message)) {
      const text = messageText(message)
      if (!text) continue
      const result =
        maxBytes !== undefined ? truncateToBytes(text, maxBytes) : text
      return result || undefined
    }
  }
  return undefined
}

export function lastMessageText(
  messages: readonly AgentMessage[],
  maxBytes?: number,
): string | undefined {
  if (messages.length === 0) return undefined

  const lastMessage = messages[messages.length - 1]

  if (isAssistantMessage(lastMessage)) {
    const text = messageText(lastMessage)
    if (!text) return undefined
    return maxBytes !== undefined ? truncateToBytes(text, maxBytes) : text
  }

  if (isToolResultMessage(lastMessage)) {
    const text = messageText(lastMessage)
    if (!text) return undefined
    const name = formatToolNameWithArgs(lastMessage, messages)
    const composed = `${name}\n${text}`
    return maxBytes !== undefined
      ? truncateToBytes(composed, maxBytes)
      : composed
  }

  return undefined
}

export function strInline(s: string) {
  return s.split('\n').join('⮒ ')
}

/** Place `right` flush to `width`, truncating `left` first so the stats survive. */
export function rightAlign(left: string, right: string, width: number): string {
  const rightW = visibleWidth(right)
  const maxLeft = Math.max(0, width - rightW - 1)
  const leftClamped = truncateToWidth(left, maxLeft)
  const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW)
  return truncateToWidth(leftClamped + ' '.repeat(gap) + right, width)
}

export function formatElapsed(item: {
  startedAt: number
  completedAt?: number
}): string {
  const end = item.completedAt ?? Date.now()
  const seconds = Math.max(0, Math.floor((end - item.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`
}

export function truncateToBytes(
  text: string,
  maxBytes: number,
  suffix = '\n\n[Output truncated. Verify remaining details with read-only tools.]',
): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const budget = Math.max(0, maxBytes - suffixBytes)
  const head = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8')
  return `${head}${suffix}`
}
