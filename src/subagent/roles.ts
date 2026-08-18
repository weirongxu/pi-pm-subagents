import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
} from '@earendil-works/pi-coding-agent'

const DEFAULT_ROLE = 'worker'

export interface RoleFrontmatter extends Record<string, unknown> {
  description?: string
  tools?: string[] | string
  model?: string
}

export interface RoleDefinition {
  description?: string
  tools?: string[]
  model?: string
  systemPrompt: string
}

function normalizeTools(
  tools: string[] | string | undefined,
): string[] | undefined {
  if (tools === undefined) return undefined
  if (Array.isArray(tools)) {
    return tools.length === 0 ? undefined : tools
  }
  const normalized = tools
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return normalized.length === 0 ? undefined : normalized
}

async function loadMarkdownRoleFromFile(
  path: string,
): Promise<RoleDefinition | undefined> {
  try {
    const content = await readFile(path, 'utf8')
    const { frontmatter, body } = parseFrontmatter<RoleFrontmatter>(content)

    return {
      description: frontmatter.description,
      tools: normalizeTools(frontmatter.tools),
      model: frontmatter.model,
      systemPrompt: body.trim(),
    }
  } catch {
    return undefined
  }
}

export async function loadMarkdownRolesFromDir(
  dir: string,
): Promise<Map<string, RoleDefinition>> {
  const roles = new Map<string, RoleDefinition>()

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    const loadPromises = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map(async (entry) => {
        const roleName = entry.name.slice(0, -'.md'.length)
        const role = await loadMarkdownRoleFromFile(join(dir, entry.name))
        if (role) {
          roles.set(roleName, role)
        }
      })

    await Promise.all(loadPromises)
  } catch {
    // Ignore unreadable directories silently
  }

  return roles
}

async function loadBuiltins(): Promise<Map<string, RoleDefinition>> {
  return new Map<string, RoleDefinition>([[DEFAULT_ROLE, { systemPrompt: '' }]])
}

const roles: Map<string, RoleDefinition> = new Map()

export async function loadRoles(cwd: string): Promise<void> {
  roles.clear()
  const addRoles = (newRoles: Map<string, RoleDefinition>) => {
    for (const [name, role] of newRoles) {
      roles.set(name, role)
    }
  }

  addRoles(await loadBuiltins())
  addRoles(await loadMarkdownRolesFromDir(join(getAgentDir(), 'agents')))
  addRoles(await loadMarkdownRolesFromDir(join(cwd, CONFIG_DIR_NAME, 'agents')))
}

export function resolveRole(name: string = DEFAULT_ROLE): RoleDefinition {
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
