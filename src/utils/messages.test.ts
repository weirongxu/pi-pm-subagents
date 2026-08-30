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

import {
  formatToolNameWithArgs,
  lastAssistantText,
  lastMessageText,
  messageText,
} from './messages.js'

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

function toolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.now(),
  }
}

describe('lastAssistantText', () => {
  it('returns the text from the last assistant message', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'I will read it' }),
    ]
    const result = lastAssistantText(messages)
    expect(result).toBe('I will read it')
  })

  it('finds the last assistant message when toolResult follows', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'Reading file', toolCall: 'read' }),
      toolResultText('content'),
    ]
    const result = lastAssistantText(messages)
    expect(result).toBe('Reading file')
  })

  it('finds the last assistant message when multiple assistants exist', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'first' }),
      toolResultText('result'),
      assistant({ text: 'second' }),
    ]
    const result = lastAssistantText(messages)
    expect(result).toBe('second')
  })

  it('returns undefined when only user messages exist', () => {
    const messages: AgentMessage[] = [user('task'), user('follow-up')]
    const result = lastAssistantText(messages)
    expect(result).toBeUndefined()
  })

  it('returns undefined when the last message is toolResult', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText('File content here'),
    ]
    const result = lastAssistantText(messages)
    expect(result).toBeUndefined()
  })

  it('returns undefined for empty messages array', () => {
    const messages: AgentMessage[] = []
    const result = lastAssistantText(messages)
    expect(result).toBeUndefined()
  })
})

describe('lastAssistantText with maxBytes', () => {
  it('returns text unchanged when under byte limit', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'Short text' }),
    ]
    const result = lastAssistantText(messages, 100)
    expect(result).toBe('Short text')
  })

  it('truncates text with suffix when over byte limit', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'a'.repeat(1000) }),
    ]
    const result = lastAssistantText(messages, 50)
    const defaultSuffix = '\n\n[Output truncated.]'
    expect(result).toContain(defaultSuffix)
    expect(result?.length).toBeLessThanOrEqual(50 + defaultSuffix.length + 10)
  })

  it('returns undefined when no valid message exists regardless of maxBytes', () => {
    const messages: AgentMessage[] = [user('task')]
    const result = lastAssistantText(messages, 100)
    expect(result).toBeUndefined()
  })

  it('does not truncate when maxBytes is undefined', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'a'.repeat(1000) }),
    ]
    const result = lastAssistantText(messages)
    expect(result).toBe('a'.repeat(1000))
  })
})

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
    expect(result).toBe('read\nFile content here')
  })

  it('returns undefined when toolResult has empty text content', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText(''),
    ]
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
  })

  it('returns tool result text when assistant only made tool calls and never spoke again', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'I will read it' }),
      assistant({ toolCall: 'read' }),
      toolResultText('Tool output'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read\nTool output')
  })

  it('returns tool result text even when isError is true', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText('Error: file not found', true),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('read\nError: file not found')
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

  it('returns previous assistant text when last assistant has no text', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'first assistant' }),
      assistant({ toolCall: 'read' }),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('first assistant')
  })

  it('returns undefined when no assistant has text', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      assistant({}),
    ]
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
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
  it('returns empty string for undefined message', () => {
    expect(messageText(undefined)).toBe('')
  })

  it('returns text from assistant message', () => {
    const msg = assistant({ text: 'Hello world' })
    expect(messageText(msg)).toBe('Hello world')
  })

  it('returns tool result text without prefix', () => {
    const msg = toolResultText('output')
    expect(messageText(msg)).toBe('output')
  })

  it('returns empty string for empty tool result text', () => {
    const msg = toolResultText('')
    expect(messageText(msg)).toBe('')
  })

  it('returns empty string for message with only tool calls', () => {
    const msg = assistant({ toolCall: 'read' })
    expect(messageText(msg)).toBe('')
  })
})

describe('formatToolNameWithArgs', () => {
  it('returns toolName with arguments when matching ToolCall has arguments', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read', toolCallArgs: { path: 'file.txt' } }),
    ]
    const toolResult = toolResultText('content')
    const result = formatToolNameWithArgs(toolResult, messages)
    expect(result).toBe('read({"path":"file.txt"})')
  })

  it('returns toolName without parens when matching ToolCall has empty arguments', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read', toolCallArgs: {} }),
    ]
    const toolResult = toolResultText('content')
    const result = formatToolNameWithArgs(toolResult, messages)
    expect(result).toBe('read')
  })

  it('returns toolName without parens when no matching ToolCall exists', () => {
    const messages: AgentMessage[] = [user('task')]
    const toolResult = toolResultText('content')
    const result = formatToolNameWithArgs(toolResult, messages)
    expect(result).toBe('read')
  })

  it('returns toolName with complex arguments when matching ToolCall has complex arguments', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({
        toolCall: 'write',
        toolCallArgs: {
          path: 'file.txt',
          content: 'hello world',
          overwrite: true,
        },
      }),
    ]
    const toolResult = toolResultMessage('call-123', 'write', 'done')
    const result = formatToolNameWithArgs(toolResult, messages)
    expect(result).toBe(
      'write({"path":"file.txt","content":"hello world","overwrite":true})',
    )
  })
})
