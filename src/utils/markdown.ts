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
