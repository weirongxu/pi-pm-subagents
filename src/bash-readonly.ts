import {
  type BashOperations,
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { parse as parseShell } from 'shell-quote'

import { registerOptionalTools } from './pi-utils.js'

export type BashSafetyIssue =
  { allowed: true } | { allowed: false; subCommand: string }

const FORWARD_PREFIX = ['rtk'] as const

const DESTRUCTIVE_BASH_PATTERNS = [
  /^\s*(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|tee|truncate|dd|shred)\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /^\s*(npm|yarn|pnpm|bun)\s+(install|uninstall|add|remove|update|ci|link|publish)\b/i,
  /^\s*pip\s+(install|uninstall)\b/i,
  /^\s*apt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
  /^\s*brew\s+(install|uninstall|upgrade)\b/i,
  /^\s*git\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)\b/i,
  /^\s*sudo\b/i,
  /^\s*(kill|pkill|killall|reboot|shutdown)\b/i,
  /^\s*(vim?|nano|emacs|code|subl)\b/i,
] as const

const BASH_READONLY_PATTERNS = [
  /^\s*(cat|head|tail|less|more|grep|find|ls|cd|pwd|echo|printf|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|uptime|ps|free)\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|ls-)/i,
  /^\s*(npm|yarn|pnpm)\s+(list|ls|view|info|outdated|audit)\b/i,
  /^\s*(npm|yarn|pnpm)\s+(run\s+)?(test|test:.*)\b/i,
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

const HARMLESS_SUB_COMMAND = /^\s*export\s+[\w]+\s*=\s*\S+\s*$/

const SUB_COMMAND_OPS = new Set(['|', '||', '|&', '&&', ';'])

const isFd = (token: unknown, n: number): token is string => token === `${n}`

const REDIRECT_OPS = new Set(['>', '>>', '<', '<>', '>&', '<&', '>|', '&>>'])

type SubCommand = { tokens: string[]; hasStdoutRedirect: boolean }

function splitShellSubCommands(command: string): SubCommand[] {
  let parsed: ReturnType<typeof parseShell>
  try {
    parsed = parseShell(command)
  } catch {
    return []
  }

  const subCommands: SubCommand[] = []
  let current: string[] = []
  let hasStdoutRedirect = false

  for (let i = 0; i < parsed.length; i++) {
    const token = parsed[i]
    const nextToken = parsed[i + 1]
    const prevToken = i > 0 ? parsed[i - 1] : null

    if (typeof token === 'object' && 'op' in token) {
      const op = token.op as string
      if (SUB_COMMAND_OPS.has(op)) {
        subCommands.push({ tokens: current, hasStdoutRedirect })
        current = []
        hasStdoutRedirect = false
      } else if (op === '>&' && isFd(prevToken, 2) && isFd(nextToken, 1)) {
        const tokenAfterNext = parsed[i + 2]
        const hasPipeAfter =
          typeof tokenAfterNext === 'object' &&
          'op' in tokenAfterNext &&
          tokenAfterNext.op === '|'
        if (!hasPipeAfter) hasStdoutRedirect = true
      } else if (
        (op === '>' || op === '>>' || op === '>|') &&
        !isFd(prevToken, 1) &&
        !isFd(prevToken, 2)
      ) {
        hasStdoutRedirect = true
      }
    } else if (typeof token === 'string') {
      const isRedirectTarget =
        prevToken &&
        typeof prevToken === 'object' &&
        'op' in prevToken &&
        REDIRECT_OPS.has(prevToken.op as string)

      const isRedirectFd =
        /^\d+$/.test(token) &&
        nextToken &&
        typeof nextToken === 'object' &&
        'op' in nextToken &&
        REDIRECT_OPS.has(nextToken.op)

      if (!isRedirectTarget && !isRedirectFd) {
        current.push(token)
      }
    }
  }
  if (current.length > 0 || subCommands.length > 0)
    subCommands.push({ tokens: current, hasStdoutRedirect })

  return subCommands
}

function checkSubCommandSafety(
  subCommand: SubCommand,
): { ok: true } | { ok: false; subCommand: string } {
  const text = subCommand.tokens.join(' ').trim()

  if (HARMLESS_SUB_COMMAND.test(text)) return { ok: true }

  let normalizedCommand = text
  for (const prefix of FORWARD_PREFIX) {
    const pattern = new RegExp(`^\\s*${prefix}\\s+`, 'i')
    const match = normalizedCommand.match(pattern)
    if (match) {
      normalizedCommand = normalizedCommand.slice(match[0].length).trim()
      break
    }
  }

  if (subCommand.hasStdoutRedirect)
    return { ok: false, subCommand: normalizedCommand }

  const destructive = DESTRUCTIVE_BASH_PATTERNS.some((p) =>
    p.test(normalizedCommand),
  )
  const readonly = BASH_READONLY_PATTERNS.some((p) => p.test(normalizedCommand))

  if (destructive) return { ok: false, subCommand: normalizedCommand }
  if (!readonly) return { ok: false, subCommand: normalizedCommand }
  return { ok: true }
}

export function checkBashSafety(command: string): BashSafetyIssue {
  const subCommands = splitShellSubCommands(command)
  if (subCommands.length === 0) {
    return { allowed: false, subCommand: command }
  }

  for (const subCommand of subCommands) {
    if (subCommand.tokens.length === 0) {
      return { allowed: false, subCommand: '(empty)' }
    }
    const result = checkSubCommandSafety(subCommand)
    if (!result.ok) {
      return { allowed: false, subCommand: result.subCommand }
    }
  }

  return { allowed: true }
}

export function isBashReadonlyCommand(command: string): boolean {
  return checkBashSafety(command).allowed
}

export const BASH_READONLY_TOOL_NAME = 'bash_readonly'

export function setupBashReadonlyTool(pi: ExtensionAPI): void {
  const localOps = createLocalBashOperations()
  const safeOps: BashOperations = {
    exec: async (command, cwd, options) => {
      const safety = checkBashSafety(command)
      if (!safety.allowed) {
        throw new Error(
          `${BASH_READONLY_TOOL_NAME}: not allowed: "${safety.subCommand}"`,
        )
      }
      return localOps.exec(command, cwd, options)
    },
  }
  const def = createBashToolDefinition(process.cwd(), { operations: safeOps })
  registerOptionalTools(pi, [
    defineTool({
      ...def,
      name: BASH_READONLY_TOOL_NAME,
      label: 'Read-Only Bash',
      description:
        'Execute a bash command. Only commands classified as read-only are allowed; write operations are rejected. Use the regular bash tool outside of read-only modes.',
      promptSnippet: undefined,
      promptGuidelines: undefined,
    }),
  ])
}
