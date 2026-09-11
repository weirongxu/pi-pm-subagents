import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseFrontmatter } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readModePrompt } from './mode.js'

const here = dirname(fileURLToPath(import.meta.url))

const MOCK_AGENT_DIR_VAR = 'PI_CODING_AGENT_DIR'

describe('mode', () => {
  let originalAgentDir: string | undefined
  let tempDir: string
  let modesDir: string

  beforeEach(async () => {
    originalAgentDir = process.env[MOCK_AGENT_DIR_VAR]
    tempDir = await mkdtemp(join(tmpdir(), 'pi-pm-subagents-test-mode-'))
    modesDir = join(tempDir, 'pm-subagents-prompts')
    await mkdir(modesDir, { recursive: true })
    process.env[MOCK_AGENT_DIR_VAR] = tempDir
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    process.env[MOCK_AGENT_DIR_VAR] = originalAgentDir
  })

  describe('readModePrompt', () => {
    it('reads mode prompt with override', async () => {
      await writeFile(
        join(modesDir, 'test-mode.md'),
        `---
description: A test mode.
tools: [read, write]
---
This is a test mode prompt.`,
      )

      const result = await readModePrompt('test-mode')
      expect(result.fm.description).toBe('A test mode.')
      expect(result.fm.tools).toEqual(['read', 'write'])
      expect(result.systemPrompt).toBe('This is a test mode prompt.')
    })

    it('handles mode without frontmatter', async () => {
      await writeFile(
        join(modesDir, 'no-fm.md'),
        'Plain prompt without frontmatter.',
      )

      const result = await readModePrompt('no-fm')
      expect(result.fm.description).toBeUndefined()
      expect(result.fm.tools).toBeUndefined()
      expect(result.systemPrompt).toBe('Plain prompt without frontmatter.')
    })

    it('supports tools as array', async () => {
      await writeFile(
        join(modesDir, 'array-tools.md'),
        `---
tools: [read, write, edit]
---
Test prompt.`,
      )

      const result = await readModePrompt('array-tools')
      expect(result.fm.tools).toEqual(['read', 'write', 'edit'])
    })

    it('supports extraTools as array', async () => {
      await writeFile(
        join(modesDir, 'extra-array.md'),
        `---
extraTools: [bash, grep]
---
Test prompt.`,
      )

      const result = await readModePrompt('extra-array')
      expect(result.fm.extraTools).toEqual(['bash', 'grep'])
    })

    it('supports removeTools as array', async () => {
      await writeFile(
        join(modesDir, 'remove-array.md'),
        `---
removeTools: [write, bash]
---
Test prompt.`,
      )

      const result = await readModePrompt('remove-array')
      expect(result.fm.removeTools).toEqual(['write', 'bash'])
    })

    it('supports model field', async () => {
      await writeFile(
        join(modesDir, 'model-test.md'),
        `---
model: anthropic/claude-sonnet-4-5
---
Test prompt.`,
      )

      const result = await readModePrompt('model-test')
      expect(result.fm.model).toBe('anthropic/claude-sonnet-4-5')
    })

    it('appends extra content from -append.md', async () => {
      await writeFile(
        join(modesDir, 'with-append.md'),
        `---
description: Base mode.
---
Base prompt content.`,
      )
      await writeFile(
        join(modesDir, 'with-append-append.md'),
        'Appended extra content.',
      )

      const result = await readModePrompt('with-append')
      expect(result.fm.description).toBe('Base mode.')
      expect(result.systemPrompt).toBe(
        'Base prompt content.\n\nAppended extra content.',
      )
    })

    it('handles append without override', async () => {
      await writeFile(
        join(modesDir, 'coordinator-append.md'),
        'Appended extra content.',
      )

      const bundled = await readFile(
        join(here, '../../pm-subagents-prompts/coordinator.md'),
        'utf8',
      )
      const { body } = parseFrontmatter(bundled)

      const result = await readModePrompt('coordinator')
      // Intentionally structural assertions instead of hardcoding the full
      // body: tolerate wording edits to the bundled prompt while guarding
      // against sections being accidentally dropped from it.
      expect(result.systemPrompt).toContain('You are a COORDINATOR agent')
      expect(result.systemPrompt).toContain('## Responsibilities')
      expect(result.systemPrompt).toContain(
        `- Delegate tasks; the subagent's final message is delivered automatically`,
      )
      expect(result.systemPrompt).toContain(
        `- Do not trust a subagent's self-reported result blindly.`,
      )
      expect(result.systemPrompt).toContain(body.trim())
      expect(result.systemPrompt).toContain(
        `${body.trim()}\n\nAppended extra content.`,
      )
    })

    it('handles empty tools array', async () => {
      await writeFile(
        join(modesDir, 'empty-tools.md'),
        `---
tools: []
---
Test prompt.`,
      )

      const result = await readModePrompt('empty-tools')
      expect(result.fm.tools).toEqual([])
    })

    it('handles empty extraTools array', async () => {
      await writeFile(
        join(modesDir, 'empty-extra.md'),
        `---
extraTools: []
---
Test prompt.`,
      )

      const result = await readModePrompt('empty-extra')
      expect(result.fm.extraTools).toEqual([])
    })

    it('handles empty removeTools array', async () => {
      await writeFile(
        join(modesDir, 'empty-remove.md'),
        `---
removeTools: []
---
Test prompt.`,
      )

      const result = await readModePrompt('empty-remove')
      expect(result.fm.removeTools).toEqual([])
    })

    it('frontmatter from base is preserved when append exists', async () => {
      await writeFile(
        join(modesDir, 'fm-base.md'),
        `---
description: Frontmatter from base.
tools: [read]
---
Base content.`,
      )
      await writeFile(join(modesDir, 'fm-base-append.md'), 'Append content.')

      const result = await readModePrompt('fm-base')
      expect(result.fm.description).toBe('Frontmatter from base.')
      expect(result.fm.tools).toEqual(['read'])
      expect(result.systemPrompt).toBe('Base content.\n\nAppend content.')
    })

    it('append tools merge with base tools (union, deduped)', async () => {
      await writeFile(
        join(modesDir, 'tools-merge.md'),
        `---
tools: [read, write]
---
Base content.`,
      )
      await writeFile(
        join(modesDir, 'tools-merge-append.md'),
        `---
tools: [write, grep]
---
`,
      )

      const result = await readModePrompt('tools-merge')
      expect(result.fm.tools).toEqual(['read', 'write', 'grep'])
    })

    it('merges description, model, tools, and systemPrompt from append', async () => {
      await writeFile(
        join(modesDir, 'all-merge.md'),
        `---
description: Base description.
model: base/model
tools: [read, write]
---
Base content.`,
      )
      await writeFile(
        join(modesDir, 'all-merge-append.md'),
        `---
description: Append description.
model: append/model
tools: [grep]
---
Append body.`,
      )

      const result = await readModePrompt('all-merge')
      expect(result.fm.description).toBe('Append description.')
      expect(result.fm.model).toBe('append/model')
      expect(result.fm.tools).toEqual(['read', 'write', 'grep'])
      expect(result.systemPrompt).toBe('Base content.\n\nAppend body.')
    })

    it('append with frontmatter only and empty body merges cleanly', async () => {
      await writeFile(
        join(modesDir, 'empty-body.md'),
        `---
description: Base description.
---
Base content.`,
      )
      await writeFile(
        join(modesDir, 'empty-body-append.md'),
        `---
model: append/model
---
`,
      )

      const result = await readModePrompt('empty-body')
      expect(result.fm.description).toBe('Base description.')
      expect(result.fm.model).toBe('append/model')
      expect(result.systemPrompt).toBe('Base content.')
    })
  })
})
