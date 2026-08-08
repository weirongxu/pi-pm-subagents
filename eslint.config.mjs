// @ts-check
import { tsconfig } from '@raidou/eslint-config-base'
import { defineConfig } from 'eslint/config'
export default defineConfig([
  {
    files: [
      'src',
      'app/src',
      '*.{mjs,ts,tsx,js,jsx}',
      'app/*.{mjs,ts,tsx,js,jsx}',
    ],
    extends: [tsconfig],
  },
])
