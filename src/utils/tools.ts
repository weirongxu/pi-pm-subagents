import type { PromptFrontmatter } from './markdown.js'

export type ToolConfig = Pick<
  PromptFrontmatter,
  'tools' | 'extraTools' | 'removeTools'
>

export function composeTools(
  base: readonly string[],
  config: ToolConfig,
): string[] {
  const candidates = config.tools ?? [...base]
  const merged = [...new Set([...candidates, ...(config.extraTools ?? [])])]
  return merged.filter((t) => !(config.removeTools ?? []).includes(t))
}

export function normalizeTools(
  tools: readonly string[] | string | undefined,
): string[] | undefined {
  if (tools === undefined) return undefined
  if (Array.isArray(tools)) {
    return tools.length === 0 ? undefined : [...tools]
  }
  if (typeof tools === 'string') {
    const normalized = tools
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return normalized.length === 0 ? undefined : normalized
  }
  return undefined
}
