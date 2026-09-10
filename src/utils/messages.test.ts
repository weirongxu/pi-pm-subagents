import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { lastMessageText, messageText } from './messages.js'

function user(text: string): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

function assistant(opts: {
  text?: string
  toolCall?: string
  toolCallArgs?: Record<string, unknown>
  toolCallId?: string
}): AssistantMessage {
  const content: (TextContent | ThinkingContent | ToolCall)[] = []
  if (opts.text) {
    content.push({ type: 'text', text: opts.text })
  }
  if (opts.toolCall) {
    content.push({
      type: 'toolCall',
      id: opts.toolCallId || 'call-123',
      name: opts.toolCall,
      arguments: opts.toolCallArgs || {},
    })
  }
  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function toolResultText(text: string, isError = false): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call-123',
    toolName: 'read',
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.now(),
  }
}

describe('lastMessageText', () => {
  it('returns the text from the last assistant message', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'I will read it' }),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('I will read it')
  })

  it('returns undefined when only a user message exists', () => {
    const messages: AgentMessage[] = [user('task')]
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
  })

  it('returns undefined when the last message is not assistant or toolResult', () => {
    const messages: AgentMessage[] = [user('task'), user('follow-up')]
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
  })

  it('returns tool result text when the last message is a toolResult with content', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText('File content here'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({})\nFile content here')
  })

  it('returns fenced tool call render when toolResult has empty text content', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText(''),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({})')
  })

  it('returns tool result text when assistant only made tool calls and never spoke again', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'I will read it' }),
      assistant({ toolCall: 'read' }),
      toolResultText('Tool output'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({})\nTool output')
  })

  it('returns tool result text even when isError is true', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText('Error: file not found', true),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({})\nError: file not found')
  })

  it('returns tool result text when last message is toolResult, ignoring earlier assistant text', () => {
    const messages: AgentMessage[] = [
      assistant({ text: 'hello' }),
      toolResultText('world'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read\nworld')
  })

  it('returns assistant text when toolResult has empty content', () => {
    const messages: AgentMessage[] = [
      assistant({ text: 'only assistant' }),
      toolResultText(''),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('only assistant')
  })

  it('returns tool result text when toolResult is the only message', () => {
    const messages: AgentMessage[] = [toolResultText('only tool')]
    const result = lastMessageText(messages)
    expect(result).toBe('read\nonly tool')
  })

  it('returns assistant text when last message is assistant', () => {
    const messages: AgentMessage[] = [assistant({ text: 'last is assistant' })]
    const result = lastMessageText(messages)
    expect(result).toBe('last is assistant')
  })

  it('returns tool result text when assistant has no text but toolResult does', () => {
    const messages: AgentMessage[] = [
      assistant({}),
      toolResultText('tool wins'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read\ntool wins')
  })

  it('returns undefined for empty messages array', () => {
    const messages: AgentMessage[] = []
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
  })

  it('returns tool result text with formatted toolName and arguments when matching ToolCall exists', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read', toolCallArgs: { path: 'x' } }),
      toolResultText('File content here'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({"path":"x"})\nFile content here')
  })

  it('returns fenced tool call render when last assistant has no text', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'first assistant' }),
      assistant({ toolCall: 'read' }),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({})')
  })

  it('returns fenced tool call render when no assistant has text', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      assistant({}),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({})')
  })
})

describe('lastMessageText with maxBytes', () => {
  it('returns text unchanged when under byte limit', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'Short text' }),
    ]
    const result = lastMessageText(messages, 100)
    expect(result).toBe('Short text')
  })

  it('truncates text with suffix when over byte limit', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'a'.repeat(1000) }),
    ]
    const result = lastMessageText(messages, 50)
    const defaultSuffix = '\n\n[Output truncated.]'
    expect(result).toContain(defaultSuffix)
    expect(result?.length).toBeLessThanOrEqual(50 + defaultSuffix.length + 10)
  })

  it('returns undefined when no valid message exists regardless of maxBytes', () => {
    const messages: AgentMessage[] = [user('task')]
    const result = lastMessageText(messages, 100)
    expect(result).toBeUndefined()
  })

  it('does not truncate when maxBytes is undefined', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'a'.repeat(1000) }),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('a'.repeat(1000))
  })
})

describe('messageText', () => {
  it('returns null for undefined message', () => {
    expect(messageText(undefined, [])).toBeNull()
  })

  it('returns text from assistant message', () => {
    const msg = assistant({ text: 'Hello world' })
    expect(messageText(msg, [msg])).toBe('Hello world')
  })

  it('prefixes tool call render when a matching toolCall exists', () => {
    const result = toolResultText('output')
    const messages: AgentMessage[] = [
      assistant({ toolCall: 'read', toolCallArgs: { path: 'a.ts' } }),
      result,
    ]
    expect(messageText(result, messages)).toBe('read({"path":"a.ts"})\noutput')
  })

  it('falls back to toolName when no matching toolCall exists', () => {
    const result = toolResultText('output')
    const messages: AgentMessage[] = [assistant({}), result]
    expect(messageText(result, messages)).toBe('read\noutput')
  })

  it('returns empty string for empty tool result text', () => {
    const msg = toolResultText('')
    const messages: AgentMessage[] = [assistant({ toolCall: 'read' }), msg]
    expect(messageText(msg, messages)).toBe('')
  })

  it('renders tool calls as name(args)', () => {
    const msg = assistant({ toolCall: 'read' })
    expect(messageText(msg, [msg])).toBe('read({})')
  })

  it('joins mixed text and tool calls', () => {
    const msg = assistant({ text: 'Reading now', toolCall: 'read' })
    expect(messageText(msg, [msg])).toBe('Reading now\nread({})')
  })

  it('returns empty string for thinking-only assistant', () => {
    const msg = assistant({})
    expect(messageText(msg, [msg])).toBe('')
  })

  it('keeps markdown in text blocks unchanged', () => {
    const markdown = '# Title\n\n- item\n\n```js\nconsole.log(1)\n```'
    const msg = assistant({ text: markdown })
    expect(messageText(msg, [msg])).toBe(markdown)
  })

  it('returns fenced tool call render for last assistant with only tool calls', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read', toolCallArgs: { path: 'a.ts' } }),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read({"path":"a.ts"})')
  })
})
