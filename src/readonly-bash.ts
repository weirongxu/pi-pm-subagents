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

function splitShellSubCommands(command: string): string[] {
  let parsed: ReturnType<typeof parseShell>
  try {
    parsed = parseShell(command)
  } catch {
    return []
  }

  const subCommands: string[][] = []
  let current: string[] = []
  for (const token of parsed) {
    if (typeof token === 'object' && 'op' in token) {
      subCommands.push(current)
      current = []
    } else if (typeof token === 'string') {
      current.push(token)
    }
  }
  if (current.length > 0 || subCommands.length > 0) subCommands.push(current)

  return subCommands.map((tokens) => tokens.join(' '))
}

export function isReadOnlyBashCommand(command: string): boolean {
  const subCommands = splitShellSubCommands(command)
  if (subCommands.length === 0) return false

  return subCommands.every((subCommand) => {
    if (HARMLESS_SUB_COMMAND.test(subCommand)) return true

    let normalizedCommand = subCommand
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
