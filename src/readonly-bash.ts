import { parse as parseShell } from 'shell-quote'

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

const READONLY_BASH_PATTERNS = [
  /^\s*(cat|head|tail|less|more|grep|find|ls|pwd|echo|printf|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|uptime|ps|free)\b/,
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
const REDIRECT_OPS = new Set([
  '>',
  '>>',
  '<',
  '<>',
  '>&',
  '<&',
  '&>',
  '>|',
  '&>>',
])
const OUTPUT_REDIRECT_OPS = new Set(['>', '>>', '&>', '>|', '&>>'])

type SubCommand = { tokens: string[]; hasRedirect: boolean }

function splitShellSubCommands(command: string): SubCommand[] {
  let parsed: ReturnType<typeof parseShell>
  try {
    parsed = parseShell(command)
  } catch {
    return []
  }

  const subCommands: SubCommand[] = []
  let current: string[] = []
  let hasRedirect = false

  for (let i = 0; i < parsed.length; i++) {
    const token = parsed[i]
    const nextToken = parsed[i + 1]
    const prevToken = i > 0 ? parsed[i - 1] : null

    if (typeof token === 'object' && 'op' in token) {
      const op = token.op as string
      if (SUB_COMMAND_OPS.has(op)) {
        subCommands.push({ tokens: current, hasRedirect })
        current = []
        hasRedirect = false
      } else if (OUTPUT_REDIRECT_OPS.has(op)) {
        hasRedirect = true
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
    subCommands.push({ tokens: current, hasRedirect })

  return subCommands
}

export function isReadOnlyBashCommand(command: string): boolean {
  const subCommands = splitShellSubCommands(command)
  if (subCommands.length === 0) return false

  return subCommands.every((subCommand) => {
    if (HARMLESS_SUB_COMMAND.test(subCommand.tokens.join(' '))) return true

    if (subCommand.hasRedirect) return false

    let normalizedCommand = subCommand.tokens.join(' ')
    for (const prefix of FORWARD_PREFIX) {
      const pattern = new RegExp(`^\\s*${prefix}\\s+`, 'i')
      const match = normalizedCommand.match(pattern)
      if (match) {
        normalizedCommand = normalizedCommand.slice(match[0].length).trim()
        break
      }
    }

    const destructive = DESTRUCTIVE_BASH_PATTERNS.some((p) =>
      p.test(normalizedCommand),
    )
    const readonly = READONLY_BASH_PATTERNS.some((p) =>
      p.test(normalizedCommand),
    )
    return !destructive && readonly
  })
}
