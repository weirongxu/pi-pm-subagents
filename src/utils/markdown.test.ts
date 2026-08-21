import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadMarkdown } from './markdown.js'
import { composeTools, normalizeTools } from './tools.js'

describe('normalizeTools', () => {
  it('returns undefined for undefined', () => {
    expect(normalizeTools(undefined)).toBeUndefined()
  })

  it('returns undefined for empty array', () => {
    expect(normalizeTools([])).toBeUndefined()
  })

  it('returns copy of array for non-empty array', () => {
    expect(normalizeTools(['read', 'write'])).toEqual(['read', 'write'])
  })

  it('returns undefined for empty string', () => {
    expect(normalizeTools('')).toBeUndefined()
  })

  it('splits comma-separated string', () => {
    expect(normalizeTools('read, write, edit')).toEqual([
      'read',
      'write',
      'edit',
    ])
  })

  it('trims whitespace in comma-separated string', () => {
    expect(normalizeTools('read , write ,grep ,glob')).toEqual([
      'read',
      'write',
      'grep',
      'glob',
    ])
  })

  it('filters empty entries', () => {
    expect(normalizeTools('read,,write,')).toEqual(['read', 'write'])
  })

  it('returns undefined for string that becomes empty after filtering', () => {
    expect(normalizeTools(',,,')).toBeUndefined()
  })
})

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
      description: 'A test mode.',
      tools: ['read', 'write'],
      extraTools: undefined,
      removeTools: undefined,
      model: undefined,
      systemPrompt: 'This is a test mode prompt.',
    })
  })

  it('handles markdown without frontmatter', async () => {
    const filePath = join(tempDir, 'no-fm.md')
    await writeFile(filePath, 'Plain prompt without frontmatter.')

    const result = await loadMarkdown(filePath)
    expect(result).toEqual({
      description: undefined,
      tools: undefined,
      extraTools: undefined,
      removeTools: undefined,
      model: undefined,
      systemPrompt: 'Plain prompt without frontmatter.',
    })
  })

  it('supports tools as comma-separated string', async () => {
    const filePath = join(tempDir, 'string-tools.md')
    await writeFile(
      filePath,
      `---
tools: read, write, edit, grep
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.tools).toEqual(['read', 'write', 'edit', 'grep'])
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
    expect(result?.extraTools).toEqual(['bash', 'grep'])
  })

  it('supports removeTools as comma-separated string', async () => {
    const filePath = join(tempDir, 'remove-string.md')
    await writeFile(
      filePath,
      `---
removeTools: write, bash, edit
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.removeTools).toEqual(['write', 'bash', 'edit'])
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
    expect(result?.model).toBe('anthropic/claude-sonnet-4-5')
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
    expect(result?.tools).toBeUndefined()
  })

  it('trims whitespace in comma-separated tools', async () => {
    const filePath = join(tempDir, 'whitespace-tools.md')
    await writeFile(
      filePath,
      `---
tools: read, write , grep ,glob
---
Test prompt.`,
    )

    const result = await loadMarkdown(filePath)
    expect(result?.tools).toEqual(['read', 'write', 'grep', 'glob'])
  })
})
