import { describe, expect, it } from 'vitest'

import { readOnlyToolSet } from '../src/mode-switcher.js'
import { isReadOnlyBashCommand } from '../src/readonly-bash.js'

describe('isReadOnlyBashCommand', () => {
  it('allows read-only commands', () => {
    expect(isReadOnlyBashCommand('ls -la')).toBe(true)
    expect(isReadOnlyBashCommand('git status')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md')).toBe(true)
    expect(isReadOnlyBashCommand('rg "foo" src/')).toBe(true)
  })

  it('validates each shell subcommand independently', () => {
    expect(isReadOnlyBashCommand('cat README.md && echo done')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md; rm file')).toBe(false)
    expect(isReadOnlyBashCommand('ls || rm -rf /')).toBe(false)
    expect(isReadOnlyBashCommand('cat foo | grep bar')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md; echo "rm -rf /"')).toBe(true)
  })

  it('rejects empty shell subcommands', () => {
    expect(isReadOnlyBashCommand('')).toBe(false)
    expect(isReadOnlyBashCommand('cat README.md &&')).toBe(false)
  })

  it('allows read-only commands with forward prefix', () => {
    expect(isReadOnlyBashCommand('rtk ls -la')).toBe(true)
    expect(isReadOnlyBashCommand('rtk git status')).toBe(true)
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
