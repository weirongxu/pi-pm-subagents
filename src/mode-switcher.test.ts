import { describe, expect, it } from 'vitest'

import { BASH_READONLY_TOOL_NAME } from './bash-readonly.js'
import {
  applyModeTools,
  type ToolConfig,
  WRITE_TOOLS,
} from './mode-switcher.js'

describe('applyModeTools', () => {
  it('defaults to read-only behavior when no config is provided', () => {
    const base = ['read', 'write', 'edit', 'bash', 'grep', 'find']
    const result = applyModeTools(base, {})
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('grep')
    expect(result).toContain('find')
    expect(result).not.toContain('write')
    expect(result).not.toContain('edit')
    expect(result).not.toContain('bash')
  })

  it('adds extra tools to the result', () => {
    const base = ['read', 'write', 'bash']
    const config: ToolConfig = {
      extraTools: ['subagent_delegate', 'subagent_kill'],
    }
    const result = applyModeTools(base, config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('subagent_delegate')
    expect(result).toContain('subagent_kill')
  })

  it('removes tools specified in removeTools', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find']
    const config: ToolConfig = {
      removeTools: ['grep', 'find'],
    }
    const result = applyModeTools(base, config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).not.toContain('grep')
    expect(result).not.toContain('find')
  })

  it('applies tools whitelist when tools is specified', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find']
    const config: ToolConfig = {
      tools: ['read', BASH_READONLY_TOOL_NAME],
    }
    const result = applyModeTools(base, config)
    expect(result).toEqual(['read', BASH_READONLY_TOOL_NAME])
  })

  it('combines extraTools and removeTools correctly', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find']
    const config: ToolConfig = {
      extraTools: ['subagent_delegate'],
      removeTools: ['grep'],
    }
    const result = applyModeTools(base, config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('find')
    expect(result).toContain('subagent_delegate')
    expect(result).not.toContain('grep')
  })

  it('combines tools, extraTools, and removeTools correctly', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find', 'ls']
    const config: ToolConfig = {
      tools: ['read', 'grep', 'subagent_delegate'],
      extraTools: ['subagent_delegate'],
      removeTools: ['find', 'ls'],
    }
    const result = applyModeTools(base, config)
    // candidates = [read, grep, subagent_delegate]
    // readOnly = [read, grep, subagent_delegate] (no write/bash in tools)
    // withExtra = [read, grep, subagent_delegate] (deduplicated)
    // after removeTools: [read, grep, subagent_delegate] (find/ls not present)
    expect(result).toContain('read')
    expect(result).toContain('grep')
    expect(result).toContain('subagent_delegate')
    expect(result).not.toContain(BASH_READONLY_TOOL_NAME)
    expect(result).not.toContain('find')
    expect(result).not.toContain('ls')
  })

  it('handles empty arrays correctly', () => {
    const base = ['read', 'write', 'bash']
    const config: ToolConfig = {
      tools: [],
      extraTools: [],
      removeTools: [],
    }
    const result = applyModeTools(base, config)
    // Empty tools should result in empty output
    expect(result).toEqual([])
  })

  it('handles undefined fields correctly', () => {
    const base = ['read', 'write', 'bash', 'grep']
    const config: ToolConfig = {
      tools: undefined,
      extraTools: undefined,
      removeTools: undefined,
    }
    const result = applyModeTools(base, config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('grep')
  })

  it('removes all write tools from base', () => {
    const base = ['read', 'write', 'edit', 'bash']
    const result = applyModeTools(base, {})
    for (const tool of WRITE_TOOLS) {
      expect(result).not.toContain(tool)
    }
  })

  it('keeps extraTools even when tools whitelist does not include them', () => {
    const config: ToolConfig = {
      tools: ['read', 'grep'],
      extraTools: ['subagent_delegate'],
    }
    const result = applyModeTools([], config)
    expect(result).toContain('read')
    expect(result).toContain('grep')
    expect(result).toContain('subagent_delegate')
  })
})
