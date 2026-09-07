import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONFIG_DIR_NAME, getAgentDir } from '@earendil-works/pi-coding-agent'

import { loadMarkdown, type PromptDefinition } from '../utils/markdown.js'
import { composeTools } from '../utils/tools.js'

const DEFAULT_ROLE = 'worker'

const roles: Map<string, PromptDefinition> = new Map()

export async function loadMarkdownRolesFromDir(
  dir: string,
): Promise<Map<string, PromptDefinition>> {
  const loadedRoles = new Map<string, PromptDefinition>()

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map(async (entry) => {
          const roleName = entry.name.slice(0, -'.md'.length)
          const definition = await loadMarkdown(join(dir, entry.name))
          if (definition) {
            loadedRoles.set(roleName, definition)
          }
        }),
    )
  } catch {
    // Ignore unreadable directories silently
  }

  return loadedRoles
}

async function loadBuiltins(): Promise<Map<string, PromptDefinition>> {
  return new Map<string, PromptDefinition>([
    [DEFAULT_ROLE, { fm: {}, systemPrompt: '' }],
  ])
}

export interface LoadRolesOptions {
  /** Skip roles bundled with the plugin (agents/ directory in the package root). */
  skipPluginAgents?: boolean
}

export async function loadRoles(
  cwd: string,
  options: LoadRolesOptions = {},
): Promise<void> {
  roles.clear()
  const addRoles = (newRoles: Map<string, PromptDefinition>) => {
    for (const [name, role] of newRoles) {
      roles.set(name, role)
    }
  }

  addRoles(await loadBuiltins())
  if (!options.skipPluginAgents) {
    // Bundled agents live in the package root, next to src/.
    const here = dirname(fileURLToPath(import.meta.url))
    addRoles(await loadMarkdownRolesFromDir(join(here, '../..', 'agents')))
  }
  addRoles(await loadMarkdownRolesFromDir(join(getAgentDir(), 'agents')))
  addRoles(await loadMarkdownRolesFromDir(join(cwd, CONFIG_DIR_NAME, 'agents')))
}

export function resolveRole(name: string = DEFAULT_ROLE): PromptDefinition {
  if (roles.size === 0) {
    throw new Error('Roles not loaded. Call loadRoles() first.')
  }
  const role = roles.get(name)
  if (!role) {
    throw new Error(
      `Role "${name}" not found. Available roles: ${[...roles.keys()].join(', ')}`,
    )
  }
  return role
}

export function listRoles(): string[] {
  return [...roles.keys()]
}

function formatRoleEntry(
  [name, role]: [string, PromptDefinition],
  baseTools: readonly string[],
): string {
  const parts: string[] = []
  if (role.fm.description) {
    parts.push(role.fm.description)
  }
  const effective = composeTools(baseTools, {
    tools: role.fm.tools,
    extraTools: role.fm.extraTools,
    removeTools: role.fm.removeTools,
  })
  if (effective.length > 0) parts.push(`tools: ${effective.join(', ')}`)
  if (parts.length > 0) return `  - ${name}: ${parts.join('; ')}`
  return `  - ${name}`
}

export function rolesDescription(baseTools: readonly string[] = []): string {
  if (roles.size === 0) {
    return ''
  }

  return [...roles.entries()]
    .map((e) => formatRoleEntry(e, baseTools))
    .join('\n')
}

export function clearRoles(): void {
  roles.clear()
}
