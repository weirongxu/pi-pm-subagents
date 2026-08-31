import type {
  ExtensionAPI,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'

import type { PromptFrontmatter } from './markdown.js'

export type ToolConfig = Pick<
  PromptFrontmatter,
  'tools' | 'extraTools' | 'removeTools'
>

export function registerOptionalTools(
  pi: ExtensionAPI,
  tools: ReadonlyArray<ToolDefinition<TSchema, unknown, unknown>>,
): void {
  const names = new Set(tools.map((t) => t.name))
  for (const tool of tools) {
    pi.registerTool(tool)
  }

  pi.on('session_start', async () => {
    const activeTools = pi.getActiveTools()
    const filtered = activeTools.filter((name) => !names.has(name))
    if (filtered.length !== activeTools.length) {
      pi.setActiveTools(filtered)
    }
  })
}

export function composeTools(
  baseTools: readonly string[],
  config: ToolConfig,
): string[] {
  const tools = config.tools ?? [...baseTools]
  const extra = config.extraTools ?? []
  const merged = [...new Set([...tools, ...extra])]
  const toRemove = config.removeTools ?? []
  return merged.filter((t) => !toRemove.includes(t))
}
