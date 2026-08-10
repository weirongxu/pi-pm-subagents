import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { lastAssistantText, lastMessageText } from './helper.js'

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
}): AssistantMessage {
  const content: (TextContent | ToolCall)[] = []
  if (opts.text) {
    content.push({ type: 'text', text: opts.text })
  }
  if (opts.toolCall) {
    content.push({
      type: 'toolCall',
      id: 'call-123',
      name: opts.toolCall,
      arguments: {},
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

function toolResult(
  data: Record<string, unknown> = {},
  isError: boolean = false,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call-123',
    toolName: 'read',
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError,
    timestamp: Date.now(),
  }
}

function toolResultText(
  text: string,
  isError: boolean = false,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call-123',
    toolName: 'read',
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
      toolResult(),
    ]
    const result = lastAssistantText(messages)
    expect(result).toBe('Reading file')
  })

  it('finds the last assistant message when multiple assistants exist', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ text: 'first' }),
      toolResult(),
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
    expect(result).toBe('File content here')
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
    expect(result).toBe('Tool output')
  })

  it('returns tool result text even when isError is true', () => {
    const messages: AgentMessage[] = [
      user('task'),
      assistant({ toolCall: 'read' }),
      toolResultText('Error: file not found', true),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('Error: file not found')
  })

  it('returns tool result text when last message is toolResult, ignoring earlier assistant text', () => {
    const messages: AgentMessage[] = [
      assistant({ text: 'hello' }),
      toolResultText('world'),
    ]
    const result = lastMessageText(messages)
    expect(result).toBe('world')
  })

  it('returns undefined when assistant has text but toolResult is empty', () => {
    const messages: AgentMessage[] = [
      assistant({ text: 'only assistant' }),
      toolResultText(''),
    ]
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
  })

  it('returns tool result text when toolResult is the only message', () => {
    const messages: AgentMessage[] = [toolResultText('only tool')]
    const result = lastMessageText(messages)
    expect(result).toBe('only tool')
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
    expect(result).toBe('tool wins')
  })

  it('returns undefined for empty messages array', () => {
    const messages: AgentMessage[] = []
    const result = lastMessageText(messages)
    expect(result).toBeUndefined()
  })
})
