// @ts-check
import { tsconfig } from '@raidou/eslint-config-base'
import { defineConfig, globalIgnores } from 'eslint/config'
export default defineConfig([
  globalIgnores(['**/node_modules/', '**/.vitest/', '**/dist/', '**/.venv/']),
  tsconfig,
])
