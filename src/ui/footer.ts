import type { Theme } from '@earendil-works/pi-coding-agent'

import { truncateText } from '../utils/truncate.js'

export function renderFooterKeys(
  theme: Theme,
  keys: readonly [string, string][],
  width: number,
): string {
  const sep = theme.fg('dim', ' · ')
  return truncateText(
    keys
      .map(
        ([key, desc]) =>
          `${theme.fg('syntaxKeyword', key)} ${theme.fg('success', desc)}`,
      )
      .join(sep),
    width,
  )
}
