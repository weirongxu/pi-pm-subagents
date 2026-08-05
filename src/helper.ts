import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, TextContent } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'

import type { ModeType } from './types.js'

/** Built-in tools that mutate the filesystem — disabled in read-only modes. */
export const WRITE_TOOLS = new Set(['edit', 'write'])

export const MANAGER_TOOLS = {
  delegate: 'worker_delegate',
  list: 'worker_list',
}

/** Key under which the modes' state is persisted in the session. */
export const STATE_KEY = 'modes'

export interface ModesState {
  mode: ModeType | undefined
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

const FORWARD_PREFIX = ['rtk'] as const

const DESTRUCTIVE_BASH_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\b(npm|yarn|pnpm|bun)\s+(install|uninstall|add|remove|update|ci|link|publish)\b/i,
  /\bpip\s+(install|uninstall)\b/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
  /\bbrew\s+(install|uninstall|upgrade)\b/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)\b/i,
  /\bsudo\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
] as const

const READONLY_BASH_PATTERNS = [
  /^\s*(cat|head|tail|less|more|grep|find|ls|pwd|echo|printf|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|uptime|ps|free)\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|ls-)/i,
  /^\s*(npm|yarn|pnpm)\s+(list|ls|view|info|outdated|audit)\b/i,
  /^\s*(node|python|python3)\s+--version/i,
  /^\s*curl\s/,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
] as const

export function isReadOnlyBashCommand(command: string): boolean {
  // Handle export VAR=VALUE; command format - strip the export part
  const exportMatch = command.match(/^\s*export\s+[^;]+;\s*/i)
  if (exportMatch) {
    command = command.slice(exportMatch[0].length).trim()
  }

  // Remove allowed forward prefix if present
  for (const prefix of FORWARD_PREFIX) {
    const pattern = new RegExp(`^\\s*${prefix}\\s+`, 'i')
    const match = command.match(pattern)
    if (match) {
      command = command.slice(match[0].length).trim()
      break
    }
  }

  const destructive = DESTRUCTIVE_BASH_PATTERNS.some((p) => p.test(command))
  const readonly = READONLY_BASH_PATTERNS.some((p) => p.test(command))
  return !destructive && readonly
}

export function strInline(s: string) {
  return s.split('\n').join('⮒ ')
}
