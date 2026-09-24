import {
  buildReviewOptions,
  nextRevisedTitle,
  resolveReviewName,
  saveReviewFile,
} from './review-utils.js'
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('nextRevisedTitle', () => {
  it('appends "r1" when there is no suffix', () => {
    expect(nextRevisedTitle('Fix login bug')).toBe('Fix login bug (r1)')
  })

  it('increments an existing "rN" suffix', () => {
    expect(nextRevisedTitle('Fix login bug (r1)')).toBe('Fix login bug (r2)')
    expect(nextRevisedTitle('Fix login bug (r9)')).toBe('Fix login bug (r10)')
  })

  it('does not touch a title with an r mid-string or containing "revised"', () => {
    expect(nextRevisedTitle('plan (r1) draft')).toBe('plan (r1) draft (r1)')
    expect(nextRevisedTitle('revised plan (draft)')).toBe(
      'revised plan (draft) (r1)',
    )
  })
})

describe('resolveReviewName', () => {
  it('returns the string as-is', () => {
    expect(resolveReviewName('research')).toBe('research')
    expect(resolveReviewName('plan')).toBe('plan')
  })

  it("returns 'plan' for true and null for false", () => {
    expect(resolveReviewName(true)).toBe('plan')
    expect(resolveReviewName(false)).toBe(null)
  })

  it('returns null for undefined', () => {
    expect(resolveReviewName(undefined)).toBe(null)
  })
})

describe('buildReviewOptions', () => {
  it('derives plan title and labels verbatim for plan', () => {
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      send: vi.fn(),
      revise: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })
    expect(options.title).toBe('📋 Plan Review')
    expect(options.plan).toBe('content')
    expect(options.choices.map((c) => c.id)).toEqual([
      'send',
      'revise',
      'save',
      'discard',
    ])
    expect(options.choices[0]?.label).toBe('Send plan to coordinator')
    expect(options.choices[1]?.label).toBe('Update the plan')
    expect(options.choices[1]?.inlineEditor).toBe(true)
    expect(options.choices[2]?.label).toBe('Save to file')
    expect(options.choices[3]?.label).toBe('Discard')
  })

  it('derives title and labels for a custom deliverable name', () => {
    const options = buildReviewOptions({
      content: 'content',
      name: 'research',
      send: vi.fn(),
      revise: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })
    expect(options.title).toBe('📋 Research Review')
    expect(options.choices[0]?.label).toBe('Send research to coordinator')
    expect(options.choices[1]?.label).toBe('Update the research')
  })

  it('send action delegates content', async () => {
    const send = vi.fn()
    const options = buildReviewOptions({
      content: 'the content',
      name: 'research',
      send,
      revise: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })

    await options.choices[0]?.action?.()

    expect(send).toHaveBeenCalledWith('the content')
  })

  it('revise action delegates raw trimmed input', async () => {
    const revise = vi.fn(async () => {})
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      send: vi.fn(),
      revise,
      save: vi.fn(async () => {}),
    })

    await options.choices[1]?.action?.('  fix it  ')

    expect(revise).toHaveBeenCalledWith('fix it')
  })

  it('revise action does nothing for blank input', async () => {
    const revise = vi.fn(async () => {})
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      send: vi.fn(),
      revise,
      save: vi.fn(async () => {}),
    })

    await options.choices[1]?.action?.('   ')

    expect(revise).not.toHaveBeenCalled()
  })

  it('save action delegates to callback', async () => {
    const save = vi.fn(async () => {})
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      send: vi.fn(),
      revise: vi.fn(async () => {}),
      save,
    })

    await options.choices[2]?.action?.()

    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('saveReviewFile', () => {
  it('writes content with a trailing newline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'save-review-'))
    try {
      const path = await saveReviewFile(dir, 'plan', 'hello')
      expect(path).toBe(join(dir, '.pi', 'plan', 'plan.md'))
      expect(await readFile(path, 'utf8')).toBe('hello\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('appends the revise suffix on conflict instead of overwriting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'save-review-'))
    try {
      const first = await saveReviewFile(dir, 'plan', 'first')
      const second = await saveReviewFile(dir, 'plan', 'second')
      const third = await saveReviewFile(dir, 'plan', 'third')
      expect(second).toBe(join(dir, '.pi', 'plan', 'plan (r1).md'))
      expect(third).toBe(join(dir, '.pi', 'plan', 'plan (r2).md'))
      expect(await readFile(first, 'utf8')).toBe('first\n')
      expect(await readFile(second, 'utf8')).toBe('second\n')
      expect(await readFile(third, 'utf8')).toBe('third\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
