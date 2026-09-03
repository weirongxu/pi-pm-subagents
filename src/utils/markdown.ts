import { parseFrontmatter } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import { Type } from 'typebox'
import { Parse } from 'typebox/value'

import { readOptional } from './fs.js'

const StringList = Type.Array(Type.String())

const ThinkingLevelSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

const PromptFrontmatterSchema = Type.Object({
  description: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinkingLevel: Type.Optional(ThinkingLevelSchema),
  tools: Type.Optional(StringList),
  extraTools: Type.Optional(StringList),
  removeTools: Type.Optional(StringList),
  reviewOnEnd: Type.Optional(Type.Boolean()),
})

export type PromptFrontmatter = Static<typeof PromptFrontmatterSchema>

export interface PromptDefinition {
  fm: PromptFrontmatter
  systemPrompt?: string
}

export async function loadMarkdown(
  path: string,
): Promise<PromptDefinition | undefined> {
  const content = await readOptional(path)
  if (content === undefined) return undefined
  const { frontmatter, body } = parseFrontmatter(content)
  const fm = Parse(PromptFrontmatterSchema, frontmatter)
  return { fm, systemPrompt: body.trim() }
}

function mergeUniqueTools(
  baseTools: readonly string[] | undefined,
  appendTools: readonly string[] | undefined,
): string[] | undefined {
  const merged = new Set([...(baseTools ?? []), ...(appendTools ?? [])])
  return merged.size > 0 ? [...merged] : undefined
}

export function mergePromptDefinitions(
  baseTools: PromptDefinition,
  append: PromptDefinition,
): PromptDefinition {
  return {
    fm: {
      description: append.fm.description ?? baseTools.fm.description,
      model: append.fm.model ?? baseTools.fm.model,
      thinkingLevel: append.fm.thinkingLevel ?? baseTools.fm.thinkingLevel,
      tools: mergeUniqueTools(baseTools.fm.tools, append.fm.tools),
      extraTools: mergeUniqueTools(
        baseTools.fm.extraTools,
        append.fm.extraTools,
      ),
      removeTools: mergeUniqueTools(
        baseTools.fm.removeTools,
        append.fm.removeTools,
      ),
      reviewOnEnd: append.fm.reviewOnEnd ?? baseTools.fm.reviewOnEnd,
    },
    systemPrompt: append.systemPrompt
      ? `${baseTools.systemPrompt}\n\n${append.systemPrompt}`
      : baseTools.systemPrompt,
  }
}
