import { readFile } from 'node:fs/promises'

import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

export interface PromptFrontmatter extends Record<string, unknown> {
  description?: string
  model?: string
  tools?: readonly string[]
  extraTools?: readonly string[]
  removeTools?: readonly string[]
}

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

export interface PromptDefinition extends PromptFrontmatter {
  systemPrompt: string
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return undefined
  }
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

export async function loadMarkdown(
  path: string,
): Promise<PromptDefinition | undefined> {
  const content = await readOptional(path)
  if (content === undefined) return undefined
  const { frontmatter, body } = parseFrontmatter<PromptFrontmatter>(content)
  return {
    description: frontmatter.description,
    tools: normalizeTools(frontmatter.tools),
    extraTools: normalizeTools(frontmatter.extraTools),
    removeTools: normalizeTools(frontmatter.removeTools),
    model: frontmatter.model,
    systemPrompt: body.trim(),
  }
}
