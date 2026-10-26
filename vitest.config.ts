import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Runtime seed of the DSH web shell; never installed here.
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/stubs/dsh-client-ui-primitives.tsx', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 20_000,
  },
})
