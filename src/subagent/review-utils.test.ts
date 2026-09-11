import { describe, expect, it, vi } from 'vitest'

import {
  buildReviewOptions,
  nextRevisedTitle,
  resolveReviewName,
} from './review-utils.js'

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

  it('returns plan for boolean values', () => {
    expect(resolveReviewName(true)).toBe('plan')
    expect(resolveReviewName(false)).toBe('plan')
  })

  it('returns plan for undefined', () => {
    expect(resolveReviewName(undefined)).toBe('plan')
  })
})

describe('buildReviewOptions', () => {
  it('derives plan title and labels verbatim for plan', () => {
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      actions: { send: vi.fn(), revise: vi.fn() },
    })
    expect(options.title).toBe('📋 Plan Review')
    expect(options.plan).toBe('content')
    expect(options.choices.map((c) => c.id)).toEqual([
      'send',
      'revise',
      'discard',
    ])
    expect(options.choices[0]?.label).toBe('Send plan to coordinator')
    expect(options.choices[1]?.label).toBe('Update the plan')
    expect(options.choices[1]?.inlineEditor).toBe(true)
    expect(options.choices[2]?.label).toBe('Discard')
  })

  it('derives title and labels for a custom deliverable name', () => {
    const options = buildReviewOptions({
      content: 'content',
      name: 'research',
      actions: { send: vi.fn(), revise: vi.fn() },
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
      actions: { send, revise: vi.fn() },
    })

    await options.choices[0]?.action?.()

    expect(send).toHaveBeenCalledWith('the content')
  })

  it('revise action delegates rendered prompt with trimmed input', async () => {
    const revise = vi.fn()
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      actions: { send: vi.fn(), revise },
    })

    await options.choices[1]?.action?.('  fix it  ')

    expect(revise).toHaveBeenCalledWith('Update the plan based on:\n\nfix it')
  })

  it('revise action does nothing for blank input', async () => {
    const revise = vi.fn()
    const options = buildReviewOptions({
      content: 'content',
      name: 'plan',
      actions: { send: vi.fn(), revise },
    })

    await options.choices[1]?.action?.('   ')

    expect(revise).not.toHaveBeenCalled()
  })
})
