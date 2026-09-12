import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONFIG_DIR_NAME, getAgentDir } from '@earendil-works/pi-coding-agent'

import {
  APPEND_SUFFIX,
  loadMarkdown,
  mergePromptDefinitions,
  type PromptDefinition,
} from '../utils/markdown.js'
import { composeTools } from '../utils/tools.js'

const DEFAULT_ROLE = 'worker'

const roles: Map<string, PromptDefinition> = new Map()

export interface RoleWithAppend {
  role?: PromptDefinition
  append?: PromptDefinition
}

export async function loadMarkdownRolesFromDir(
  dir: string,
): Promise<Map<string, RoleWithAppend>> {
  const loadedRoles = new Map<string, RoleWithAppend>()

  try {
    const entries = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map(async (entry) => {
          const fileName = entry.name.slice(0, -'.md'.length)
          let definition: PromptDefinition | undefined
          try {
            definition = await loadMarkdown(join(dir, entry.name))
          } catch {
            // NOTE: skip unreadable or malformed files without losing the rest of the directory
            return
          }
          if (!definition) return
          const isAppend = fileName.endsWith(APPEND_SUFFIX)
          const roleName = isAppend
            ? fileName.slice(0, -APPEND_SUFFIX.length)
            : fileName
          const loaded = loadedRoles.get(roleName) ?? {}
          if (isAppend) {
            loaded.append = definition
          } else {
            loaded.role = definition
          }
          loadedRoles.set(roleName, loaded)
        }),
    )
  } catch {
    // Ignore unreadable directories silently
  }

  return loadedRoles
}

async function loadBuiltins(): Promise<Map<string, RoleWithAppend>> {
  return new Map<string, RoleWithAppend>([
    [DEFAULT_ROLE, { role: { fm: {}, systemPrompt: '' } }],
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
  const addRoles = (dirRoles: Map<string, RoleWithAppend>) => {
    for (const [name, { role, append }] of dirRoles) {
      const base = role ?? roles.get(name)
      if (!base) continue
      roles.set(name, append ? mergePromptDefinitions(base, append) : base)
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
