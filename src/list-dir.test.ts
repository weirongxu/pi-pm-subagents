import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatDir } from './list-dir.js'

describe('formatDir', () => {
  it('lists dirs first with "/" suffix, then files sorted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'list-dir-'))
    try {
      await writeFile(join(dir, 'zeta.txt'), 'x')
      await writeFile(join(dir, 'alpha.txt'), 'x')
      await mkdir(join(dir, 'sub'))
      await mkdir(join(dir, 'another'))

      expect(await formatDir(dir)).toBe('another/\nsub/\nalpha.txt\nzeta.txt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects for a nonexistent path', async () => {
    await expect(formatDir('/nonexistent/list-dir-path')).rejects.toThrow()
  })
})
