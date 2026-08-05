import { describe, expect, it } from 'vitest'

import { isReadOnlyBashCommand } from '../src/helper.js'
import { readOnlyToolSet } from '../src/mode-switcher.js'

describe('isReadOnlyBashCommand', () => {
  it('allows read-only commands', () => {
    expect(isReadOnlyBashCommand('ls -la')).toBe(true)
    expect(isReadOnlyBashCommand('git status')).toBe(true)
    expect(isReadOnlyBashCommand('cat README.md')).toBe(true)
    expect(isReadOnlyBashCommand('rg "foo" src/')).toBe(true)
  })

  it('blocks destructive commands', () => {
    expect(isReadOnlyBashCommand('rm -rf /')).toBe(false)
    expect(isReadOnlyBashCommand('npm install')).toBe(false)
    expect(isReadOnlyBashCommand('git commit -m x')).toBe(false)
    expect(isReadOnlyBashCommand('echo hi > out.txt')).toBe(false)
    expect(isReadOnlyBashCommand('sudo apt-get install evil')).toBe(false)
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
