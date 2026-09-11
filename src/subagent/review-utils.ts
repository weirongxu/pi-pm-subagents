import type { ReviewPagerOptions } from '../ui/review-pager.js'
import type { ReviewOnEnd } from '../utils/markdown.js'

/** Deliverable name reviewed at end of a subagent run. */
export function resolveReviewName(
  reviewOnEnd: ReviewOnEnd | undefined,
): string {
  if (typeof reviewOnEnd === 'string') return reviewOnEnd
  return 'plan'
}

export interface ReviewActions {
  send: (message: string) => Promise<void> | void
  revise: (updatePrompt: string) => Promise<void> | void
}

function reviewTitle(name: string): string {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
  return `📋 ${capitalized} Review`
}

export function buildReviewOptions(input: {
  content: string
  name: string
  actions: ReviewActions
}): ReviewPagerOptions {
  const { content, name, actions } = input
  return {
    title: reviewTitle(name),
    plan: content,
    choices: [
      {
        id: 'send',
        label: `Send ${name} to coordinator`,
        action: () => {
          void actions.send(content)
        },
      },
      {
        id: 'revise',
        label: `Update the ${name}`,
        inlineEditor: true,
        action: (updatePrompt) => {
          if (updatePrompt?.trim()) {
            return actions.revise(
              `Update the ${name} based on:\n\n${updatePrompt.trim()}`,
            )
          }
        },
      },
      {
        id: 'discard',
        label: 'Discard',
        action: () => {},
      },
    ],
  }
}

const REVISED_SUFFIX = / \(r(\d+)\)$/

export function nextRevisedTitle(title: string): string {
  const match = REVISED_SUFFIX.exec(title)
  if (!match) return `${title} (r1)`
  return `${title.slice(0, -match[0].length)} (r${Number(match[1]) + 1})`
}
