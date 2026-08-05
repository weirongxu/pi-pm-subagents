import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type { ModeRole } from './types.js'

const cache = new Map<ModeRole, string>()

/** Read and trim a file, returning undefined when it does not exist. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * Load a role prompt.
 *
 * The base comes from the bundled `prompts/<name>.md`, overridable by
 * `<agentDir>/prompts/<name>.md`. Optional append content from
 * `<agentDir>/prompts/<name>-append.md` is concatenated after the base.
 */
export async function readPrompt(name: ModeRole): Promise<string> {
  const cached = cache.get(name)
  if (cached !== undefined) return cached

  const here = dirname(fileURLToPath(import.meta.url))
  const agentDir = getAgentDir()
  const override = await readOptional(join(agentDir, 'prompts', `${name}.md`))
  const base =
    override ??
    (await readFile(join(here, '..', 'prompts', `${name}.md`), 'utf8')).trim()
  const extra = await readOptional(
    join(agentDir, 'modes-prompts', `${name}-append.md`),
  )

  const text = extra ? `${base}\n\n${extra}` : base
  cache.set(name, text)
  return text
}
