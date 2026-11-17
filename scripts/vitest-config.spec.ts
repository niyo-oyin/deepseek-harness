/** Root Vitest configuration rules that every platform's test run depends on. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const config = readFileSync(resolve(import.meta.dirname, '../vitest.config.ts'), 'utf8')

it('keeps supported LSP source under native Windows coverage', () => {
  expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
  expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
  expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
})

it('keeps every Vitest project process-isolated on native Windows', () => {
  expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
  expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
})

it('applies the lane test budget inside every Vitest project', () => {
  // Each inline project spreads coverageTestTimeoutOptions, the only route
  // for DSH_COVERAGE_TEST_TIMEOUT_MS into projects; the behavior itself is
  // pinned by scripts/lane-test-budget.spec.ts.
  expect(config).toContain('const laneTestBudget = coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV])')
  expect(config.match(/^ {10}\.\.\.laneTestBudget,$/gm)).toHaveLength(2)
})
