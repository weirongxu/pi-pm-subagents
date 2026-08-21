import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readModePrompt } from './mode.js'

const MOCK_AGENT_DIR_VAR = 'PI_CODING_AGENT_DIR'

describe('mode', () => {
  let originalAgentDir: string | undefined
  let tempDir: string
  let modesDir: string

  beforeEach(async () => {
    originalAgentDir = process.env[MOCK_AGENT_DIR_VAR]
    tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-mode-'))
    modesDir = join(tempDir, 'modes-prompts')
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
      expect(result.description).toBe('A test mode.')
      expect(result.tools).toEqual(['read', 'write'])
      expect(result.systemPrompt).toBe('This is a test mode prompt.')
    })

    it('handles mode without frontmatter', async () => {
      await writeFile(
        join(modesDir, 'no-fm.md'),
        'Plain prompt without frontmatter.',
      )

      const result = await readModePrompt('no-fm')
      expect(result.description).toBeUndefined()
      expect(result.tools).toBeUndefined()
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
      expect(result.tools).toEqual(['read', 'write', 'edit'])
    })

    it('supports tools as comma-separated string', async () => {
      await writeFile(
        join(modesDir, 'string-tools.md'),
        `---
tools: read, write, edit, grep
---
Test prompt.`,
      )

      const result = await readModePrompt('string-tools')
      expect(result.tools).toEqual(['read', 'write', 'edit', 'grep'])
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
      expect(result.extraTools).toEqual(['bash', 'grep'])
    })

    it('supports extraTools as comma-separated string', async () => {
      await writeFile(
        join(modesDir, 'extra-string.md'),
        `---
extraTools: bash, grep, glob
---
Test prompt.`,
      )

      const result = await readModePrompt('extra-string')
      expect(result.extraTools).toEqual(['bash', 'grep', 'glob'])
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
      expect(result.removeTools).toEqual(['write', 'bash'])
    })

    it('supports removeTools as comma-separated string', async () => {
      await writeFile(
        join(modesDir, 'remove-string.md'),
        `---
removeTools: write, bash, edit
---
Test prompt.`,
      )

      const result = await readModePrompt('remove-string')
      expect(result.removeTools).toEqual(['write', 'bash', 'edit'])
    })

    it('supports model field', async () => {
      await writeFile(
        join(modesDir, 'model-test.md'),
        `---
model: sonnet
---
Test prompt.`,
      )

      const result = await readModePrompt('model-test')
      expect(result.model).toBe('sonnet')
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
      expect(result.description).toBe('Base mode.')
      expect(result.systemPrompt).toBe(
        'Base prompt content.\n\nAppended extra content.',
      )
    })

    it('handles append without override', async () => {
      await writeFile(
        join(modesDir, 'coordinator-append.md'),
        'Appended extra content.',
      )

      const result = await readModePrompt('coordinator')
      expect(result.systemPrompt).toBe(
        "You are a COORDINATOR agent; you are readonly, delegate subagents to do tasks\n\n- Delegate tasks and wait for me to tell you subagent's last message when it finishes.\n- Do not trust a subagent's self-reported result blindly.\n\nAppended extra content.",
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
      expect(result.tools).toBeUndefined()
    })

    it('handles empty tools string', async () => {
      await writeFile(
        join(modesDir, 'empty-tools-str.md'),
        `---
tools: ''
---
Test prompt.`,
      )

      const result = await readModePrompt('empty-tools-str')
      expect(result.tools).toBeUndefined()
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
      expect(result.extraTools).toBeUndefined()
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
      expect(result.removeTools).toBeUndefined()
    })

    it('trims whitespace in comma-separated tools', async () => {
      await writeFile(
        join(modesDir, 'whitespace-tools.md'),
        `---
tools: read, write , grep ,glob
---
Test prompt.`,
      )

      const result = await readModePrompt('whitespace-tools')
      expect(result.tools).toEqual(['read', 'write', 'grep', 'glob'])
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
      expect(result.description).toBe('Frontmatter from base.')
      expect(result.tools).toEqual(['read'])
      expect(result.systemPrompt).toBe('Base content.\n\nAppend content.')
    })
  })
})
