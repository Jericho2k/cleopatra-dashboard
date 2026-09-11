import { defineConfig } from 'vitest/config'

/**
 * The only reason this file exists: lib/supabase.ts builds its browser client at
 * import time and throws without the two public Supabase variables. Any test
 * that imports a module which transitively reaches lib/api.ts therefore needs
 * them present before the import graph is evaluated.
 *
 * Everything else stays on vitest's defaults, including test discovery.
 */
export default defineConfig({
  test: {
    setupFiles: ['./lib/__tests__/setup.ts'],
  },
})
