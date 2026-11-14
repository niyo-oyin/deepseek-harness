import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { RESOLUTION_MATRIX_SPEC, standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/** The linked-package resolution differential matrix, which `vitest.config.ts` leaves out of the unit run. */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    pool: 'forks',
    setupFiles: [
      './scripts/test-proxy-environment.ts', './scripts/test-network-guard.mjs', './scripts/test-dom-environment.ts',
    ],
    include: [RESOLUTION_MATRIX_SPEC],
  },
})
