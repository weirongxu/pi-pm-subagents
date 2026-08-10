import { describe, expect, it } from 'vitest'

import { readOnlyToolSet } from './mode-switcher.js'
import { checkBashSafety, isReadOnlyBashCommand } from './readonly-bash.js'

describe('isReadOnlyBashCommand', () => {
  it('allows read-only commands', () => {
    expect(isReadOnlyBashCommand('ls -la')).toBe(true)
    expect(isReadOnlyBashCommand('git status')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md')).toBe(true)
    expect(isReadOnlyBashCommand('rg "foo" src/')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm test')).toBe(true)
    expect(isReadOnlyBashCommand('npm test')).toBe(true)
    expect(isReadOnlyBashCommand('yarn test')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm run test')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm test:unit')).toBe(true)
    expect(isReadOnlyBashCommand('yarn run test')).toBe(true)
    expect(isReadOnlyBashCommand('cd /some/path')).toBe(true)
    expect(
      isReadOnlyBashCommand(
        'cd /home/raidou/repos/raidou/pi-notify && pnpm test 2>&1 | tail -30',
      ),
    ).toBe(true)
    expect(isReadOnlyBashCommand('cd .. && ls')).toBe(true)
  })

  it('validates each shell subcommand independently', () => {
    expect(isReadOnlyBashCommand('cat README.md && echo done')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md; rm file')).toBe(false)
    expect(isReadOnlyBashCommand('ls || rm -rf /')).toBe(false)
    expect(isReadOnlyBashCommand('cat foo | grep bar')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md; echo "rm -rf /"')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm test | tail')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm test 2>&1 | tail -60')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm test | grep FAIL')).toBe(true)
    expect(isReadOnlyBashCommand('pnpm test | rm file')).toBe(false)
  })

  it('rejects empty shell subcommands', () => {
    expect(isReadOnlyBashCommand('')).toBe(false)
    expect(isReadOnlyBashCommand('cat README.md &&')).toBe(false)
  })

  it('allows read-only commands with forward prefix', () => {
    expect(isReadOnlyBashCommand('rtk ls -la')).toBe(true)
    expect(isReadOnlyBashCommand('rtk git status')).toBe(true)
    expect(isReadOnlyBashCommand('rtk git diff path/to')).toBe(true)
    expect(
      isReadOnlyBashCommand(
        `export RTK_DB_PATH='/tmp/pi-rtk-optimizer/history.db'; rtk ls -la`,
      ),
    ).toBe(true)
  })

  it('blocks destructive commands', () => {
    expect(isReadOnlyBashCommand('rm -rf /')).toBe(false)
    expect(isReadOnlyBashCommand('npm install')).toBe(false)
    expect(isReadOnlyBashCommand('git commit -m x')).toBe(false)
    expect(isReadOnlyBashCommand('echo hi > out.txt')).toBe(false)
    expect(isReadOnlyBashCommand('sudo apt-get install evil')).toBe(false)
  })

  it('blocks destructive commands even with forward prefix', () => {
    expect(isReadOnlyBashCommand('rtk rm -rf /')).toBe(false)
    expect(isReadOnlyBashCommand('rtk npm install')).toBe(false)
    expect(isReadOnlyBashCommand('rtk git commit -m x')).toBe(false)
  })
})

describe('readOnlyToolSet', () => {
  it('drops write tools and merges extras', () => {
    expect(
      readOnlyToolSet(['read', 'edit', 'write', 'bash'], ['delegate_worker']),
    ).toEqual(['read', 'bash', 'delegate_worker'])
  })

  it('deduplicates', () => {
    expect(readOnlyToolSet(['read', 'read', 'edit'], ['read'])).toEqual([
      'read',
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
    expect(checkBashSafety('ls &> out.txt')).toEqual({ allowed: false, subCommand: 'ls' })
    expect(checkBashSafety('ls &>> out.txt')).toEqual({ allowed: false, subCommand: 'ls' })
  })
})
