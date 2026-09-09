import { describe, expect, it } from 'vitest'

import { composeTools, removeToolNames } from './tools.js'
describe('removeToolNames', () => {
  it('removes tools present in the removed set', () => {
    expect(
      removeToolNames(
        ['read', 'bash_readonly', 'grep'],
        new Set(['bash_readonly']),
      ),
    ).toEqual(['read', 'grep'])
  })

  it('returns all tools when nothing matches', () => {
    expect(
      removeToolNames(['read', 'grep'], new Set(['bash_readonly'])),
    ).toEqual(['read', 'grep'])
  })

  it('returns an empty array for empty input', () => {
    expect(removeToolNames([], new Set(['bash_readonly']))).toEqual([])
  })

  it('removes everything when all names match', () => {
    expect(removeToolNames(['a', 'b'], new Set(['a', 'b']))).toEqual([])
  })
})

describe('composeTools', () => {
  it('adds extraTools to the base tools and deduplicates', () => {
    expect(
      composeTools(['read', 'bash'], { extraTools: ['read', 'grep'] }),
    ).toEqual(['read', 'bash', 'grep'])
  })

  it('restricts to the tools whitelist when provided', () => {
    expect(
      composeTools(['read', 'bash'], { tools: ['grep'], extraTools: ['find'] }),
    ).toEqual(['grep', 'find'])
  })

  it('removes tools listed in removeTools', () => {
    expect(
      composeTools(['read', 'bash', 'grep'], { removeTools: ['bash'] }),
    ).toEqual(['read', 'grep'])
  })
})
