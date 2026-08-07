import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, TextContent } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import type { ModeUserType } from './types.js'

/** Built-in tools that mutate the filesystem — disabled in read-only modes. */
export const WRITE_TOOLS = new Set(['edit', 'write'])

export const MANAGER_TOOLS = {
  delegate: 'worker_delegate',
  kill: 'worker_kill',
  list: 'worker_list',
}

/** Key under which the modes' state is persisted in the session. */
export const STATE_KEY = 'modes'

export interface ModesState {
  mode: ModeUserType | undefined
  planMarkdown?: string
  /** Active tools captured before entering a read-only mode, restored on exit. */
  toolsBackup?: string[]
  /** Main-session model ref captured before switching to a role model, restored on exit. */
  modelBackup?: string
}

export function createState(): ModesState {
  return { mode: undefined }
}

export function persist(pi: ExtensionAPI, state: ModesState): void {
  pi.appendEntry(STATE_KEY, {
    mode: state.mode,
    planMarkdown: state.planMarkdown,
    toolsBackup: state.toolsBackup,
    modelBackup: state.modelBackup,
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
  message: AgentMessage,
): message is AssistantMessage {
  return message.role === 'assistant' && Array.isArray(message.content)
}

/** Concatenate all text blocks of an assistant message. */
export function messageText(message: AgentMessage | undefined): string {
  if (!message || !isAssistantMessage(message)) return ''
  return message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** Last non-empty assistant text across the whole conversation. */
export function lastAssistantText(
  messages: readonly AgentMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i])
    if (text) return text
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
