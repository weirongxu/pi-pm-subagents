import { readFile } from 'node:fs/promises'

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return undefined
  }
}
