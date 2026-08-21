import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { CONFIG_DIR_NAME, getAgentDir } from '@earendil-works/pi-coding-agent'

import type { PromptDefinition } from './core.js'
import { loadMarkdown } from './core.js'

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
    [DEFAULT_ROLE, { systemPrompt: '' }],
  ])
}

export async function loadRoles(cwd: string): Promise<void> {
  roles.clear()
  const addRoles = (newRoles: Map<string, PromptDefinition>) => {
    for (const [name, role] of newRoles) {
      roles.set(name, role)
    }
  }

  addRoles(await loadBuiltins())
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

export function rolesDescription(): string {
  if (roles.size === 0) {
    return ''
  }

  return [...roles.entries()]
    .map(([name, role]) =>
      role.description ? `  - ${name}: ${role.description}` : `  - ${name}`,
    )
    .join('\n')
}

export function clearRoles(): void {
  roles.clear()
}
