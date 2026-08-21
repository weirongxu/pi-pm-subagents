import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { PromptDefinition } from './core.js'
import { loadMarkdown, readOptional } from './core.js'

export async function readModePrompt(name: string): Promise<PromptDefinition> {
  const here = dirname(fileURLToPath(import.meta.url))
  const agentDir = getAgentDir()
  const modesPromptsDir = join(agentDir, 'modes-prompts')

  const overridePath = join(modesPromptsDir, `${name}.md`)
  const bundledPath = join(here, '../..', 'modes-prompts', `${name}.md`)
  const appendPath = join(modesPromptsDir, `${name}-append.md`)

  const base =
    (await loadMarkdown(overridePath)) ?? (await loadMarkdown(bundledPath))

  const append = await readOptional(appendPath)

  if (!base) throw new Error(`Mode prompt "${name}" not found`)

  if (append === undefined) return base

  return {
    ...base,
    systemPrompt: `${base.systemPrompt}\n\n${append}`,
  }
}
