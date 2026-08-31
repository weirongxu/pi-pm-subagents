import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadMarkdown, mergePromptDefinitions } from './markdown.js'
import { composeTools } from './tools.js'

describe('composeTools', () => {
  it('uses base tools when config has no tools', () => {
    expect(composeTools(['read', 'write'], {})).toEqual(['read', 'write'])
  })

  it('replaces base with config.tools', () => {
    expect(composeTools(['read', 'write'], { tools: ['grep'] })).toEqual([
      'grep',
    ])
  })

  it('adds extraTools to candidates', () => {
    expect(composeTools(['read', 'write'], { extraTools: ['bash'] })).toEqual([
      'read',
      'write',
      'bash',
    ])
  })

  it('removes tools from base and candidates', () => {
    expect(
      composeTools(['read', 'write', 'edit'], { removeTools: ['write'] }),
    ).toEqual(['read', 'edit'])
  })

  it('combines tools, extraTools, and removeTools', () => {
    const result = composeTools(['read', 'write', 'edit'], {
      tools: ['read', 'bash'],
      extraTools: ['grep'],
      removeTools: ['write'],
    })
    expect(result).toEqual(['read', 'bash', 'grep'])
  })

  it('deduplicates tools', () => {
    const result = composeTools(['read', 'write'], {
      tools: ['read'],
      extraTools: ['read', 'bash'],
    })
    expect(result).toEqual(['read', 'bash'])
  })
})

describe('loadMarkdown', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-markdown-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns undefined for non-existent file', async () => {
    const result = await loadMarkdown(join(tempDir, 'nonexistent.md'))
    expect(result).toBeUndefined()
  })

  it('loads markdown with frontmatter', async () => {
    const filePath = join(tempDir, 'test.md')
    await writeFile(
      filePath,
      `---
description: A test mode.
tools: [read, write]
---
This is a test mode prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result).toEqual({
      fm: {
        description: 'A test mode.',
        tools: ['read', 'write'],
        extraTools: undefined,
        removeTools: undefined,
        model: undefined,
        reviewOnEnd: undefined,
      },
      systemPrompt: 'This is a test mode prompt.',
    })
  })

  it('handles markdown without frontmatter', async () => {
    const filePath = join(tempDir, 'no-fm.md')
    await writeFile(filePath, 'Plain prompt without frontmatter.')

    const result = await loadMarkdown(filePath)
    expect(result).toEqual({
      fm: {
        description: undefined,
        tools: undefined,
        extraTools: undefined,
        removeTools: undefined,
        model: undefined,
        reviewOnEnd: undefined,
      },
      systemPrompt: 'Plain prompt without frontmatter.',
    })
  })

  it('supports tools as array', async () => {
    const filePath = join(tempDir, 'array-tools.md')
    await writeFile(
      filePath,
      `---
tools: [read, write, edit, grep]
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.tools).toEqual(['read', 'write', 'edit', 'grep'])
  })

  it('supports extraTools as array', async () => {
    const filePath = join(tempDir, 'extra-array.md')
    await writeFile(
      filePath,
      `---
extraTools: [bash, grep]
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.extraTools).toEqual(['bash', 'grep'])
  })

  it('supports removeTools as array', async () => {
    const filePath = join(tempDir, 'remove-array.md')
    await writeFile(
      filePath,
      `---
removeTools: [write, bash, edit]
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.removeTools).toEqual(['write', 'bash', 'edit'])
  })

  it('supports model field', async () => {
    const filePath = join(tempDir, 'model-test.md')
    await writeFile(
      filePath,
      `---
model: anthropic/claude-sonnet-4-5
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.model).toBe('anthropic/claude-sonnet-4-5')
  })

  it('supports reviewOnEnd field as true', async () => {
    const filePath = join(tempDir, 'review-on-end.md')
    await writeFile(
      filePath,
      `---
reviewOnEnd: true
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.reviewOnEnd).toBe(true)
  })

  it('supports reviewOnEnd field as false', async () => {
    const filePath = join(tempDir, 'review-on-end-false.md')
    await writeFile(
      filePath,
      `---
reviewOnEnd: false
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.reviewOnEnd).toBe(false)
  })

  it('returns undefined reviewOnEnd when not specified', async () => {
    const filePath = join(tempDir, 'no-review.md')
    await writeFile(filePath, 'Test prompt.')

    const result = await loadMarkdown(filePath)
    expect(result?.fm.reviewOnEnd).toBeUndefined()
  })

  it('handles empty tools array', async () => {
    const filePath = join(tempDir, 'empty-tools.md')
    await writeFile(
      filePath,
      `---
tools: []
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.fm.tools).toEqual([])
  })

  it('throws when tools is a number', async () => {
    const filePath = join(tempDir, 'invalid-tools-number.md')
    await writeFile(
      filePath,
      `---
tools: 123
---
Test prompt.`,
    )

    await expect(loadMarkdown(filePath)).rejects.toThrow()
  })

  it('throws when tools array contains non-string', async () => {
    const filePath = join(tempDir, 'invalid-tools-array.md')
    await writeFile(
      filePath,
      `---
tools: [123, "read"]
---
Test prompt.`,
    )

    await expect(loadMarkdown(filePath)).rejects.toThrow()
  })

  it('throws when reviewOnEnd is a string', async () => {
    const filePath = join(tempDir, 'invalid-review-string.md')
    await writeFile(
      filePath,
      `---
reviewOnEnd: "true"
---
Test prompt.`,
    )

    await expect(loadMarkdown(filePath)).rejects.toThrow()
  })
})

describe('mergePromptDefinitions', () => {
  const base = {
    fm: {
      description: 'Base description.',
      model: 'base/model',
      tools: ['read', 'write'] as string[],
      extraTools: ['bash'] as string[],
      removeTools: ['write'] as string[],
      reviewOnEnd: undefined,
    },
    systemPrompt: 'Base prompt.',
  }

  it('append description overrides base description', () => {
    const result = mergePromptDefinitions(base, {
      ...base,
      fm: { ...base.fm, description: 'Append description.' },
    })
    expect(result.fm.description).toBe('Append description.')
  })

  it('keeps base description when append has none', () => {
    const result = mergePromptDefinitions(base, {
      ...base,
      fm: { ...base.fm, description: undefined },
    })
    expect(result.fm.description).toBe('Base description.')
  })

  it('append model overrides base model', () => {
    const result = mergePromptDefinitions(base, {
      ...base,
      fm: { ...base.fm, model: 'append/model' },
    })
    expect(result.fm.model).toBe('append/model')
  })

  it('merges tools arrays as union, preserving order with dedup', () => {
    const result = mergePromptDefinitions(base, {
      ...base,
      fm: { ...base.fm, tools: ['write', 'grep', 'read'] },
    })
    expect(result.fm.tools).toEqual(['read', 'write', 'grep'])
  })

  it('merges extraTools and removeTools as union, preserving order with dedup', () => {
    const result = mergePromptDefinitions(base, {
      ...base,
      fm: {
        ...base.fm,
        extraTools: ['bash', 'glob'],
        removeTools: ['write', 'edit'],
      },
    })
    expect(result.fm.extraTools).toEqual(['bash', 'glob'])
    expect(result.fm.removeTools).toEqual(['write', 'edit'])
  })

  it('does not throw with empty / partial fields', () => {
    const result = mergePromptDefinitions(
      { fm: {}, systemPrompt: 'Base.' },
      { fm: {}, systemPrompt: '' },
    )
    expect(result).toEqual({
      fm: {
        description: undefined,
        model: undefined,
        tools: undefined,
        extraTools: undefined,
        removeTools: undefined,
        reviewOnEnd: undefined,
      },
      systemPrompt: 'Base.',
    })
  })

  it('uses append reviewOnEnd when defined', () => {
    const result = mergePromptDefinitions(base, {
      ...base,
      fm: { ...base.fm, reviewOnEnd: true },
    })
    expect(result.fm.reviewOnEnd).toBe(true)
  })

  it('uses base reviewOnEnd when append has none', () => {
    const result = mergePromptDefinitions(
      { ...base, fm: { ...base.fm, reviewOnEnd: true } },
      { ...base, fm: { ...base.fm, reviewOnEnd: undefined } },
    )
    expect(result.fm.reviewOnEnd).toBe(true)
  })

  it('returns undefined reviewOnEnd when neither has it', () => {
    const result = mergePromptDefinitions(
      { ...base, fm: { ...base.fm, reviewOnEnd: undefined } },
      { ...base, fm: { ...base.fm, reviewOnEnd: undefined } },
    )
    expect(result.fm.reviewOnEnd).toBeUndefined()
  })

  it('joins systemPrompt with a blank line', () => {
    const result = mergePromptDefinitions(
      { ...base, systemPrompt: 'First.' },
      { ...base, systemPrompt: 'Second.' },
    )
    expect(result.systemPrompt).toBe('First.\n\nSecond.')
  })
})
