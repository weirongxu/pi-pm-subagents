import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BASH_READONLY_TOOL_NAME } from '../bash-readonly.js'
import type { PromptDefinition } from '../utils/markdown.js'
import {
  clearRoles,
  listRoles,
  loadRoles,
  resolveRole,
  rolesDescription,
} from './roles.js'

const TEST_PLAN_DEFINITION: PromptDefinition = {
  fm: {},
  systemPrompt:
    'You are a planning subagent that explores code and proposes plans.',
}

const MOCK_AGENT_DIR_VAR = 'PI_CODING_AGENT_DIR'

describe('roles', () => {
  let originalAgentDir: string | undefined

  beforeEach(() => {
    originalAgentDir = process.env[MOCK_AGENT_DIR_VAR]
    clearRoles()
  })

  afterEach(() => {
    process.env[MOCK_AGENT_DIR_VAR] = originalAgentDir
    clearRoles()
  })

  describe('loadRoles', () => {
    describe('built-in roles', () => {
      it('includes worker with empty systemPrompt', async () => {
        await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
        const worker = resolveRole('worker')
        expect(worker.systemPrompt).toBe('')
        expect(worker.fm.tools).toBeUndefined()
        expect(worker.fm.removeTools).toBeUndefined()
        expect(worker.fm.model).toBeUndefined()
        expect(worker.fm.reviewOnEnd).toBeUndefined()
      })

      it('includes planner role with reviewOnEnd enabled', async () => {
        await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
        const planner = resolveRole('planner')
        expect(planner.systemPrompt).toContain('planning subagent')
        expect(planner.fm.reviewOnEnd).toBe(true)
        expect(planner.fm.removeTools).toEqual(['write', 'edit', 'bash'])
        expect(planner.fm.description).toBe('Planning subagent')
      })

      it('returns built-ins when no directories exist', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-empty-'))
        try {
          await loadRoles(tempDir, TEST_PLAN_DEFINITION)
          expect(listRoles()).toEqual(['worker', 'planner'])
          resolveRole('worker')
          resolveRole('planner')
        } finally {
          await rm(tempDir, { recursive: true, force: true })
        }
      })
    })

    describe('project-level roles', () => {
      let tempDir: string
      let agentsDir: string

      beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-project-'))
        agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
      })

      afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
      })

      it('loads all roles from project .pi/agents directory', async () => {
        await writeFile(
          join(agentsDir, 'code-improver.md'),
          `---
description: Scans files and suggests improvements.
tools: [read, grep, glob]
model: sonnet
---
You are a code improver.`,
        )
        await writeFile(
          join(agentsDir, 'tester.md'),
          `---
description: Runs tests.
tools: [test]
---
You are a tester.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(listRoles()).toHaveLength(4)
        expect(() => resolveRole('worker')).not.toThrow()
        expect(() => resolveRole('planner')).not.toThrow()
        expect(() => resolveRole('code-improver')).not.toThrow()
        expect(() => resolveRole('tester')).not.toThrow()
      })

      it('parses role frontmatter correctly (tools as array)', async () => {
        const rolePath = join(agentsDir, 'code-improver.md')
        await writeFile(
          rolePath,
          `---
description: Scans files and suggests improvements.
tools: [read, grep, glob]
model: sonnet
---
You are a code improver.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('code-improver')
        expect(role.fm.description).toBe(
          'Scans files and suggests improvements.',
        )
        expect(role.fm.tools).toEqual(['read', 'grep', 'glob'])
        expect(role.fm.model).toBe('sonnet')
        expect(role.systemPrompt).toBe('You are a code improver.')
      })

      it('handles empty tools array', async () => {
        const rolePath = join(agentsDir, 'no-tools.md')
        await writeFile(
          rolePath,
          `---
tools: []
---
No tools needed.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(resolveRole('no-tools').fm.tools).toEqual([])
      })

      it('parses extraTools as array in frontmatter', async () => {
        const rolePath = join(agentsDir, 'extra-array.md')
        await writeFile(
          rolePath,
          `---
extraTools: [bash_readonly, grep]
---
You have extra tools.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('extra-array')
        expect(role.fm.extraTools).toEqual([BASH_READONLY_TOOL_NAME, 'grep'])
      })

      it('handles empty extraTools array', async () => {
        const rolePath = join(agentsDir, 'no-extra.md')
        await writeFile(
          rolePath,
          `---
extraTools: []
---
No extra tools needed.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(resolveRole('no-extra').fm.extraTools).toEqual([])
      })

      it('parses removeTools as array in frontmatter', async () => {
        const rolePath = join(agentsDir, 'remove-array.md')
        await writeFile(
          rolePath,
          `---
removeTools: [write, bash]
---
You have removed tools.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('remove-array')
        expect(role.fm.removeTools).toEqual(['write', 'bash'])
      })

      it('handles empty removeTools array', async () => {
        const rolePath = join(agentsDir, 'no-remove.md')
        await writeFile(
          rolePath,
          `---
removeTools: []
---
No tools to remove.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(resolveRole('no-remove').fm.removeTools).toEqual([])
      })

      it('tools field is not affected by extraTools', async () => {
        const rolePath = join(agentsDir, 'both-tools.md')
        await writeFile(
          rolePath,
          `---
tools: [read, write]
extraTools: [grep, glob]
---
You have both tools.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('both-tools')
        expect(role.fm.tools).toEqual(['read', 'write'])
        expect(role.fm.extraTools).toEqual(['grep', 'glob'])
      })

      it('skips non-.md files', async () => {
        await writeFile(
          join(agentsDir, 'not-a-role.txt'),
          'This should be ignored.',
        )
        await writeFile(join(agentsDir, 'valid.md'), 'This should be loaded.')

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(listRoles()).toHaveLength(3)
        expect(() => resolveRole('valid')).not.toThrow()
        expect(() => resolveRole('not-a-role')).toThrow()
      })
    })

    describe('global-level roles', () => {
      let tempDir: string
      let globalTempDir: string
      let globalAgentsDir: string

      beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-global-cwd-'))
        globalTempDir = await mkdtemp(
          join(tmpdir(), 'pi-modes-test-global-dir-'),
        )
        globalAgentsDir = join(globalTempDir, 'agents')
        await mkdir(globalAgentsDir, { recursive: true })
        process.env[MOCK_AGENT_DIR_VAR] = globalTempDir
      })

      afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
        await rm(globalTempDir, { recursive: true, force: true })
      })

      it('loads role from global agents directory', async () => {
        const rolePath = join(globalAgentsDir, 'global-role.md')
        await writeFile(
          rolePath,
          `---
description: A global role.
---
Global role content.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('global-role')
        expect(role.fm.description).toBe('A global role.')
        expect(role.systemPrompt).toBe('Global role content.')
      })

      it('loads all roles from global directory', async () => {
        await writeFile(
          join(globalAgentsDir, 'global-role.md'),
          `---
description: First global.
---
First global content.`,
        )
        await writeFile(
          join(globalAgentsDir, 'another-global.md'),
          `---
description: Second global.
---
Second global content.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(listRoles()).toHaveLength(4)
        expect(() => resolveRole('worker')).not.toThrow()
        expect(() => resolveRole('planner')).not.toThrow()
        expect(() => resolveRole('global-role')).not.toThrow()
        expect(() => resolveRole('another-global')).not.toThrow()
      })
    })

    describe('precedence', () => {
      let tempDir: string
      let projectAgentsDir: string
      let globalTempDir: string
      let globalAgentsDir: string

      beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-precedence-cwd-'))
        globalTempDir = await mkdtemp(
          join(tmpdir(), 'pi-modes-test-precedence-global-'),
        )
        projectAgentsDir = join(tempDir, '.pi', 'agents')
        globalAgentsDir = join(globalTempDir, 'agents')
        await mkdir(projectAgentsDir, { recursive: true })
        await mkdir(globalAgentsDir, { recursive: true })
        process.env[MOCK_AGENT_DIR_VAR] = globalTempDir
      })

      afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true })
        await rm(globalTempDir, { recursive: true, force: true })
      })

      it('project-level role overrides global role with the same name', async () => {
        const globalPath = join(globalAgentsDir, 'override-me.md')
        await writeFile(
          globalPath,
          `---
description: Global version.
---
Global content.`,
        )

        const projectPath = join(projectAgentsDir, 'override-me.md')
        await writeFile(
          projectPath,
          `---
description: Project version.
---
Project content.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('override-me')
        expect(role.fm.description).toBe('Project version.')
        expect(role.systemPrompt).toBe('Project content.')
      })

      it('overrides built-in worker when worker.md exists', async () => {
        await writeFile(
          join(projectAgentsDir, 'worker.md'),
          `---
description: Custom worker.
---
Custom worker prompt.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const worker = resolveRole('worker')
        expect(worker.fm.description).toBe('Custom worker.')
        expect(worker.systemPrompt).toBe('Custom worker prompt.')
      })

      it('global role loads when no project override exists', async () => {
        const globalPath = join(globalAgentsDir, 'global-only.md')
        await writeFile(
          globalPath,
          `---
description: Only global.
---
Only global content.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('global-only')
        expect(role.fm.description).toBe('Only global.')
        expect(role.systemPrompt).toBe('Only global content.')
      })

      it('both project and global roles coexist when names differ', async () => {
        await writeFile(
          join(globalAgentsDir, 'global-only.md'),
          'Global content.',
        )
        await writeFile(
          join(projectAgentsDir, 'project-only.md'),
          'Project content.',
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        expect(listRoles()).toHaveLength(4)
        expect(resolveRole('global-only').systemPrompt).toBe('Global content.')
        expect(resolveRole('project-only').systemPrompt).toBe(
          'Project content.',
        )
      })
    })
  })

  describe('resolveRole', () => {
    it('returns the correct definition for a built-in role', async () => {
      await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
      const worker = resolveRole('worker')
      expect(worker.systemPrompt).toBe('')
    })

    it('returns the correct definition for a project role', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-resolve-'))
      try {
        const agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
        await writeFile(
          join(agentsDir, 'custom.md'),
          `---
description: Custom role.
---
Custom prompt.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const role = resolveRole('custom')
        expect(role.fm.description).toBe('Custom role.')
        expect(role.systemPrompt).toBe('Custom prompt.')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('throws for unknown role name', async () => {
      await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
      expect(() => resolveRole('unknown-role')).toThrow(
        'Role "unknown-role" not found.',
      )
    })

    it('throws error message includes available roles', async () => {
      await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
      expect(() => resolveRole('unknown')).toThrow(/Available roles/)
    })

    it('throws when roles not loaded', async () => {
      clearRoles()
      expect(() => resolveRole('worker')).toThrow(
        'Roles not loaded. Call loadRoles() first.',
      )
    })
  })

  describe('listRoles', () => {
    it('lists built-in roles first in stable order', async () => {
      await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
      const names = listRoles()
      expect(names).toEqual(['worker', 'planner'])
    })

    it('lists project roles after built-ins', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-list-'))
      try {
        const agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
        await writeFile(join(agentsDir, 'zeta.md'), 'Zeta content.')
        await writeFile(join(agentsDir, 'alpha.md'), 'Alpha content.')
        await writeFile(join(agentsDir, 'beta.md'), 'Beta content.')

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const names = listRoles()
        expect(names[0]).toBe('worker')
        expect(new Set(names)).toEqual(
          new Set(['worker', 'planner', 'alpha', 'beta', 'zeta']),
        )
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('includes global roles', async () => {
      const globalTempDir = await mkdtemp(
        join(tmpdir(), 'pi-modes-test-list-global-'),
      )
      const globalAgentsDir = join(globalTempDir, 'agents')
      await mkdir(globalAgentsDir, { recursive: true })
      process.env[MOCK_AGENT_DIR_VAR] = globalTempDir

      try {
        await writeFile(join(globalAgentsDir, 'gamma.md'), 'Gamma content.')
        await writeFile(join(globalAgentsDir, 'delta.md'), 'Delta content.')

        await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
        const names = listRoles()
        expect(names[0]).toBe('worker')
        expect(names[1]).toBe('planner')
        expect(new Set(names)).toEqual(
          new Set(['worker', 'planner', 'delta', 'gamma']),
        )
      } finally {
        await rm(globalTempDir, { recursive: true, force: true })
        process.env[MOCK_AGENT_DIR_VAR] = originalAgentDir
      }
    })

    it('includes project and global roles', async () => {
      const tempDir = await mkdtemp(
        join(tmpdir(), 'pi-modes-test-list-override-cwd-'),
      )
      const globalTempDir = await mkdtemp(
        join(tmpdir(), 'pi-modes-test-list-override-global-'),
      )
      const globalAgentsDir = join(globalTempDir, 'agents')
      await mkdir(globalAgentsDir, { recursive: true })
      process.env[MOCK_AGENT_DIR_VAR] = globalTempDir

      try {
        await writeFile(
          join(globalAgentsDir, 'omega.md'),
          'Global omega content.',
        )
        await writeFile(
          join(globalAgentsDir, 'alpha.md'),
          'Global alpha content.',
        )

        const agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
        await writeFile(join(agentsDir, 'omega.md'), 'Project omega content.')
        await writeFile(join(agentsDir, 'beta.md'), 'Project beta content.')

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const names = listRoles()
        expect(names[0]).toBe('worker')
        expect(new Set(names)).toEqual(
          new Set(['worker', 'planner', 'alpha', 'beta', 'omega']),
        )
      } finally {
        await rm(tempDir, { recursive: true, force: true })
        await rm(globalTempDir, { recursive: true, force: true })
        process.env[MOCK_AGENT_DIR_VAR] = originalAgentDir
      }
    })

    it('returns empty array when roles not loaded', () => {
      clearRoles()
      expect(listRoles()).toEqual([])
    })
  })

  describe('rolesDescription', () => {
    it('returns empty string when no roles loaded', () => {
      clearRoles()
      expect(rolesDescription()).toBe('')
    })

    it('lists built-in roles without descriptions', async () => {
      await loadRoles('/fake/cwd', TEST_PLAN_DEFINITION)
      const description = rolesDescription()
      expect(description).toContain('  - worker')
    })

    it('includes role descriptions and tools when available', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-desc-tools-'))
      try {
        const agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
        await writeFile(
          join(agentsDir, 'custom.md'),
          `---
description: A custom role for testing.
tools:
  - read
  - grep
---
Custom prompt.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const description = rolesDescription()
        expect(description).toContain(
          '  - custom: A custom role for testing.; tools: read, grep',
        )
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('includes tools-only when no description', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-tools-only-'))
      try {
        const agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
        await writeFile(
          join(agentsDir, 'toolrole.md'),
          `---
tools:
  - read
  - find
---
Tool role prompt.`,
        )

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const description = rolesDescription()
        expect(description).toContain('  - toolrole: tools: read, find')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('combines built-in and custom roles', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pi-modes-test-combined-'))
      try {
        const agentsDir = join(tempDir, '.pi', 'agents')
        await mkdir(agentsDir, { recursive: true })
        await writeFile(
          join(agentsDir, 'alpha.md'),
          `---
description: Alpha role description.
---
Alpha prompt.`,
        )
        await writeFile(join(agentsDir, 'beta.md'), 'Beta without description.')

        await loadRoles(tempDir, TEST_PLAN_DEFINITION)
        const description = rolesDescription()

        expect(description).toContain('  - worker')
        expect(description).toContain('  - alpha: Alpha role description.')
        expect(description).toContain('  - beta')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })
  })
})
