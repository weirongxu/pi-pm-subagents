import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import {
  composeTools,
  type OptionalToolsApi,
  registerOptionalTools,
} from './tools.js'

function fakePi(initialActive: string[]): OptionalToolsApi & {
  activeTools: string[]
  sessionStartHandlers: (() => void)[]
} {
  const pi = {
    activeTools: [...initialActive],
    sessionStartHandlers: [] as (() => void)[],
    registerTool() {},
    on(_event: 'session_start', handler: () => void) {
      pi.sessionStartHandlers.push(handler)
    },
    getActiveTools() {
      return [...pi.activeTools]
    },
    setActiveTools(names: string[]) {
      pi.activeTools = [...names]
    },
  }
  return pi
}

const toolOf = (name: string) =>
  defineTool({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: undefined }),
  })

describe('registerOptionalTools', () => {
  it('registers tools and defers filtering to session_start', () => {
    const pi = fakePi(['read', 'bash_readonly'])
    registerOptionalTools(pi, [toolOf('bash_readonly')], false)
    expect(pi.activeTools).toEqual(['read', 'bash_readonly'])

    pi.sessionStartHandlers.forEach((h) => {
      h()
    })
    expect(pi.activeTools).toEqual(['read'])
  })

  it('filters immediately when the session already started', () => {
    const pi = fakePi(['read', 'grep', 'bash_readonly'])
    registerOptionalTools(pi, [toolOf('bash_readonly')], true)
    expect(pi.activeTools).toEqual(['read', 'grep'])
  })

  it('keeps other tools untouched', () => {
    const pi = fakePi(['read'])
    registerOptionalTools(pi, [toolOf('bash_readonly')], true)
    expect(pi.activeTools).toEqual(['read'])
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
