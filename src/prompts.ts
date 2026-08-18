import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { ModeType } from './types.js'

const modePromptCache = new Map<ModeType, string>()

/** Read and trim a file, returning undefined when it does not exist. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * Load a mode prompt.
 *
 * The base comes from the bundled `prompts/modes/<name>.md`, overridable by
 * `<agentDir>/prompts/<name>.md`. Optional append content from
 * `<agentDir>/modes-prompts/<name>-append.md` is concatenated after the base.
 */
export async function readModePrompt(name: ModeType): Promise<string> {
  const cached = modePromptCache.get(name)
  if (cached !== undefined) return cached

  const here = dirname(fileURLToPath(import.meta.url))
  const agentDir = getAgentDir()
  const modesPromptsDir = join(agentDir, 'modes-prompts')
  const override = await readOptional(join(modesPromptsDir, `${name}.md`))
  const base =
    override ??
    (
      await readFile(join(here, '..', 'modes-prompts', `${name}.md`), 'utf8')
    ).trim()
  const extra = await readOptional(join(modesPromptsDir, `${name}-append.md`))

  const text = extra ? `${base}\n\n${extra}` : base
  modePromptCache.set(name, text)
  return text
}
