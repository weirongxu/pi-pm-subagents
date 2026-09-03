import { visibleWidth } from '@earendil-works/pi-tui'

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const segmenter = new Intl.Segmenter()

export function truncateText(
  text: string,
  maxWidth: number,
  ellipsis = '...',
  pad = false,
): string {
  if (maxWidth <= 0) return ''

  const totalWidth = visibleWidth(text)
  if (totalWidth <= maxWidth) {
    return pad ? text + ' '.repeat(maxWidth - totalWidth) : text
  }

  const ellipsisWidth = visibleWidth(ellipsis)
  const useEllipsis = ellipsisWidth < maxWidth
  const targetWidth = useEllipsis ? maxWidth - ellipsisWidth : maxWidth

  const appendFitting = (chunk: string): boolean => {
    for (const { segment } of segmenter.segment(chunk)) {
      const segmentWidth = visibleWidth(segment)
      if (width + segmentWidth > targetWidth) return false
      result += segment
      width += segmentWidth
    }
    return true
  }

  let result = ''
  let width = 0
  let cursor = 0
  let truncated = false
  for (const match of text.matchAll(ANSI_RE)) {
    if (!appendFitting(text.slice(cursor, match.index))) {
      truncated = true
      break
    }
    result += match[0]
    cursor = match.index + match[0].length
  }
  if (truncated) {
    result += [...text.slice(cursor).matchAll(ANSI_RE)]
      .map((m) => m[0])
      .join('')
  } else {
    appendFitting(text.slice(cursor))
  }

  if (useEllipsis) result += ellipsis
  if (pad)
    result += ' '.repeat(
      Math.max(0, maxWidth - width - (useEllipsis ? ellipsisWidth : 0)),
    )
  return result
}
