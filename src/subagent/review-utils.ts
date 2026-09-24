import { mkdir, writeFile } from 'node:fs/promises'
import type { ReviewOnEnd } from '../utils/markdown.js'
import type { ReviewPagerOptions } from '../ui/review-pager.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Deliverable name reviewed at end of a subagent run. */
export function resolveReviewName(
  reviewOnEnd: ReviewOnEnd | undefined,
): string | null {
  if (typeof reviewOnEnd === 'string') return reviewOnEnd
  return reviewOnEnd ? 'plan' : null
}

function reviewTitle(name: string): string {
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
  return `📋 ${capitalized} Review`
}

export function buildReviewOptions({
  content,
  name,
  send,
  revise,
  save,
}: {
  content: string
  name: string
  send: (message: string) => void
  revise: (updatePrompt: string) => Promise<void>
  save: () => Promise<void>
}): ReviewPagerOptions {
  return {
    title: reviewTitle(name),
    plan: content,
    choices: [
      {
        id: 'send',
        label: `Send ${name} to coordinator`,
        action: () => {
          send(content)
        },
      },
      {
        id: 'revise',
        label: `Update the ${name}`,
        inlineEditor: true,
        action: (updatePrompt) => {
          if (updatePrompt?.trim()) {
            void revise(updatePrompt.trim())
          }
        },
      },
      {
        id: 'save',
        label: 'Save to file',
        action: save,
      },
      {
        id: 'discard',
        label: 'Discard',
        action: () => {},
      },
    ],
  }
}

export async function saveReviewFile(
  cwd: string,
  name: string,
  content: string,
): Promise<string> {
  const dir = join(cwd, '.pi', 'plan')
  await mkdir(dir, { recursive: true })
  let stem = name
  while (existsSync(join(dir, `${stem}.md`))) {
    stem = nextRevisedTitle(stem)
  }
  const path = join(dir, `${stem}.md`)
  await writeFile(path, `${content.trimEnd()}\n`, 'utf8')
  return path
}

const REVISED_SUFFIX = / \(r(\d+)\)$/

export function nextRevisedTitle(title: string): string {
  const match = REVISED_SUFFIX.exec(title)
  if (!match) return `${title} (r1)`
  return `${title.slice(0, -match[0].length)} (r${Number(match[1]) + 1})`
}
