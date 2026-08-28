import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

import { readOptional } from './fs.js'
import { normalizeTools } from './tools.js'

export interface PromptFrontmatter extends Record<string, unknown> {
  description?: string
  model?: string
  tools?: readonly string[]
  extraTools?: readonly string[]
  removeTools?: readonly string[]
}

export interface PromptDefinition extends PromptFrontmatter {
  systemPrompt: string
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

function mergeUnique(
  base: readonly string[] | undefined,
  append: readonly string[] | undefined,
): readonly string[] | undefined {
  const merged = new Set<string>()
  for (const item of base ?? []) merged.add(item)
  for (const item of append ?? []) merged.add(item)
  return merged.size > 0 ? [...merged] : undefined
}

export function mergePromptDefinitions(
  base: PromptDefinition,
  append: PromptDefinition,
): PromptDefinition {
  return {
    description: append.description ?? base.description,
    model: append.model ?? base.model,
    tools: mergeUnique(base.tools, append.tools),
    extraTools: mergeUnique(base.extraTools, append.extraTools),
    removeTools: mergeUnique(base.removeTools, append.removeTools),
    systemPrompt: append.systemPrompt
      ? `${base.systemPrompt}\n\n${append.systemPrompt}`
      : base.systemPrompt,
  }
}
