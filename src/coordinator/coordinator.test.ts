import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadMarkdown } from '../utils/markdown.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '../..')

describe('coordinator mode prompt', () => {
  it('has correct removeTools in coordinator.md', async () => {
    const coordinatorPath = join(repoRoot, 'modes-prompts', 'coordinator.md')
    const result = await loadMarkdown(coordinatorPath)
    expect(result).toBeDefined()
    expect(result?.fm.removeTools).toEqual([
      'find',
      'grep',
      'bash',
      'web_search',
      'web_fetch',
    ])
  })

  it('omits removeTools in plan.md', async () => {
    const planPath = join(repoRoot, 'modes-prompts', 'plan.md')
    const result = await loadMarkdown(planPath)
    expect(result).toBeDefined()
    expect(result?.fm.removeTools).toBeUndefined()
  })
})
