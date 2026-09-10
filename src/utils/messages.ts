import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { truncateToBytes } from './format.js'
import { PLUGIN_KEY } from './state.ts'

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

function formatToolCall(toolCall: ToolCall) {
  return `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`
}

export function messageText(
  message: AgentMessage | undefined,
  messages: readonly AgentMessage[],
): string | null {
  if (!message) return null
  if (isAssistantMessage(message)) {
    const parts = message.content.map((block) => {
      if (isToolCall(block)) {
        return formatToolCall(block)
      }
      if (block.type === 'text') return block.text
      return ''
    })
    return parts.join('\n').trim()
  }
  if (isToolResultMessage(message)) {
    const result = message.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
    if (!result) return result
    const toolCall = findToolCall(message.toolCallId, messages)
    const toolCallText = toolCall ? formatToolCall(toolCall) : message.toolName
    return `${toolCallText}\n${result}`
  }
  return null
}

export function lastMessageText(
  messages: readonly AgentMessage[],
  maxBytes?: number,
): string | undefined {
  if (messages.length === 0) return undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    const text = messageText(message, messages)
    if (!text) continue
    return maxBytes !== undefined ? truncateToBytes(text, maxBytes) : text
  }

  return undefined
}

export function notifyAgentMessage(pi: ExtensionAPI, content: string) {
  pi.sendMessage(
    {
      customType: PLUGIN_KEY,
      content,
      display: true,
    },
    { deliverAs: 'steer', triggerTurn: true },
  )
}
