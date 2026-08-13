import { describe, expect, it } from 'vitest'

import { checkBashSafety, isBashReadonlyCommand } from './bash-readonly.js'
import { readOnlyToolSet } from './mode-switcher.js'

describe('isBashReadonlyCommand', () => {
  it('allows read-only commands', () => {
    expect(isBashReadonlyCommand('ls -la')).toBe(true)
    expect(isBashReadonlyCommand('git status')).toBe(true)
    expect(isBashReadonlyCommand('cat README.md')).toBe(true)
    expect(isBashReadonlyCommand('rg "foo" src/')).toBe(true)
    expect(isBashReadonlyCommand('pnpm test')).toBe(true)
    expect(isBashReadonlyCommand('npm test')).toBe(true)
    expect(isBashReadonlyCommand('yarn test')).toBe(true)
    expect(isBashReadonlyCommand('pnpm run test')).toBe(true)
    expect(isBashReadonlyCommand('pnpm test:unit')).toBe(true)
    expect(isBashReadonlyCommand('yarn run test')).toBe(true)
    expect(isBashReadonlyCommand('cd /some/path')).toBe(true)
    expect(
      isBashReadonlyCommand(
        'cd /home/raidou/repos/raidou/pi-notify && pnpm test 2>&1 | tail -30',
      ),
    ).toBe(true)
    expect(isBashReadonlyCommand('cd .. && ls')).toBe(true)
  })

  it('validates each shell subcommand independently', () => {
    expect(isBashReadonlyCommand('cat README.md && echo done')).toBe(true)
    expect(isBashReadonlyCommand('cat README.md; rm file')).toBe(false)
    expect(isBashReadonlyCommand('ls || rm -rf /')).toBe(false)
    expect(isBashReadonlyCommand('cat foo | grep bar')).toBe(true)
    expect(isBashReadonlyCommand('cat README.md; echo "rm -rf /"')).toBe(true)
    expect(isBashReadonlyCommand('pnpm test | tail')).toBe(true)
    expect(isBashReadonlyCommand('pnpm test 2>&1 | tail -60')).toBe(true)
    expect(isBashReadonlyCommand('pnpm test | grep FAIL')).toBe(true)
    expect(isBashReadonlyCommand('pnpm test | rm file')).toBe(false)
  })

  it('rejects empty shell subcommands', () => {
    expect(isBashReadonlyCommand('')).toBe(false)
    expect(isBashReadonlyCommand('cat README.md &&')).toBe(false)
  })

  it('allows read-only commands with forward prefix', () => {
    expect(isBashReadonlyCommand('rtk ls -la')).toBe(true)
    expect(isBashReadonlyCommand('rtk git status')).toBe(true)
    expect(isBashReadonlyCommand('rtk git diff path/to')).toBe(true)
    expect(
      isBashReadonlyCommand(
        `export RTK_DB_PATH='/tmp/pi-rtk-optimizer/history.db'; rtk ls -la`,
      ),
    ).toBe(true)
  })

  it('blocks destructive commands', () => {
    expect(isBashReadonlyCommand('rm -rf /')).toBe(false)
    expect(isBashReadonlyCommand('npm install')).toBe(false)
    expect(isBashReadonlyCommand('git commit -m x')).toBe(false)
    expect(isBashReadonlyCommand('echo hi > out.txt')).toBe(false)
    expect(isBashReadonlyCommand('sudo apt-get install evil')).toBe(false)
  })

  it('blocks destructive commands even with forward prefix', () => {
    expect(isBashReadonlyCommand('rtk rm -rf /')).toBe(false)
    expect(isBashReadonlyCommand('rtk npm install')).toBe(false)
    expect(isBashReadonlyCommand('rtk git commit -m x')).toBe(false)
  })
})

describe('readOnlyToolSet', () => {
  it('drops write tools, replaces bash, and merges extras', () => {
    expect(
      readOnlyToolSet(['read', 'edit', 'write', 'bash'], ['subagent_delegate']),
    ).toEqual(['read', 'bash-readonly', 'subagent_delegate'])
  })

  it('deduplicates', () => {
    expect(readOnlyToolSet(['read', 'read', 'edit'], ['read'])).toEqual([
      'read',
    ])
  })

  it('does not inject bash-readonly when bash is not present', () => {
    expect(readOnlyToolSet(['read', 'grep'], [])).toEqual(['read', 'grep'])
  })

  it('passes through bash-readonly unchanged when already present', () => {
    expect(readOnlyToolSet(['read', 'bash-readonly'], [])).toEqual([
      'read',
      'bash-readonly',
    ])
  })
})

describe('checkBashSafety', () => {
  it('returns allowed: true for safe commands', () => {
    expect(checkBashSafety('ls -la')).toEqual({ allowed: true })
    expect(checkBashSafety('git status')).toEqual({ allowed: true })
    expect(checkBashSafety('cat README.md')).toEqual({ allowed: true })
    expect(checkBashSafety('rg "foo" src/')).toEqual({ allowed: true })
    expect(checkBashSafety('pnpm test')).toEqual({ allowed: true })
  })

  it('reports the failed subcommand for destructive commands', () => {
    expect(checkBashSafety('rm file')).toEqual({
      allowed: false,
      subCommand: 'rm file',
    })
    expect(checkBashSafety('rm -rf /')).toEqual({
      allowed: false,
      subCommand: 'rm -rf /',
    })
  })

  it('reports the failed subcommand for output redirect commands', () => {
    expect(checkBashSafety('ls > out.txt')).toEqual({
      allowed: false,
      subCommand: 'ls',
    })
  })

  it('reports the failed subcommand for sudo commands', () => {
    expect(checkBashSafety('sudo apt-get install evil')).toEqual({
      allowed: false,
      subCommand: 'sudo apt-get install evil',
    })
  })

  it('reports the first failed subcommand in chain', () => {
    expect(checkBashSafety('cat README.md; rm file')).toEqual({
      allowed: false,
      subCommand: 'rm file',
    })
    expect(checkBashSafety('ls && echo hi && rm file')).toEqual({
      allowed: false,
      subCommand: 'rm file',
    })
    expect(checkBashSafety('rm file && ls')).toEqual({
      allowed: false,
      subCommand: 'rm file',
    })
  })

  it('returns (empty) for trailing empty subcommands', () => {
    expect(checkBashSafety('cat README.md &&')).toEqual({
      allowed: false,
      subCommand: '(empty)',
    })
    expect(checkBashSafety('ls ;')).toEqual({
      allowed: false,
      subCommand: '(empty)',
    })
  })

  it('returns the original command for empty input', () => {
    expect(checkBashSafety('')).toEqual({ allowed: false, subCommand: '' })
  })

  it('strips rtk prefix when checking for destructive patterns', () => {
    expect(checkBashSafety('rtk git commit -m x')).toEqual({
      allowed: false,
      subCommand: 'git commit -m x',
    })
    expect(checkBashSafety('rtk rm -rf /')).toEqual({
      allowed: false,
      subCommand: 'rm -rf /',
    })
  })

  it('allows safe commands with rtk prefix', () => {
    expect(checkBashSafety('rtk ls -la')).toEqual({ allowed: true })
    expect(checkBashSafety('rtk git status')).toEqual({ allowed: true })
  })

  it('handles complex multi-subcommand scenarios', () => {
    expect(checkBashSafety('cat README.md && echo done && ls -la')).toEqual({
      allowed: true,
    })
    expect(checkBashSafety('cat README.md | grep foo | tail')).toEqual({
      allowed: true,
    })
    expect(checkBashSafety('pnpm test | grep FAIL | tail -20')).toEqual({
      allowed: true,
    })
  })

  it('allows stderr redirects but blocks stdout redirects', () => {
    expect(
      checkBashSafety("find /home/raidou -name 'foo' 2>/dev/null"),
    ).toEqual({ allowed: true })
    expect(checkBashSafety('rtk find . 2>/dev/null')).toEqual({
      allowed: true,
    })
    expect(checkBashSafety('ls > out.txt')).toEqual({
      allowed: false,
      subCommand: 'ls',
    })
    expect(checkBashSafety('ls 1>/dev/null')).toEqual({ allowed: true })
    expect(checkBashSafety('ls 2>&1 | grep x')).toEqual({ allowed: true })
    expect(checkBashSafety('cat foo 2>&1')).toEqual({
      allowed: false,
      subCommand: 'cat foo',
    })
    expect(checkBashSafety('ls &> out.txt')).toEqual({
      allowed: false,
      subCommand: 'ls',
    })
    expect(checkBashSafety('ls &>> out.txt')).toEqual({
      allowed: false,
      subCommand: 'ls',
    })
  })
})
