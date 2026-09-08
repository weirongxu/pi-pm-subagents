import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  AgentToolResult,
  ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'

export const LIST_DIR_TOOL_NAME = 'list_dir'

export const ListDirParamsSchema = Type.Object({
  path: Type.String(),
})

export type ListDirParams = Static<typeof ListDirParamsSchema>

export async function formatDir(path: string): Promise<string> {
  const dirPath = resolve(process.cwd(), path)
  const dirents = await readdir(dirPath, { withFileTypes: true })

  return dirents
    .map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    .map((e) => (e.isDirectory ? `${e.name}/` : e.name))
    .join('\n')
}

export function setupListDirTool(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: LIST_DIR_TOOL_NAME,
      label: 'ListDir',
      description: 'List directory contents. Folders end with "/".',
      parameters: ListDirParamsSchema,

      async execute(_id, params): Promise<AgentToolResult<unknown>> {
        try {
          const text = await formatDir(params.path)
          return {
            content: [{ type: 'text', text }],
            details: undefined,
          }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            details: undefined,
          }
        }
      },

      renderCall(args: ListDirParams, theme) {
        const text = theme.fg('toolTitle', theme.bold('list_dir '))
        return new Text(text + theme.fg('accent', args.path), 0, 0)
      },

      renderResult(result) {
        const first = result.content[0]
        const text = first?.type === 'text' ? first.text : ''
        return new Text(text, 0, 0)
      },
    }),
  )
}
