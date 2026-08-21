import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai'

import { truncateToBytes } from './format.js'

function isAssistantMessage(
  message: AgentMessage | undefined,
): message is AssistantMessage {
  return message?.role === 'assistant' && Array.isArray(message.content)
}

function isToolResultMessage(
  message: AgentMessage | undefined,
): message is ToolResultMessage {
  return (
    message?.role === 'toolResult' &&
    'content' in message &&
    Array.isArray(message.content)
  )
}

function isToolCall(
  block: TextContent | ThinkingContent | ToolCall,
): block is ToolCall {
  return block.type === 'toolCall'
}

function findToolCall(
  toolCallId: string,
  messages: readonly AgentMessage[],
): ToolCall | undefined {
  for (const message of messages) {
    if (isAssistantMessage(message)) {
      for (const block of message.content) {
        if (isToolCall(block) && block.id === toolCallId) {
          return block
        }
      }
    }
  }
  return undefined
}

export function formatToolNameWithArgs(
  message: ToolResultMessage,
  messages: readonly AgentMessage[],
): string {
  const toolCall = findToolCall(message.toolCallId, messages)
  if (toolCall && Object.keys(toolCall.arguments).length > 0) {
    return `${message.toolName}(${JSON.stringify(toolCall.arguments)})`
  }
  return message.toolName
}

export function messageText(message: AgentMessage | undefined): string {
  if (!message) return ''
  if (isAssistantMessage(message) || isToolResultMessage(message)) {
    const text = message.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
    return text
  }
  return ''
}

export function lastAssistantText(
  messages: readonly AgentMessage[],
  maxBytes?: number,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (isAssistantMessage(message)) {
      const text = messageText(message)
      if (!text) continue
      const result =
        maxBytes !== undefined ? truncateToBytes(text, maxBytes) : text
      return result || undefined
    }
  }
  return undefined
}

export function lastMessageText(
  messages: readonly AgentMessage[],
  maxBytes?: number,
): string | undefined {
  if (messages.length === 0) return undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (isAssistantMessage(message)) {
      const text = messageText(message)
      if (!text) continue
      return maxBytes !== undefined ? truncateToBytes(text, maxBytes) : text
    }

    if (isToolResultMessage(message)) {
      const text = messageText(message)
      if (!text) continue
      const name = formatToolNameWithArgs(message, messages)
      const composed = `${name}\n${text}`
      return maxBytes !== undefined
        ? truncateToBytes(composed, maxBytes)
        : composed
    }
  }

  return undefined
}
